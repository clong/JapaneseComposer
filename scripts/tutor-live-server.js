import { createTutorLiveSessionConfig, createTutorLiveTranscript, tutorLiveAppends } from '../src/tutor-live.js';

export async function createTutorLiveCall({ apiKey, safetyIdentifier, offerSdp, options, fetchImpl = fetch }) {
  const response = await fetchImpl('https://api.openai.com/v1/live/sessions', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': safetyIdentifier
    },
    body: JSON.stringify({
      session: createTutorLiveSessionConfig(options),
      transport: { type: 'webrtc', sdp: offerSdp }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || 'GPT-Live session creation failed'), { status: response.status });
  }
  if (typeof payload?.session?.id !== 'string' || !payload.session.id
    || typeof payload?.transport?.sdp !== 'string' || !payload.transport.sdp) {
    throw Object.assign(new Error('GPT-Live returned no session ID or SDP answer'), { status: 502 });
  }
  return { callId: payload.session.id, answerSdp: payload.transport.sdp };
}

export const tutorLiveSidebandUrl = (id) => `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`;

export function createTutorLiveGreeting(send, prefix = 'tutor_greeting') {
  let requested = false;
  let acknowledged = false;
  const instructions = tutorLiveAppends('session.instructions.append',
    'Greet immediately in very simple Japanese without waiting for the learner. Ask the current activity question, then pause and listen. Use at most two short sentences.',
    null, prefix);
  return {
    start() {
      if (requested) return;
      requested = true;
      instructions.forEach(send);
    },
    handle(event) {
      if (!requested || acknowledged || event.type !== 'session.instructions.appended'
        || event.client_event_id !== instructions.at(-1).event_id) return;
      acknowledged = true;
      tutorLiveAppends('session.commentary.append', 'Begin the conversation now, following the instructions provided.',
        null, `${prefix}_begin`).forEach(send);
    }
  };
}

export function createTutorLiveDirector({ send, assess, context, persistRow, persistFragment,
  status, usage, logError, transcriptDelayMs = 650, onAudio = () => {} }) {
  const transcript = createTutorLiveTranscript();
  const delegations = new Set();
  const assessedRows = new Set();
  let queue = Promise.resolve();
  let writes = Promise.resolve();
  let closing = false;
  let cancelled = false;
  let finalEvent = null;
  let eventSequence = 0;
  let finishClose = null;

  function append(type, content, delegationId = null) {
    for (const event of tutorLiveAppends(type, content, delegationId, `director_${++eventSequence}`)) send(event);
  }

  function handle(event) {
    if (cancelled) return;
    if (event.type === 'session.input_audio.append' || event.type === 'session.output_audio.delta') {
      if (!finalEvent) onAudio(event);
      return;
    }
    const row = transcript.append(event);
    if (row) {
      const snapshot = { ...row, fragments: row.fragments.map((fragment) => ({ ...fragment })) };
      writes = writes.then(async () => { await persistFragment(event); await persistRow(snapshot); }).catch(logError);
      return;
    }
    if (event.type === 'session.usage.updated') usage(event.usage, false);
    if (event.type === 'session.closed') {
      finalEvent = event;
      closing = true;
      usage(event.usage, true, event.reason);
      status('idle');
      finishClose?.(true);
    }
    if (event.type === 'error') logError(new Error(event.error?.message || 'GPT-Live command failed'));
    if (event.type !== 'session.delegation.created' || event.delegation?.target !== 'client' || closing) return;
    const id = event.delegation.id;
    if (!id || delegations.has(id)) return;
    delegations.add(id);
    status('assessing');
    queue = queue.then(async () => {
      // Delegation is the semantic trigger; delayed captions are only evidence for that trigger.
      await new Promise((resolve) => setTimeout(resolve, transcriptDelayMs));
      if (closing) return;
      const candidates = transcript.rows.filter((entry) => entry.role === 'user' && !assessedRows.has(entry.id)
        && (!Number.isFinite(event.offset_ms) || entry.startMs <= event.offset_ms));
      if (!candidates.length) {
        append('session.instructions.append', 'Ask the learner to repeat their answer briefly in Japanese; the answer was unclear. Do not guess or award mastery.', id);
        return;
      }
      const revision = transcript.revision;
      const current = () => !closing && transcript.revision === revision;
      const turn = candidates[candidates.length - 1];
      const result = await assess({ turnId: turn.id, transcript: candidates.map((entry) => entry.transcript).join('\n'),
        acoustic: { source: 'gpt_live_transcript', transcriptConfidence: 0.65 }, isCurrent: current });
      if (!result || !current()) {
        if (!closing) append('session.thinking.append', 'The learner added or changed their answer. The earlier assessment was not applied. Delegate again for the updated answer.', id);
        return;
      }
      candidates.forEach((entry) => assessedRows.add(entry.id));
      append('session.thinking.append', context(), id);
      const correction = result.correction;
      if (correction?.required) {
        append('session.thinking.append', `Assessed correction: ${correction.corrected}. ${correction.explanation || ''}`, id);
      }
      append('session.instructions.append', correction?.required
        ? 'Model the assessed correction once in Japanese, then request one Japanese retry. Keep it brief and stay on this target.'
        : 'Continue the current Japanese activity using the latest backend context. Ask one short Japanese question and listen.', id);
    }).catch((error) => {
      logError(error);
      if (!closing) append('session.instructions.append', 'Continue with one easy Japanese follow-up. The assessment is unavailable; do not claim that a target was mastered.', id);
    }).finally(() => { status('idle'); });
  }

  return {
    handle,
    transcript,
    async close(timeoutMs = 5000) {
      if (finalEvent) { await queue; await writes; return true; }
      closing = true;
      const finalized = await new Promise((resolve) => {
        const timer = setTimeout(() => { finishClose = null; resolve(false); }, timeoutMs);
        finishClose = (value) => { clearTimeout(timer); finishClose = null; resolve(value); };
        if (!send({ type: 'session.close' })) finishClose(false);
      });
      await queue;
      await writes;
      return finalized;
    },
    async drain() { await queue; await writes; },
    cancel() { cancelled = true; closing = true; finishClose?.(false); }
  };
}

