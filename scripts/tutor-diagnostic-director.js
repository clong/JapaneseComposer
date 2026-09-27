import { createTutorLiveTranscript, tutorLiveAppends } from '../src/tutor-live.js';
import { createHash } from 'node:crypto';

// Captions are display rows. A logical answer spans all rows for one pending question.
export function createTutorDiagnosticDirector({ send, assess, question, context, persistRow, persistFragment,
  status, usage, onAudio = () => {}, logError, trace = () => {}, onQuestion = () => {},
  stableMs = 800, speechQuietMs = 450, now = Date.now }) {
  const transcript = createTutorLiveTranscript();
  const consumed = new Set();
  const delegations = new Set();
  let revision = 0;
  let sequence = 0;
  let timer;
  let deliveryTimer;
  let speechTimer;
  let responseTimer;
  let pendingDelivery = null;
  let writes = Promise.resolve();
  let operation = null;
  let closed = false;
  let cancelled = false;
  let lastUserAt = 0;
  let lastAssistantAt = 0;
  let lastAnswerEnd = 0;
  let closeResolve;
  let finalEvent = null;
  let errors = 0;
  let awaitingSpeechAt = 0;
  let waitingForSpeech = false;
  let lastDelivery = null;
  let inputAudioSeen = false;
  let lastVoicedInputAt = 0;

  function speaking() {
    clearTimeout(responseTimer);
    waitingForSpeech = false;
    clearTimeout(speechTimer);
    status('speaking');
    speechTimer = setTimeout(() => { if (!closed && !operation && !pendingDelivery) status('idle'); }, 1500);
    speechTimer.unref?.();
  }

  function append(type, content, delegationId = null) {
    // Quiet context can arrive in chunks; a speaking command must remain a single task.
    const compact = type === 'session.commentary.append' && Buffer.byteLength(content) > 450
      ? 'Deliver the single current Japanese task in the latest backend context. Ask only one question, then listen. No assessment announcements or routine praise.' : content;
    const blocks = type === 'session.thinking.append' ? compact.split('\n').filter(Boolean) : [compact];
    return blocks.flatMap(block => tutorLiveAppends(type, block, delegationId, `diagnostic_${++sequence}`)).every(event => {
      trace({ type: 'director.send', detail: JSON.stringify(event), questionId: question()?.id, answerRevision: revision });
      return send(event);
    });
  }

  function deliver() {
    clearTimeout(deliveryTimer);
    if (!pendingDelivery || closed) return;
    const quietFor = now() - Math.max(lastUserAt, lastAssistantAt);
    if (quietFor < speechQuietMs) {
      deliveryTimer = setTimeout(deliver, speechQuietMs - quietFor);
      deliveryTimer.unref?.(); return;
    }
    const value = pendingDelivery;
    if (value.revision !== revision) { pendingDelivery = null; return; }
    pendingDelivery = null;
    lastDelivery = value;
    append('session.thinking.append', context(), value.delegationId);
    append('session.commentary.append', value.message, value.delegationId);
    awaitingSpeechAt = lastAnswerEnd;
    waitingForSpeech = true;
    status('responding');
    clearTimeout(responseTimer);
    responseTimer = setTimeout(() => {
      if (!closed) {
        waitingForSpeech = false;
        trace({ type: 'director.response.timeout', questionId: question()?.id, answerRevision: revision });
        status('response_unavailable');
      }
    }, 8000);
    responseTimer.unref?.();
  }

  function schedule(delay = stableMs, delegationId = null, manual = false) {
    clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(() => { void process(delegationId, manual); }, delay);
    timer.unref?.();
  }

  async function process(delegationId = null, manual = false) {
    clearTimeout(timer);
    if (closed) return;
    if (operation) { schedule(stableMs, delegationId, manual); return; }
    const rows = transcript.rows.filter(row => row.role === 'user').map(row => {
      const fragments = row.fragments.filter(fragment => !consumed.has(fragment.eventId));
      return { ...row, fragments, transcript: fragments.map(fragment => fragment.delta).join('') };
    }).filter(row => row.fragments.length);
    if (!rows.length) {
      if (manual && lastDelivery && !waitingForSpeech && now() - lastAssistantAt > 2000) {
        pendingDelivery = { ...lastDelivery, revision }; deliver();
      }
      return;
    }
    const answerText = rows.map(row => row.transcript).join(' ').trim();
    if (!manual && inputAudioSeen && now() - lastVoicedInputAt > 2500 && answerText.length <= 6) {
      rows.forEach(row => row.fragments.forEach(fragment => consumed.add(fragment.eventId)));
      trace({ type: 'director.uncertain_audio', detail: 'Short caption without recent voiced input; excluded from assessment.' });
      status('listening'); return;
    }
    if (!manual && now() - lastUserAt < stableMs) { schedule(stableMs, delegationId); return; }
    const q = question();
    if (!q) return;
    const snapshot = revision;
    const voicedSnapshot = lastVoicedInputAt;
    const turnId = `answer_${createHash('sha256').update(`${q.id}:${rows[0].fragments[0].eventId}`).digest('hex').slice(0, 24)}`;
    const turn = { turnId, questionId: q.id,
      answerRevision: snapshot, activityRevision: q.revision, rowIds: rows.map(row => row.id),
      finalized: manual,
      transcript: answerText, prompt: q.spokenText || q.task,
      isCurrent: () => !closed && snapshot === revision && lastVoicedInputAt === voicedSnapshot
        && question()?.id === q.id && question()?.revision === q.revision };
    trace({ type: 'director.assessment.start', questionId: q.id, answerRevision: snapshot, detail: turn.turnId });
    status('assessing');
    operation = (async () => {
      const started = now();
      try {
        const result = await assess(turn);
        trace({ type: 'director.assessment.end', questionId: q.id, answerRevision: snapshot,
          detail: JSON.stringify({ durationMs: now() - started, intent: result?.intent, stale: revision !== snapshot }) });
        if (closed) return;
        if (snapshot !== revision || lastVoicedInputAt !== voicedSnapshot || !result) { schedule(stableMs); return; }
        if (result.intent === 'incomplete' || (result.intent === 'answer' && result.complete === false)) {
          // Retain these rows. The next caption or explicit handoff will extend this answer.
          if (manual) {
            pendingDelivery = { message: `Ask one short Japanese clarification to complete this SAME answer: ${q.spokenText || q.task}. Do not score it as a failure.`,
              delegationId, revision: snapshot };
            deliver(); return;
          }
          status('listening'); return;
        }
        rows.forEach(row => row.fragments.forEach(fragment => consumed.add(fragment.eventId)));
        errors = 0;
        const userEnd = Math.max(...rows.map(row => row.endMs));
        const userStart = Math.min(...rows.map(row => row.startMs));
        const alreadyAnswered = ['clarification', 'off_topic'].includes(result.intent)
          && transcript.rows.some(row => row.role === 'assistant' && row.startMs >= userStart
            && row.endMs >= userEnd && row.transcript.trim().length > 8);
        if (alreadyAnswered) {
          append('session.thinking.append', context(), delegationId);
          trace({ type: 'director.reply_already_spoken', questionId: q.id, answerRevision: snapshot });
          status('listening'); return;
        }
        if (result.speak) {
          pendingDelivery = { message: result.speak, delegationId, revision: snapshot };
          deliver();
        } else status('listening');
      } catch (error) {
        logError(error);
        errors += 1;
        trace({ type: 'director.assessment.error', questionId: q.id, answerRevision: snapshot, detail: error.message });
        if (!closed && revision === snapshot) {
          if (errors < 2) schedule(1000, delegationId, manual);
          else {
            // Keep the evidence for a later explicit retry, but do not create an automatic error loop.
            pendingDelivery = { message: `One brief clarification of the SAME Japanese question, without assessment announcements: ${q.spokenText || q.task}`,
              delegationId, revision: snapshot };
            deliver();
            status('assessment_unavailable');
          }
        }
      } finally { operation = null; }
    })();
    await operation;
  }

  function handle(event) {
    if (cancelled) return;
    if (event.type === 'session.input_audio.append' || event.type === 'session.output_audio.delta') {
      if (!finalEvent) onAudio(event);
      // Live output includes silence; only voiced PCM should postpone a queued question.
      const bytes = Buffer.from(event.audio || event.delta || '', 'base64');
      if (event.type === 'session.input_audio.append') inputAudioSeen = true;
      let energy = 0;
      for (let i = 0; i + 1 < bytes.length; i += 16) energy = Math.max(energy, Math.abs(bytes.readInt16LE(i)));
      if (energy > 700) {
        if (event.type === 'session.input_audio.append') {
          lastUserAt = now(); lastVoicedInputAt = now();
        }
        else {
          lastAssistantAt = now(); speaking();
          if (awaitingSpeechAt) {
            trace({ type: 'director.first_audio', detail: String(now() - awaitingSpeechAt) }); awaitingSpeechAt = 0;
          }
        }
      }
      return;
    }
    const row = transcript.append(event);
    if (row) {
      const copy = { ...row, fragments: row.fragments.map(f => ({ ...f })) };
      writes = writes.then(async () => { await persistFragment(event); await persistRow(copy); }).catch(logError);
      if (row.role === 'user' && !closed) {
        revision += 1; lastUserAt = now(); lastAnswerEnd = now();
        clearTimeout(deliveryTimer); pendingDelivery = null;
        schedule();
      } else if (row.role === 'assistant') {
        lastAssistantAt = now(); speaking();
        onQuestion(row.transcript, row.id);
      }
      return;
    }
    if (event.type === 'session.delegation.created' && event.delegation?.target === 'client') {
      const id = event.delegation.id;
      if (!id || delegations.has(id)) return;
      delegations.add(id); schedule(Math.max(0, stableMs - (now() - lastUserAt)), id);
    }
    if (event.type === 'session.usage.updated') usage(event.usage, false);
    if (event.type === 'error') logError(new Error(event.error?.message || 'Live command failed'));
    if (event.type === 'session.closed') {
      finalEvent = event; closed = true; clearTimeout(timer); clearTimeout(deliveryTimer);
      clearTimeout(speechTimer); clearTimeout(responseTimer);
      usage(event.usage, true, event.reason); status('idle'); closeResolve?.(true);
    }
  }

  return {
    handle, transcript,
    get quiet() { return !operation && !pendingDelivery && !waitingForSpeech
      && now() - lastUserAt >= speechQuietMs && now() - lastAssistantAt >= 1500; },
    announce(message) { pendingDelivery = { message, delegationId: null, revision }; deliver(); },
    finalize() { if (closed) return false; errors = 0; schedule(250, null, true); return true; },
    async drain() { if (operation) await operation; await writes; },
    async close(timeoutMs = 5000) {
      closed = true; clearTimeout(timer); clearTimeout(deliveryTimer);
      clearTimeout(speechTimer); clearTimeout(responseTimer);
      if (!finalEvent) await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(false), timeoutMs);
        closeResolve = result => { clearTimeout(timeout); resolve(result); };
        if (!send({ type: 'session.close' })) closeResolve(false);
      });
      if (operation) await operation; await writes;
      return Boolean(finalEvent);
    },
    cancel() { cancelled = true; closed = true; clearTimeout(timer); clearTimeout(deliveryTimer);
      clearTimeout(speechTimer); clearTimeout(responseTimer); closeResolve?.(false); }
  };
}
