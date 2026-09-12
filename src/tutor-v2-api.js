export const TUTOR_V2_API_PREFIX = '/api/tutor/v2';

async function parseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function requestJson(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`${TUTOR_V2_API_PREFIX}${path}`, {
    method,
    credentials: 'include',
    cache: method === 'GET' ? 'no-store' : 'default',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const error = new Error(payload?.error || `Tutor request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function getTutorV2Today(options) {
  return requestJson('/today', options);
}

export function createTutorV2Session(payload = {}, options = {}) {
  const path = options.diagnostic
    ? '/diagnostic'
    : (options.benchmark ? '/benchmark' : '/sessions');
  return requestJson(path, { method: 'POST', body: payload, signal: options.signal });
}

export function listTutorV2Sessions(options) {
  return requestJson('/sessions', options);
}

export function getTutorV2Session(sessionId, options = {}) {
  return requestJson(`/sessions/${encodeURIComponent(sessionId)}`, options);
}

export function endTutorV2Session(sessionId, options = {}) {
  return requestJson(`/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST',
    body: options.body || {},
    signal: options.signal
  });
}

export function deleteTutorV2Session(sessionId, options = {}) {
  return requestJson(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    signal: options.signal
  });
}

export function assessTutorV2Turn(turnId, payload = {}, options = {}) {
  return requestJson(`/turns/${encodeURIComponent(turnId)}/assessment`, {
    method: 'POST',
    body: payload,
    signal: options.signal
  });
}

export function getTutorV2Progress(options) {
  return requestJson('/progress', options);
}

export function getTutorV2Quality(options) {
  return requestJson('/quality', options);
}

export function getTutorV2Preferences(options) {
  return requestJson('/preferences', options);
}

export function updateTutorV2Preferences(payload = {}, options = {}) {
  return requestJson('/preferences', {
    method: 'PUT',
    body: payload,
    signal: options.signal
  });
}

export function importTutorV2LegacyHistory(payload = {}, options = {}) {
  return requestJson('/import-legacy', {
    method: 'POST',
    body: payload,
    signal: options.signal
  });
}

export function deleteTutorV2Data(options = {}) {
  return requestJson('/data', {
    method: 'DELETE',
    signal: options.signal
  });
}

export async function connectTutorV2Sdp(sessionId, offerSdp, options = {}) {
  const response = await fetch(
    `${TUTOR_V2_API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/connect`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/sdp' },
      body: offerSdp,
      signal: options.signal
    }
  );
  const answerSdp = await response.text();
  if (!response.ok) {
    let message = answerSdp;
    try {
      message = JSON.parse(answerSdp)?.error || answerSdp;
    } catch (error) {
      // Keep the SDP endpoint's plain-text error.
    }
    const failure = new Error(message || `Tutor connection failed (${response.status})`);
    failure.status = response.status;
    throw failure;
  }
  return answerSdp;
}

export async function uploadTutorV2Audio({
  sessionId,
  turnId,
  speaker,
  blob,
  durationMs = 0,
  speechRate = 0,
  pauseRatio = 0,
  responseLatencyMs = 0,
  pinned = false,
  benchmark = false,
  referenceText = '',
  signal
}) {
  const params = new URLSearchParams({
    sessionId,
    speaker: speaker === 'assistant' ? 'assistant' : 'user',
    durationMs: String(Math.max(0, Math.trunc(Number(durationMs) || 0)))
  });
  if (speechRate > 0) params.set('speechRate', String(Number(speechRate).toFixed(2)));
  if (pauseRatio >= 0) params.set('pauseRatio', String(Math.max(0, Math.min(1, Number(pauseRatio) || 0)).toFixed(3)));
  if (responseLatencyMs > 0) params.set('responseLatencyMs', String(Math.trunc(Number(responseLatencyMs) || 0)));
  if (pinned) params.set('pinned', '1');
  if (benchmark) params.set('benchmark', '1');
  if (referenceText) params.set('referenceText', referenceText.slice(0, 1000));
  const response = await fetch(
    `${TUTOR_V2_API_PREFIX}/turns/${encodeURIComponent(turnId)}/audio?${params}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': blob?.type || 'audio/webm' },
      body: blob,
      signal
    }
  );
  const payload = await parseJson(response);
  if (!response.ok) {
    const error = new Error(payload?.error || `Tutor audio upload failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
