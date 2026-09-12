export const TUTOR_STORAGE_LIMITS = {
  maxSessions: 25,
  maxAudioSessions: 10,
  maxAudioBytes: 60 * 1024 * 1024,
  maxAudioDurationMsPerSession: 10 * 60 * 1000
};

export const TUTOR_SPEECH_RATE_LIMITS = {
  min: 0.25,
  max: 1.5,
  step: 0.05,
  default: 1
};

export const TUTOR_VOCABULARY_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
export const TUTOR_VOCABULARY_LEVEL_DEFAULT = 'N5';
export const TUTOR_TRANSCRIPTION_LANGUAGES = ['ja', 'en'];
export const TUTOR_TRANSCRIPTION_LANGUAGE_DEFAULT = 'ja';
export const TUTOR_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];
export const TUTOR_VOICE_DEFAULT = 'marin';

const TUTOR_SESSION_STATUSES = new Set(['planned', 'active', 'completed', 'error']);
const TUTOR_TURN_ROLES = new Set(['user', 'assistant']);
const TUTOR_TURN_STATUSES = new Set(['pending', 'streaming', 'completed', 'interrupted', 'failed', 'incomplete']);
const TUTOR_AUDIO_SPEAKERS = new Set(['user', 'assistant']);
const TUTOR_TRANSCRIPT_ALLOWED_CONTENT_REGEX = /[A-Za-z0-9\u3005\u3006\u3007\u303b\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff10-\uff19\uff21-\uff3a\uff41-\uff5a\uff66-\uff9d]/u;
const TUTOR_TRANSCRIPT_UNSUPPORTED_SCRIPT_REGEX = /[\u0370-\u03ff\u0400-\u052f\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0b00-\u0b7f\u0c00-\u0cff\u0d00-\u0d7f\u0e00-\u0e7f\u0f00-\u0fff\u1000-\u109f\u1100-\u11ff\u1780-\u17ff\u3130-\u318f\uac00-\ud7af]/u;

function cleanString(value, maxLength = 1000) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLength);
}

export function resolveTutorAssistantTurnId({ itemId = '', responseId = '', fallback = '' } = {}) {
  return cleanString(itemId, 120)
    || cleanString(responseId, 120)
    || cleanString(fallback, 120);
}

function cleanLooseString(value, maxLength = 1000) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.slice(0, maxLength);
}

function cleanStringList(value, maxItems = 12, maxLength = 240) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, maxItems)
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean);
}

function cleanTimestamp(value, fallback = Date.now()) {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function cleanJsonDetails(value, maxLength = 1600) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return cleanLooseString(value, maxLength);
  }
  try {
    return cleanLooseString(JSON.stringify(value), maxLength);
  } catch (error) {
    return '';
  }
}

export function normalizeTutorSpeechRate(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return TUTOR_SPEECH_RATE_LIMITS.default;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return TUTOR_SPEECH_RATE_LIMITS.default;
  }
  const clamped = Math.max(
    TUTOR_SPEECH_RATE_LIMITS.min,
    Math.min(TUTOR_SPEECH_RATE_LIMITS.max, numeric)
  );
  return Math.round(clamped / TUTOR_SPEECH_RATE_LIMITS.step) * TUTOR_SPEECH_RATE_LIMITS.step;
}

export function normalizeTutorVocabularyLevel(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return TUTOR_VOCABULARY_LEVELS.includes(normalized)
    ? normalized
    : TUTOR_VOCABULARY_LEVEL_DEFAULT;
}

export function normalizeTutorTranscriptionLanguage(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TUTOR_TRANSCRIPTION_LANGUAGES.includes(normalized)
    ? normalized
    : TUTOR_TRANSCRIPTION_LANGUAGE_DEFAULT;
}

export function normalizeTutorVoice(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return TUTOR_VOICES.includes(normalized)
    ? normalized
    : TUTOR_VOICE_DEFAULT;
}

export function isTutorTranscriptLanguageAllowed(value) {
  const text = cleanLooseString(value, 12000).trim();
  if (!text || TUTOR_TRANSCRIPT_UNSUPPORTED_SCRIPT_REGEX.test(text)) {
    return false;
  }
  return TUTOR_TRANSCRIPT_ALLOWED_CONTENT_REGEX.test(text);
}

