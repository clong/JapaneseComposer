function cleanTimestamp(value) {
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : Date.now();
}

export function createTutorRealtimeTraceState(value = {}) {
  return {
    assistantTurns: Math.max(0, Math.trunc(Number(value.assistantTurns) || 0)),
    completedAssistantTurns: Math.max(0, Math.trunc(Number(value.completedAssistantTurns) || 0)),
    interruptedAssistantTurns: Math.max(0, Math.trunc(Number(value.interruptedAssistantTurns) || 0)),
    firstAudioLatenciesMs: Array.isArray(value.firstAudioLatenciesMs)
      ? value.firstAudioLatenciesMs.map(Number).filter(Number.isFinite).slice(-50)
      : [],
    pendingResponseCreatedAt: Number.isFinite(Number(value.pendingResponseCreatedAt))
      ? Math.trunc(Number(value.pendingResponseCreatedAt))
      : null,
    lastTutorAudioStoppedAt: Number.isFinite(Number(value.lastTutorAudioStoppedAt))
      ? Math.trunc(Number(value.lastTutorAudioStoppedAt))
      : null,
    pendingLearnerResponseLatencyMs: Math.max(0, Math.trunc(Number(value.pendingLearnerResponseLatencyMs) || 0)),
    sidebandConnected: Boolean(value.sidebandConnected),
    sidebandReconnects: Math.max(0, Math.trunc(Number(value.sidebandReconnects) || 0)),
    connectionTransitions: Array.isArray(value.connectionTransitions)
      ? value.connectionTransitions.slice(-30)
      : []
  };
}

export function reduceTutorRealtimeTrace(state, event = {}, at = Date.now()) {
  const next = createTutorRealtimeTraceState(state);
  const type = typeof event.type === 'string' ? event.type : '';
  const timestamp = cleanTimestamp(at);
  if (type === 'response.created') {
    next.pendingResponseCreatedAt = timestamp;
  }
  if (type === 'output_audio_buffer.started' && next.pendingResponseCreatedAt) {
    next.firstAudioLatenciesMs.push(Math.max(0, timestamp - next.pendingResponseCreatedAt));
    next.firstAudioLatenciesMs = next.firstAudioLatenciesMs.slice(-50);
    next.pendingResponseCreatedAt = null;
  }
  if (type === 'output_audio_buffer.stopped') {
    next.lastTutorAudioStoppedAt = timestamp;
  }
  if (type === 'input_audio_buffer.speech_started' && next.lastTutorAudioStoppedAt) {
    next.pendingLearnerResponseLatencyMs = Math.max(0, timestamp - next.lastTutorAudioStoppedAt);
  }
  if (type === 'response.done' || type === 'response.completed') {
    next.assistantTurns += 1;
    const status = String(event.response?.status || event.status || '').toLowerCase();
    if (status === 'completed') {
      next.completedAssistantTurns += 1;
    } else if (status === 'cancelled' || status === 'incomplete' || status === 'failed') {
      next.interruptedAssistantTurns += 1;
    }
  }
  if (type === 'sideband.open') {
    if (!next.sidebandConnected && next.connectionTransitions.some((entry) => entry.state === 'closed')) {
      next.sidebandReconnects += 1;
    }
    next.sidebandConnected = true;
    next.connectionTransitions.push({ state: 'open', at: timestamp });
  }
  if (type === 'sideband.close' || type === 'sideband.error') {
    next.sidebandConnected = false;
    next.connectionTransitions.push({ state: type === 'sideband.error' ? 'error' : 'closed', at: timestamp });
  }
  next.connectionTransitions = next.connectionTransitions.slice(-30);
  return next;
}

export function tutorTraceMetrics(trace) {
  const state = createTutorRealtimeTraceState(trace);
  return {
    assistantTurns: state.assistantTurns,
    completedAssistantTurns: state.completedAssistantTurns,
    interruptedAssistantTurns: state.interruptedAssistantTurns,
    firstAudioLatenciesMs: state.firstAudioLatenciesMs,
    pendingLearnerResponseLatencyMs: state.pendingLearnerResponseLatencyMs,
    sidebandReconnects: state.sidebandReconnects
  };
}