// Sideband audio is PCM16LE at 24 kHz. Input has no server timestamps; its alignment is approximate.
export function createTutorLiveAudioBuffer({ maxBytes = 28 * 1024 * 1024, now = Date.now } = {}) {
  const streams = { user: [], assistant: [] };
  const start = now();
  const totals = { user: 0, assistant: 0 };
  let inputEnd = null;
  return {
    append(event) {
      const speaker = event.type === 'session.input_audio.append' ? 'user' : 'assistant';
      if (totals[speaker] >= maxBytes) return;
      const value = speaker === 'user' ? event.audio : event.delta;
      if (typeof value !== 'string') return;
      const received = Buffer.from(value, 'base64');
      const available = Math.floor((maxBytes - totals[speaker]) / 2) * 2;
      const bytes = received.subarray(0, available);
      if (!bytes.length) return;
      const startMs = speaker === 'assistant' ? event.start_ms : inputEnd ?? Math.max(0, now() - start);
      const endMs = startMs + bytes.length / 48;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
      if (speaker === 'user') inputEnd = endMs;
      streams[speaker].push({ bytes, startMs, endMs });
      totals[speaker] += bytes.length;
    },
    wav(speaker, startMs, endMs) {
      const chunks = streams[speaker].filter((chunk) => chunk.endMs > startMs && chunk.startMs < endMs);
      if (!chunks.length) return null;
      const pcm = Buffer.concat(chunks.map((chunk) => {
        const from = Math.max(0, Math.floor((startMs - chunk.startMs) * 24) * 2);
        const to = Math.min(chunk.bytes.length, Math.ceil((endMs - chunk.startMs) * 24) * 2);
        return chunk.bytes.subarray(from, Math.max(from, to));
      }));
      if (!pcm.length) return null;
      const header = Buffer.alloc(44);
      header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
      header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
      header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
      header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
      header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
      return Buffer.concat([header, pcm]);
    },
    clear() { streams.user.length = 0; streams.assistant.length = 0; }
  };
}