export function normalizeTutorTranscriptText(value) {
  const text = cleanLooseString(value, 12000).replace(/\s+/g, ' ').trim();
  return isTutorTranscriptLanguageAllowed(text) ? text : '';
}

export function normalizeTutorTranscriptDelta(value) {
  const text = cleanLooseString(value, 1000);
  if (!text || TUTOR_TRANSCRIPT_UNSUPPORTED_SCRIPT_REGEX.test(text)) {
    return '';
  }
  return TUTOR_TRANSCRIPT_ALLOWED_CONTENT_REGEX.test(text) || /^[\s.,!?;:'"()[\]{}<>/\\、。！？・「」『』ー〜…-]+$/u.test(text)
    ? text
    : '';
}

export function isLikelyTutorPlaybackEcho({
  transcript = '',
  speechStartedDuringTutorAudio = false,
  durationMs = 0
} = {}) {
  if (!speechStartedDuringTutorAudio) {
    return false;
  }
  const text = normalizeTutorTranscriptText(transcript);
  const boundedDuration = Math.max(0, Number(durationMs) || 0);
  if (!text || !boundedDuration || boundedDuration > 1500) {
    return false;
  }
  const japaneseCharacters = text.match(/[々〆〇〻぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]/gu)?.length || 0;
  const englishWords = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length || 0;
  return japaneseCharacters + englishWords <= 6;
}

export function normalizeTutorProfile(profile = {}) {
  const now = Date.now();
  const source = profile && typeof profile === 'object' ? profile : {};
  const confidence = Number.isFinite(source.confidence)
    ? Math.max(0, Math.min(1, Number(source.confidence)))
    : 0;
  return {
    estimatedLevel: cleanString(source.estimatedLevel, 24) || 'unknown',
    vocabularyLevel: normalizeTutorVocabularyLevel(source.vocabularyLevel),
    confidence,
    strengths: cleanStringList(source.strengths, 10, 180),
    recurringMistakes: cleanStringList(source.recurringMistakes, 20, 220),
    targetGrammar: cleanStringList(source.targetGrammar, 20, 180),
    targetVocabulary: cleanStringList(source.targetVocabulary, 30, 160),
    lastPracticedTopics: cleanStringList(source.lastPracticedTopics, 20, 160),
    updatedAt: cleanTimestamp(source.updatedAt, now)
  };
}

export function normalizeTutorLessonPlan(plan = {}) {
  if (!plan || typeof plan !== 'object') {
    return null;
  }
  const title = cleanString(plan.title, 160);
  const topic = cleanString(plan.topic, 160);
  const objectives = cleanStringList(plan.objectives, 5, 240);
  const warmup = cleanString(plan.warmup, 1000);
  const drills = cleanStringList(plan.drills, 8, 360);
  const targetVocabulary = cleanStringList(plan.targetVocabulary, 20, 160);
  const targetGrammar = cleanStringList(plan.targetGrammar, 12, 180);
  const successCriteria = cleanStringList(plan.successCriteria, 6, 240);
  if (!title && !topic && !objectives.length && !drills.length) {
    return null;
  }
  return {
    title,
    topic,
    estimatedLevel: cleanString(plan.estimatedLevel, 24),
    objectives,
    warmup,
    drills,
    targetVocabulary,
    targetGrammar,
    successCriteria,
    createdAt: cleanTimestamp(plan.createdAt, Date.now())
  };
}

export function normalizeTutorFeedback(feedback = {}) {
  if (!feedback || typeof feedback !== 'object') {
    return null;
  }
  const summary = cleanString(feedback.summary, 1000);
  const correctedPhrase = cleanString(feedback.correctedPhrase, 500);
  const explanation = cleanString(feedback.explanation, 1400);
  const severity = cleanString(feedback.severity, 24) || 'note';
  const levelSignal = cleanString(feedback.levelSignal, 80);
  const focus = cleanStringList(feedback.focus, 8, 180);
  if (!summary && !correctedPhrase && !explanation && !focus.length) {
    return null;
  }
  return {
    summary,
    correctedPhrase,
    explanation,
    severity,
    levelSignal,
    focus,
    createdAt: cleanTimestamp(feedback.createdAt, Date.now())
  };
}

export function normalizeTutorSessionSummary(summary = {}) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }
  const overview = cleanString(summary.overview, 1400);
  const estimatedLevel = cleanString(summary.estimatedLevel, 24);
  const wins = cleanStringList(summary.wins, 8, 220);
  const corrections = cleanStringList(summary.corrections, 12, 280);
  const nextSteps = cleanStringList(summary.nextSteps, 8, 240);
  const profileUpdate = normalizeTutorProfile(summary.profileUpdate || {});
  if (!overview && !wins.length && !corrections.length && !nextSteps.length) {
    return null;
  }
  return {
    overview,
    estimatedLevel,
    wins,
    corrections,
    nextSteps,
    profileUpdate,
    createdAt: cleanTimestamp(summary.createdAt, Date.now())
  };
}

