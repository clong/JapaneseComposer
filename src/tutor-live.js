import { getCurrentActivity } from './tutor-v2.js';
import { normalizeTutorSpeechRate, normalizeTutorVoice } from './tutor-utils.js';

export const TUTOR_LIVE_MODEL = 'gpt-live-1';
export const isTutorLiveModel = (model = '') => /^gpt-live-/.test(model);

export function tutorLivePaceInstruction(rate) {
  const speed = normalizeTutorSpeechRate(rate);
  const pace = speed < 0.75 ? 'very slowly, with clear pauses between phrases'
    : speed < 1 ? 'slowly and clearly'
      : speed > 1.15 ? 'at a brisk natural pace' : 'at a natural conversational pace';
  return `Speak ${pace}. Keep Japanese pronunciation natural. This changes delivery pace, not lesson difficulty.`;
}

export function tutorLiveActivityContext({ blueprint, activityState, preferences = {}, profile = {} }) {
  const activity = getCurrentActivity(blueprint, activityState);
  return [
    `Current Japanese activity: ${activity?.goal || 'One easy Japanese question.'}`,
    `Task: ${activity?.instructions || 'Ask one short Japanese question.'}`,
    `Difficulty: ${activity?.difficultyLevel || 'A1'}. Vocabulary ceiling: ${preferences.contentCeiling || profile.contentCeiling || 'N5'}.`,
    activityState?.repairRequired
      ? `Repair required before progressing: ${activityState.pendingCorrection}. Model it once, then ask for a Japanese retry.`
      : 'Use the current activity; the backend decides progression.',
    blueprint?.mission?.id?.startsWith('diagnostic_')
      ? 'Baseline: begin at A1/N5. Increase difficulty only when the backend changes the activity. Collect a sample without correction.' : ''
  ].filter(Boolean).join('\n');
}

export function createTutorLiveSessionConfig(options = {}) {
  const { model = TUTOR_LIVE_MODEL, preferences = {}, voice, recentTurns = [] } = options;
  return {
    model,
    instructions: [
      'You are a patient Japanese speaking tutor. Japanese is the only practice language.',
      'Begin in very simple Japanese. Never ask the learner to practice English.',
      'Answer a substantive English question with one brief English explanation, then return to a Japanese practice prompt. Names, fillers, accents and borrowed words do not change the language.',
      'Use one or two short sentences and at most one question, then listen. Give the learner time to think. Avoid monologues.',
      'Backchannel policy: Use sparse, brief acknowledgments without competing with learner speech.',
      'Interruption policy: Stop speaking when the learner interrupts and listen. Ignore speaker echo, coughs and background sounds.',
      'Delegation policy:\nBackend tools: Assess Japanese answers, choose the next activity, track mastery, and select one meaningful correction.',
      'Delegate to the backend when the learner finishes a substantive practice answer or retry, or changes an answer being assessed. Wait for the result before judging success or advancing.',
      'Do not delegate greetings, requests to repeat, simple explanations, or unclear sounds. Ask a brief clarification when needed.',
      'Treat backend activity context as the current lesson. Never invent a mastery score or diagnose pronunciation from transcript text.',
      tutorLivePaceInstruction(preferences.speechRate),
      tutorLiveActivityContext(options)
    ].join('\n'),
    delegation: { type: 'client' },
    audio: { output: { voice: normalizeTutorVoice(voice || preferences.voice) } },
    input: recentTurns.filter((turn) => ['user', 'assistant'].includes(turn.role) && turn.transcript)
      .slice(-12).map((turn) => ({
        type: 'message', role: turn.role,
        content: [{ type: turn.role === 'assistant' ? 'output_text' : 'input_text', text: turn.transcript.slice(0, 400) }]
      })),
    store: false
  };
}

// A UTF-8 byte bound also bounds worst-case byte-level tokens for context appends.
export function tutorLiveAppends(type, content, delegationId = null, prefix = 'tutor') {
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of String(content || '')) {
    const size = new TextEncoder().encode(character).length;
    if (bytes + size > 450) { chunks.push(chunk); chunk = ''; bytes = 0; }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((text, index) => ({
    type, content: text, delegation_id: delegationId, event_id: `${prefix}_${index}`
  }));
}

export function createTutorLiveTranscript() {
  const rows = [];
  const seen = new Set();
  let revision = 0;
  return {
    rows,
    get revision() { return revision; },
    append(event) {
      const role = event.type === 'session.input_transcript.delta' ? 'user'
        : event.type === 'session.output_transcript.delta' ? 'assistant' : '';
      if (!role || typeof event.delta !== 'string' || !event.delta) return null;
      if (!Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) || event.end_ms < event.start_ms) return null;
      if (event.event_id && seen.has(event.event_id)) return null;
      if (event.event_id) seen.add(event.event_id);
      const start = event.start_ms;
      const end = event.end_ms;
      // Group by the audio timeline, not arrival time. These rows are captions, not semantic turns.
      let row = rows.filter((entry) => entry.role === role
        && start <= entry.endMs + 1200 && end >= entry.startMs - 1200
        && !(start > entry.endMs && rows.some((other) => other.role !== role
          && other.endMs > entry.endMs && other.startMs < start)))
        .sort((a, b) => Math.abs(start - a.endMs) - Math.abs(start - b.endMs))[0];
      if (!row) {
        row = { id: `live_${role}_${event.event_id || `${start}_${rows.length}`}`.slice(0, 120), role,
          startMs: start, endMs: end, transcript: '', fragments: [], revision: 0 };
        rows.push(row);
      }
      row.fragments.push({ eventId: event.event_id || '', delta: event.delta, startMs: start, endMs: end });
      row.fragments.sort((a, b) => a.startMs - b.startMs);
      row.transcript = row.fragments.map((fragment) => fragment.delta).join('');
      row.startMs = Math.min(row.startMs, start);
      row.endMs = Math.max(row.endMs, end);
      row.revision += 1;
      if (role === 'user') revision += 1;
      return row;
    }
  };
}

export function waitForTutorLiveClose(channel, { timeoutMs = 5000 } = {}) {
  if (!channel || channel.readyState !== 'open') return Promise.resolve({ finalized: false });
  return new Promise((resolve) => {
    let timer;
    const finish = (result) => {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
      resolve(result);
    };
    const onMessage = ({ data }) => {
      let event;
      try { event = JSON.parse(data); } catch { return; }
      if (event.type === 'session.closed') finish({ finalized: true, usage: event.usage, reason: event.reason });
    };
    const onClose = () => finish({ finalized: false });
    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);
    timer = setTimeout(onClose, timeoutMs);
    try { channel.send(JSON.stringify({ type: 'session.close' })); } catch { onClose(); }
  });
}