export function normalizeTutorAudioClips(clips = []) {
  if (!Array.isArray(clips)) {
    return [];
  }
  const now = Date.now();
  const seen = new Set();
  return clips
    .slice(0, 1000)
    .map((clip) => {
      if (!clip || typeof clip !== 'object') {
        return null;
      }
      const id = cleanString(clip.id, 120);
      const sessionId = cleanString(clip.sessionId, 120);
      const turnId = cleanString(clip.turnId, 120);
      const speaker = TUTOR_AUDIO_SPEAKERS.has(clip.speaker) ? clip.speaker : '';
      if (!id || !sessionId || !turnId || !speaker || seen.has(`${sessionId}:${id}`)) {
        return null;
      }
      seen.add(`${sessionId}:${id}`);
      return {
        id,
        sessionId,
        turnId,
        speaker,
        mimeType: cleanString(clip.mimeType, 80) || 'audio/webm',
        durationMs: Number.isFinite(clip.durationMs) ? Math.max(0, Math.trunc(clip.durationMs)) : 0,
        byteLength: Number.isFinite(clip.byteLength) ? Math.max(0, Math.trunc(clip.byteLength)) : 0,
        src: cleanLooseString(clip.src, 25 * 1024 * 1024),
        createdAt: cleanTimestamp(clip.createdAt, now)
      };
    })
    .filter(Boolean);
}

export function normalizeTutorRealtimeEvents(events = []) {
  if (!Array.isArray(events)) {
    return [];
  }
  const now = Date.now();
  return events
    .slice(-200)
    .map((event) => {
      if (!event || typeof event !== 'object') {
        return null;
      }
      const type = cleanString(event.type, 120);
      if (!type) {
        return null;
      }
      return {
        type,
        itemId: cleanString(event.itemId || event.item_id, 120),
        responseId: cleanString(event.responseId || event.response_id, 120),
        status: cleanString(event.status, 80),
        statusDetails: cleanJsonDetails(event.statusDetails || event.status_details, 1600),
        createdAt: cleanTimestamp(event.createdAt, now)
      };
    })
    .filter(Boolean);
}

export function normalizeTutorTurns(turns = []) {
  if (!Array.isArray(turns)) {
    return [];
  }
  const now = Date.now();
  const seen = new Set();
  return turns
    .slice(0, 300)
    .map((turn) => {
      if (!turn || typeof turn !== 'object') {
        return null;
      }
      const role = TUTOR_TURN_ROLES.has(turn.role) ? turn.role : '';
      const id = cleanString(turn.id, 120);
      if (!role || !id || seen.has(id)) {
        return null;
      }
      seen.add(id);
      return {
        id,
        role,
        itemId: cleanString(turn.itemId, 120),
        responseId: cleanString(turn.responseId, 120),
        transcript: cleanLooseString(turn.transcript, 12000),
        partialTranscript: cleanLooseString(turn.partialTranscript, 12000),
        status: TUTOR_TURN_STATUSES.has(turn.status) ? turn.status : '',
        statusDetails: cleanJsonDetails(turn.statusDetails, 1600),
        feedback: normalizeTutorFeedback(turn.feedback),
        audioClipIds: cleanStringList(turn.audioClipIds, 20, 120),
        startedAt: cleanTimestamp(turn.startedAt, now),
        endedAt: Number.isFinite(turn.endedAt) ? Math.trunc(turn.endedAt) : null
      };
    })
    .filter(Boolean);
}

export function normalizeTutorSessions(sessions = []) {
  if (!Array.isArray(sessions)) {
    return [];
  }
  const now = Date.now();
  const seen = new Set();
  return sessions
    .slice(0, 100)
    .map((session) => {
      if (!session || typeof session !== 'object') {
        return null;
      }
      const id = cleanString(session.id, 120);
      if (!id || seen.has(id)) {
        return null;
      }
      seen.add(id);
      const status = TUTOR_SESSION_STATUSES.has(session.status) ? session.status : 'completed';
      const startedAt = cleanTimestamp(session.startedAt, now);
      return {
        id,
        topic: cleanString(session.topic, 200),
        vocabularyLevel: normalizeTutorVocabularyLevel(session.vocabularyLevel),
        lessonPlan: normalizeTutorLessonPlan(session.lessonPlan),
        status,
        startedAt,
        endedAt: Number.isFinite(session.endedAt) ? Math.trunc(session.endedAt) : null,
        turns: normalizeTutorTurns(session.turns),
        summary: normalizeTutorSessionSummary(session.summary),
        debugEvents: normalizeTutorRealtimeEvents(session.debugEvents),
        model: cleanString(session.model, 80),
        voice: normalizeTutorVoice(session.voice),
        updatedAt: cleanTimestamp(session.updatedAt, startedAt)
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const left = Number.isFinite(a.updatedAt) ? a.updatedAt : a.startedAt;
      const right = Number.isFinite(b.updatedAt) ? b.updatedAt : b.startedAt;
      return right - left;
    });
}

export function pruneTutorStorage(sessions = [], audioClips = [], limits = {}) {
  const maxSessions = Number.isFinite(limits.maxSessions)
    ? Math.max(1, Math.trunc(limits.maxSessions))
    : TUTOR_STORAGE_LIMITS.maxSessions;
  const maxAudioSessions = Number.isFinite(limits.maxAudioSessions)
    ? Math.max(0, Math.trunc(limits.maxAudioSessions))
    : TUTOR_STORAGE_LIMITS.maxAudioSessions;
  const maxAudioBytes = Number.isFinite(limits.maxAudioBytes)
    ? Math.max(0, Math.trunc(limits.maxAudioBytes))
    : TUTOR_STORAGE_LIMITS.maxAudioBytes;
  const maxAudioDurationMsPerSession = Number.isFinite(limits.maxAudioDurationMsPerSession)
    ? Math.max(0, Math.trunc(limits.maxAudioDurationMsPerSession))
    : TUTOR_STORAGE_LIMITS.maxAudioDurationMsPerSession;

  const normalizedSessions = normalizeTutorSessions(sessions).slice(0, maxSessions);
  const keepSessionIds = new Set(normalizedSessions.map((session) => session.id));
  const audioSessionIds = new Set(normalizedSessions.slice(0, maxAudioSessions).map((session) => session.id));
  const durationBySession = new Map();
  let totalBytes = 0;

  const keptAudio = normalizeTutorAudioClips(audioClips)
    .filter((clip) => keepSessionIds.has(clip.sessionId) && audioSessionIds.has(clip.sessionId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((clip) => {
      const nextBytes = totalBytes + (clip.byteLength || 0);
      if (maxAudioBytes > 0 && nextBytes > maxAudioBytes) {
        return false;
      }
      const currentDuration = durationBySession.get(clip.sessionId) || 0;
      const nextDuration = currentDuration + (clip.durationMs || 0);
      if (maxAudioDurationMsPerSession > 0 && nextDuration > maxAudioDurationMsPerSession) {
        return false;
      }
      totalBytes = nextBytes;
      durationBySession.set(clip.sessionId, nextDuration);
      return true;
    });

  const clipIdsBySessionTurn = new Map();
  keptAudio.forEach((clip) => {
    const key = `${clip.sessionId}:${clip.turnId}`;
    const ids = clipIdsBySessionTurn.get(key) || [];
    ids.push(clip.id);
    clipIdsBySessionTurn.set(key, ids);
  });

  const prunedSessions = normalizedSessions.map((session) => ({
    ...session,
    turns: session.turns.map((turn) => ({
      ...turn,
      audioClipIds: (clipIdsBySessionTurn.get(`${session.id}:${turn.id}`) || [])
        .filter((id) => turn.audioClipIds.includes(id))
    }))
  }));

  return {
    sessions: prunedSessions,
    audioClips: keptAudio
  };
}

export function extractJsonObject(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch (innerError) {
        return null;
      }
    }
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch (innerError) {
        return null;
      }
    }
    return null;
  }
}
