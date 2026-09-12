import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import WebSocket from 'ws';
import { isTutorLiveModel, TUTOR_LIVE_MODEL, tutorLiveActivityContext } from '../src/tutor-live.js';
import { createTutorLiveCall, createTutorLiveDirector, createTutorLiveAudioBuffer, createTutorLiveGreeting, tutorLiveSidebandUrl } from './tutor-live-server.js';
import {
  createTutorRealtimeTraceState,
  reduceTutorRealtimeTrace,
  tutorTraceMetrics
} from '../src/tutor-realtime-trace.js';

import {
  advanceLessonState,
  applyAssessmentToMastery,
  buildDiagnosticBlueprint,
  buildLessonBlueprint,
  buildTutorV2RealtimeInstructions,
  createInitialActivityState,
  deriveSpeakingProfile,
  getCurrentActivity,
  getDueReviewItems,
  migrateLegacyTutorData,
  normalizeActivityState,
  normalizeBenchmarkResult,
  normalizeLessonBlueprint,
  normalizeMasteryEvidence,
  normalizeMasteryMap,
  normalizeMission,
  normalizeReviewItems,
  normalizeSpeakingProfile,
  normalizeTurnAssessment,
  selectDailyMission,
  TUTOR_SESSION_OUTCOME_JSON_SCHEMA,
  TUTOR_SKILL_GRAPH,
  TUTOR_SPEAKING_DIMENSIONS,
  TUTOR_TURN_ASSESSMENT_JSON_SCHEMA,
  TUTOR_V2_SCHEMA_VERSION
} from '../src/tutor-v2.js';
import {
  isLikelyTutorPlaybackEcho,
  normalizeTutorSpeechRate,
  normalizeTutorTranscriptText,
  normalizeTutorTranscriptionLanguage,
  normalizeTutorVoice,
  normalizeTutorVocabularyLevel,
  resolveTutorAssistantTurnId
} from '../src/tutor-utils.js';

export const TUTOR_V2_API_PREFIX = '/api/tutor/v2';
export const TUTOR_V2_MIGRATION_ID = 'tutor_v2_001';
export const TUTOR_V2_EVIDENCE_MIGRATION_ID = 'tutor_v2_002';
export const TUTOR_V2_QUALITY_MIGRATION_ID = 'tutor_v2_003';
export const TUTOR_V2_DEFAULT_REASONING_MODEL = 'gpt-5.6';
export const TUTOR_V2_DEFAULT_REALTIME_MODEL = TUTOR_LIVE_MODEL;
export const TUTOR_V2_AUDIO_RETENTION_DAYS = 30;

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BODY_BYTES = 25 * 1024 * 1024;
const MAX_EVENT_LOG = 240;
const MAX_RECENT_TURNS = 12;
const ACTIVITY_POLL_CACHE_MS = 300;
const SIDEBAND_INITIAL_DELAY_MS = 250;
const SIDEBAND_RETRY_DELAYS_MS = [400, 800, 1600, 3200];

export function isTutorSameOriginRequest(req) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers?.origin) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function cleanString(value, maxLength = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function extractRealtimeCallId(location = '') {
  const value = cleanString(location, 1000);
  if (!value) return '';
  try {
    const pathname = new URL(value, 'https://api.openai.com').pathname;
    const candidate = pathname.split('/').filter(Boolean).pop() || '';
    return /^rtc_[A-Za-z0-9_-]+$/.test(candidate) ? candidate : '';
  } catch (error) {
    return '';
  }
}

export function getSidebandRetryDelay(statusCode, attempt = 0) {
  if (Number(statusCode) !== 404) return null;
  const index = Math.max(0, Math.trunc(Number(attempt) || 0));
  return SIDEBAND_RETRY_DELAYS_MS[index] ?? null;
}

function cleanStringList(value, maxItems = 20, maxLength = 240) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => cleanString(item, maxLength)).filter(Boolean)
    : [];
}

function parseStoredJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text.trim();
  }
  const parts = [];
  (Array.isArray(payload?.output) ? payload.output : []).forEach((item) => {
    (Array.isArray(item?.content) ? item.content : []).forEach((part) => {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    });
  });
  return parts.join('\n').trim();
}

function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = ['guided', 'scenario', 'pronunciation', 'free'].includes(source.mode)
    ? source.mode
    : 'guided';
  const transcriptionMode = ['auto', 'ja', 'en'].includes(source.transcriptionMode)
    ? source.transcriptionMode
    : 'auto';
  return {
    mode,
    durationMinutes: Math.max(5, Math.min(30, Math.trunc(Number(source.durationMinutes) || 12))),
    speechRate: normalizeTutorSpeechRate(source.speechRate),
    voice: normalizeTutorVoice(source.voice),
    transcriptionMode,
    contentCeiling: normalizeTutorVocabularyLevel(source.contentCeiling),
    externalSpeechConsent: Boolean(source.externalSpeechConsent),
    topic: cleanString(source.topic, 200),
    goal: cleanString(source.goal, 300),
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Math.trunc(Number(source.updatedAt)) : Date.now()
  };
}

export function createTutorV2TranscriptionConfig(transcriptionMode = 'auto') {
  const mode = ['auto', 'ja', 'en'].includes(transcriptionMode)
    ? transcriptionMode
    : 'auto';
  return mode === 'auto'
    ? { model: 'gpt-realtime-whisper' }
    : {
      model: 'gpt-realtime-whisper',
      language: normalizeTutorTranscriptionLanguage(mode)
    };
}

export function createTutorV2RealtimeSessionConfig({
  model = 'gpt-realtime-2',
  profile = {},
  blueprint = {},
  activityState = {},
  preferences = {},
  voice = ''
} = {}) {
  const normalizedPreferences = normalizePreferences(preferences);
  const transcription = createTutorV2TranscriptionConfig(
    normalizedPreferences.transcriptionMode
  );
  return {
    type: 'realtime',
    model,
    instructions: buildTutorV2RealtimeInstructions({
      profile,
      blueprint,
      state: activityState,
      preferences: normalizedPreferences
    }),
    reasoning: { effort: 'low' },
    max_output_tokens: 900,
    tools: [],
    tool_choice: 'none',
    audio: {
      input: {
        transcription,
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'low',
          create_response: false,
          interrupt_response: false
        }
      },
      output: {
        voice: normalizeTutorVoice(voice || normalizedPreferences.voice),
        speed: normalizedPreferences.speechRate
      }
    }
  };
}

export function shouldRecordTutorMilestone(missionId, assessmentCount) {
  const id = cleanString(missionId, 160);
  const isMilestone = id.startsWith('diagnostic_') || id.startsWith('benchmark_');
  return isMilestone && Math.max(0, Number(assessmentCount) || 0) > 0;
}

export function reconcileTutorMilestoneState(profile = {}, sessions = [], now = Date.now()) {
  const normalizedProfile = normalizeSpeakingProfile(profile);
  const records = Array.isArray(sessions) ? sessions : [];
  const diagnosticRecords = records.filter((record) => cleanString(record?.missionId, 160).startsWith('diagnostic_'));
  const benchmarkRecords = records.filter((record) => cleanString(record?.missionId, 160).startsWith('benchmark_'));
  const hasDiagnosticEvidence = diagnosticRecords.some((record) => Number(record?.assessmentCount) > 0);
  const hasBenchmarkEvidence = benchmarkRecords.some((record) => Number(record?.assessmentCount) > 0);
  const invalidSessionIds = records
    .filter((record) => {
      const missionId = cleanString(record?.missionId, 160);
      const isMilestone = missionId.startsWith('diagnostic_') || missionId.startsWith('benchmark_');
      return isMilestone
        && record?.status === 'completed'
        && Number(record?.assessmentCount) <= 0
        && Number(record?.userTurnCount) <= 0;
    })
    .map((record) => sanitizeId(record?.sessionId))
    .filter(Boolean);
  const clearDiagnostic = Boolean(normalizedProfile.completedDiagnosticAt) && !hasDiagnosticEvidence;
  const clearBenchmark = Boolean(normalizedProfile.lastBenchmarkAt) && !hasBenchmarkEvidence;
  return {
    profile: clearDiagnostic || clearBenchmark
      ? normalizeSpeakingProfile({
        ...normalizedProfile,
        completedDiagnosticAt: clearDiagnostic ? null : normalizedProfile.completedDiagnosticAt,
        lastBenchmarkAt: clearBenchmark ? null : normalizedProfile.lastBenchmarkAt,
        updatedAt: now
      })
      : normalizedProfile,
    invalidSessionIds
  };
}

function levelForDimensionScore(score, confidence, fallback) {
  if (confidence < 0.25) return fallback;
  if (score >= 0.74) return 'B2';
  if (score >= 0.58) return 'B1';
  if (score >= 0.42) return 'A2';
  return 'A1';
}

function applyAssessmentDimensions(profile, assessment, now = Date.now()) {
  const normalized = normalizeSpeakingProfile(profile);
  const dimensions = { ...normalized.dimensions };
  TUTOR_SPEAKING_DIMENSIONS.forEach((dimension) => {
    if (dimension === 'phonology' && !Number.isFinite(assessment.acoustic?.accuracy)) return;
    const previous = dimensions[dimension];
    const confidence = dimension === 'phonology'
      ? assessment.acoustic.confidence
      : Math.max(0.35, assessment.transcriptConfidence * 0.8);
    const weight = 0.12 + (confidence * 0.24);
    const score = previous.score + (weight * (assessment.dimensions[dimension] - previous.score));
    const nextConfidence = previous.confidence + (0.16 * (confidence - previous.confidence));
    dimensions[dimension] = {
      level: levelForDimensionScore(score, nextConfidence, previous.level),
      score,
      confidence: nextConfidence,
      evidenceCount: previous.evidenceCount + 1
    };
  });
  const measured = Object.values(dimensions).filter((signal) => signal.evidenceCount > 0);
  const order = ['A1', 'A2', 'B1', 'B2'];
  const overallLevel = measured.length
    ? measured.map((signal) => signal.level).sort((a, b) => order.indexOf(a) - order.indexOf(b))[Math.floor((measured.length - 1) / 2)]
    : normalized.overallLevel;
  return normalizeSpeakingProfile({
    ...normalized,
    overallLevel,
    dimensions,
    updatedAt: now
  });
}

function applyProfileDimensionEvidence(profile, dimension, score, confidence, now = Date.now()) {
  if (!Number.isFinite(score) || !TUTOR_SPEAKING_DIMENSIONS.includes(dimension)) return profile;
  const normalized = normalizeSpeakingProfile(profile);
  const previous = normalized.dimensions[dimension];
  const weight = 0.12 + (Math.max(0, Math.min(1, confidence)) * 0.28);
  return normalizeSpeakingProfile({
    ...normalized,
    dimensions: {
      ...normalized.dimensions,
      [dimension]: {
        ...previous,
        score: previous.score + (weight * (score - previous.score)),
        confidence: previous.confidence + (0.18 * (confidence - previous.confidence)),
        evidenceCount: previous.evidenceCount + 1
      }
    },
    updatedAt: now
  });
}

export function rebuildTutorLearningState({
  profile = {},
  assessments = [],
  milestoneSessions = [],
  now = Date.now()
} = {}) {
  const previousProfile = normalizeSpeakingProfile(profile);
  let rebuiltProfile = normalizeSpeakingProfile({
    contentCeiling: previousProfile.contentCeiling,
    goal: previousProfile.goal,
    nativeLanguage: previousProfile.nativeLanguage,
    overallLevel: 'A1',
    prioritySkills: [],
    completedDiagnosticAt: null,
    lastBenchmarkAt: null,
    updatedAt: now
  });
  let mastery = {};
  let reviewItems = [];
  const strengthCounts = new Map();
  const mistakeCounts = new Map();
  const orderedAssessments = (Array.isArray(assessments) ? assessments : [])
    .map((assessment) => normalizeTurnAssessment(assessment))
    .filter((assessment) => assessment.turnId)
    .sort((left, right) => left.createdAt - right.createdAt);

  orderedAssessments.forEach((assessment) => {
    const observedAt = assessment.createdAt || now;
    if (assessment.taskCompleted && assessment.taskScore >= 0.75) {
      assessment.targetSkillIds.forEach((skillId) => {
        const title = TUTOR_SKILL_GRAPH.find((skill) => skill.id === skillId)?.title || skillId;
        strengthCounts.set(title, (strengthCounts.get(title) || 0) + 1);
      });
    }
    [
      ...assessment.grammarFindings,
      ...assessment.vocabularyFindings,
      ...(assessment.correction.required && assessment.correction.confidence >= 0.65
        ? [assessment.correction.explanation || assessment.correction.corrected]
        : [])
    ].map((finding) => cleanString(finding, 220)).filter(Boolean).forEach((finding) => {
      mistakeCounts.set(finding, (mistakeCounts.get(finding) || 0) + 1);
    });
    const updated = applyAssessmentToMastery({
      mastery,
      reviewItems,
      assessment,
      now: observedAt
    });
    mastery = updated.mastery;
    reviewItems = updated.reviewItems;
    rebuiltProfile = deriveSpeakingProfile(rebuiltProfile, mastery);
    rebuiltProfile = applyAssessmentDimensions(rebuiltProfile, {
      ...assessment,
      acoustic: {
        ...assessment.acoustic,
        accuracy: null
      }
    }, observedAt);
    if (Number.isFinite(assessment.acoustic?.accuracy)) {
      rebuiltProfile = applyProfileDimensionEvidence(
        rebuiltProfile,
        'phonology',
        assessment.acoustic.accuracy,
        assessment.acoustic.confidence,
        observedAt
      );
    }
    if (Number.isFinite(assessment.acoustic?.fluency)) {
      rebuiltProfile = applyProfileDimensionEvidence(
        rebuiltProfile,
        'fluency',
        assessment.acoustic.fluency,
        assessment.acoustic.confidence,
        observedAt
      );
    }
  });

  const completedMilestones = (Array.isArray(milestoneSessions) ? milestoneSessions : [])
    .filter((session) => session?.status === 'completed' && Number(session.assessmentCount) > 0);
  const latestMilestoneAt = (prefix) => completedMilestones
    .filter((session) => cleanString(session.missionId, 160).startsWith(prefix))
    .reduce((latest, session) => Math.max(latest, Number(session.endedAt) || Number(session.updatedAt) || 0), 0) || null;
  const rankedSignals = (counts, limit) => Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
  rebuiltProfile = normalizeSpeakingProfile({
    ...rebuiltProfile,
    strengths: rankedSignals(strengthCounts, 12),
    recurringMistakes: rankedSignals(mistakeCounts, 20),
    completedDiagnosticAt: latestMilestoneAt('diagnostic_'),
    lastBenchmarkAt: latestMilestoneAt('benchmark_'),
    updatedAt: now
  });
  return {
    profile: rebuiltProfile,
    mastery: normalizeMasteryMap(mastery),
    reviewItems: normalizeReviewItems(reviewItems)
  };
}

function sanitizeId(value, fallback = '') {
  const safe = cleanString(value, 160).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return safe || fallback;
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function mimeTypeToExtension(mimeType) {
  const normalized = cleanString(mimeType, 120).toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  return 'webm';
}

async function readRequestBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readRequestJson(req) {
  const bytes = await readRequestBody(req, MAX_JSON_BODY_BYTES);
  if (!bytes.length) return {};
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const invalid = new Error('Invalid JSON body');
    invalid.status = 400;
    throw invalid;
  }
}

function writeSdp(res, statusCode, value) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/sdp',
    'Cache-Control': 'no-store'
  });
  res.end(value);
}

function fallbackAssessment({ turnId, activity, transcript, acoustic = {} }) {
  const hasContent = cleanString(transcript, 12000).length >= 2;
  const taskScore = hasContent ? 0.65 : 0.2;
  return normalizeTurnAssessment({
    id: createId('assessment'),
    turnId,
    activityId: activity?.id || '',
    transcript,
    transcriptConfidence: hasContent ? 0.55 : 0.2,
    responseLatencyMs: acoustic?.responseLatencyMs || 0,
    understood: hasContent,
    taskCompleted: hasContent,
    taskScore,
    dimensions: {
      interaction: taskScore,
      production: taskScore,
      listening: 0.5,
      grammar: 0.5,
      vocabulary: 0.5,
      fluency: acoustic?.speechRate ? 0.55 : 0.5,
      phonology: acoustic?.accuracy ?? 0.5
    },
    targetSkillIds: activity?.targetSkillIds || [],
    correction: {
      required: false,
      confidence: 0,
      category: '',
      original: '',
      corrected: '',
      explanation: '',
      requiresRepair: false
    },
    repairSuccessful: false,
    acoustic,
    notes: ['Automated fallback assessment; no correction was inferred.']
  });
}

function buildAssessmentInstructions() {
  return [
    'You are the private assessment layer for a Japanese speaking tutor.',
    'Score only evidence present in the learner turn and current activity.',
    'A transcript is an ASR hypothesis, not proof of pronunciation. Do not report a pronunciation error unless acoustic evidence explicitly supports it.',
    'Require repair only for a meaning-blocking issue, a missed target, or one high-confidence grammar/word-choice error worth immediate practice.',
    'When the mission is a diagnostic, measure the sample without requiring repair or treating a learner clarification question as a speaking mistake.',
    'Never invent target skill IDs. Use only IDs supplied in the input.',
    'Keep any correction short, natural, and at the learner vocabulary ceiling.',
    'Return the requested strict JSON object.'
  ].join('\n');
}

function buildOutcomeInstructions() {
  return [
    'You summarize a Japanese speaking practice session for the learner.',
    'Use only the supplied assessments and activity evidence.',
    'Choose one priority weakness, not a long list.',
    'Make the next mission specific and achievable.',
    'Return the requested strict JSON object.'
  ].join('\n');
}

export function createTutorV2Service({
  apiKey = '',
  realtimeModel = TUTOR_V2_DEFAULT_REALTIME_MODEL,
  defaultVoice = 'marin',
  reasoningModel = TUTOR_V2_DEFAULT_REASONING_MODEL,
  workspaceDbPath,
  audioDirectory,
  runSqlite,
  sqlString,
  parseSqliteJson,
  writeJson,
  getActor,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  azureSpeechKey = '',
  azureSpeechRegion = '',
  audioMaxBytes = 60 * 1024 * 1024,
  logger = console
} = {}) {
  if (!workspaceDbPath || !audioDirectory || typeof runSqlite !== 'function' || typeof sqlString !== 'function') {
    throw new Error('Tutor v2 service is missing persistence dependencies');
  }

  const controllers = new Map();
  const configuredDefaultVoice = normalizeTutorVoice(defaultVoice);
  const boundedAudioMaxBytes = Math.max(1024 * 1024, Number(audioMaxBytes) || (60 * 1024 * 1024));
  let lastPruneAt = 0;

  async function ensureSchema() {
    await fs.mkdir(audioDirectory, { recursive: true });
    const now = Date.now();
    const sql = `
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_tutor_live_fragments (
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        role TEXT NOT NULL,
        delta TEXT NOT NULL,
        start_ms REAL NOT NULL,
        end_ms REAL NOT NULL,
        PRIMARY KEY(user_id, session_id, event_id)
      );
      INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('tutor_v2_004_live', ${now});
      INSERT INTO users (id, email, name, picture, created_at, updated_at)
      VALUES ('local', '', 'Local learner', '', ${now}, ${now})
      ON CONFLICT(id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS user_tutor_profiles_v2 (
        user_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 2,
        profile TEXT NOT NULL DEFAULT '{}',
        preferences TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_tutor_skill_mastery (
        user_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, skill_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_tutor_review_items (
        user_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        due_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, review_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tutor_reviews_due
        ON user_tutor_review_items(user_id, due_at);
      CREATE TABLE IF NOT EXISTS user_tutor_sessions_v2 (
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        mission TEXT NOT NULL,
        blueprint TEXT NOT NULL,
        activity_state TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT '{}',
        model TEXT NOT NULL DEFAULT '',
        voice TEXT NOT NULL DEFAULT '',
        event_log TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, session_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tutor_v2_sessions_updated
        ON user_tutor_sessions_v2(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS user_tutor_turn_assessments (
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        transcript TEXT NOT NULL DEFAULT '',
        assessment TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, session_id, turn_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_tutor_turns_v2 (
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        role TEXT NOT NULL,
        item_id TEXT NOT NULL DEFAULT '',
        response_id TEXT NOT NULL DEFAULT '',
        transcript TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, session_id, turn_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tutor_v2_turns_session
        ON user_tutor_turns_v2(user_id, session_id, started_at);
      CREATE TABLE IF NOT EXISTS user_tutor_mastery_evidence (
        user_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        source TEXT NOT NULL,
        score REAL NOT NULL,
        confidence REAL NOT NULL,
        payload TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, evidence_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tutor_mastery_evidence_skill
        ON user_tutor_mastery_evidence(user_id, skill_id, observed_at DESC);
      CREATE TABLE IF NOT EXISTS user_tutor_audio_v2 (
        user_id TEXT NOT NULL,
        clip_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        speaker TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        benchmark INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, clip_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tutor_v2_audio_expiry
        ON user_tutor_audio_v2(expires_at, pinned, benchmark);
      CREATE TABLE IF NOT EXISTS user_tutor_audio_analysis_v2 (
        user_id TEXT NOT NULL,
        clip_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, clip_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_tutor_benchmarks_v2 (
        user_id TEXT NOT NULL,
        benchmark_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, benchmark_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_tutor_legacy_sessions_v2 (
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, session_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_tutor_quality_metrics_v2 (
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, session_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_tutor_correction_labels_v2 (
        user_id TEXT NOT NULL,
        label_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        accurate INTEGER NOT NULL,
        evaluator TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, label_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO schema_migrations (id, applied_at)
      VALUES (${sqlString(TUTOR_V2_MIGRATION_ID)}, ${now})
      ON CONFLICT(id) DO NOTHING;
      INSERT INTO schema_migrations (id, applied_at)
      VALUES (${sqlString(TUTOR_V2_EVIDENCE_MIGRATION_ID)}, ${now})
      ON CONFLICT(id) DO NOTHING;
      INSERT INTO schema_migrations (id, applied_at)
      VALUES (${sqlString(TUTOR_V2_QUALITY_MIGRATION_ID)}, ${now})
      ON CONFLICT(id) DO NOTHING;
    `;
    await runSqlite(workspaceDbPath, sql);
    await pruneExpiredAudio();
  }

  async function ensureActorRow(actor) {
    const now = Date.now();
    const userId = cleanString(actor?.id, 200) || 'local';
    const sql = `
      INSERT INTO users (id, email, name, picture, created_at, updated_at)
      VALUES (
        ${sqlString(userId)},
        ${sqlString(cleanString(actor?.email, 320))},
        ${sqlString(cleanString(actor?.name, 200) || (userId === 'local' ? 'Local learner' : ''))},
        ${sqlString(cleanString(actor?.picture, 1000))},
        ${now},
        ${now}
      )
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        picture = excluded.picture,
        updated_at = excluded.updated_at;
    `;
    await runSqlite(workspaceDbPath, sql);
    return userId;
  }

  async function requireActor(req, res) {
    const actor = await getActor(req);
    if (!actor) {
      writeJson(res, 401, { error: 'Authentication required' });
      return null;
    }
    const userId = await ensureActorRow(actor);
    return { ...actor, id: userId };
  }

  async function readUserLearningState(userId) {
    const profileSql = `
      SELECT profile, preferences
      FROM user_tutor_profiles_v2
      WHERE user_id = ${sqlString(userId)}
      LIMIT 1;
    `;
    const masterySql = `
      SELECT skill_id, payload
      FROM user_tutor_skill_mastery
      WHERE user_id = ${sqlString(userId)};
    `;
    const reviewsSql = `
      SELECT payload
      FROM user_tutor_review_items
      WHERE user_id = ${sqlString(userId)}
      ORDER BY due_at ASC;
    `;
    const [profileRows, masteryRows, reviewRows] = await Promise.all([
      runSqlite(workspaceDbPath, profileSql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, masterySql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, reviewsSql, { json: true }).then(parseSqliteJson)
    ]);
    let profile = normalizeSpeakingProfile(parseStoredJson(profileRows[0]?.profile, {}));
    const preferences = normalizePreferences(parseStoredJson(
      profileRows[0]?.preferences,
      { voice: configuredDefaultVoice }
    ));
    const mastery = normalizeMasteryMap(Object.fromEntries(masteryRows.map((row) => [
      row.skill_id,
      parseStoredJson(row.payload, {})
    ])));
    const reviewItems = normalizeReviewItems(reviewRows.map((row) => parseStoredJson(row.payload, {})));
    if (profile.completedDiagnosticAt || profile.lastBenchmarkAt) {
      const milestoneRows = parseSqliteJson(await runSqlite(workspaceDbPath, `
        SELECT
          session.session_id,
          session.status,
          session.mission,
          (
            SELECT COUNT(*)
            FROM user_tutor_turn_assessments assessment
            WHERE assessment.user_id = session.user_id
              AND assessment.session_id = session.session_id
          ) AS assessment_count,
          (
            SELECT COUNT(*)
            FROM user_tutor_turns_v2 turn_record
            WHERE turn_record.user_id = session.user_id
              AND turn_record.session_id = session.session_id
              AND turn_record.role = 'user'
          ) AS user_turn_count
        FROM user_tutor_sessions_v2 session
        WHERE session.user_id = ${sqlString(userId)}
          AND session.status = 'completed';
      `, { json: true }));
      const previousDiagnosticAt = profile.completedDiagnosticAt;
      const previousBenchmarkAt = profile.lastBenchmarkAt;
      const reconciled = reconcileTutorMilestoneState(profile, milestoneRows.map((row) => ({
        sessionId: row.session_id,
        status: row.status,
        missionId: cleanString(parseStoredJson(row.mission, {})?.id, 160),
        assessmentCount: Number(row.assessment_count) || 0,
        userTurnCount: Number(row.user_turn_count) || 0
      })));
      profile = reconciled.profile;
      for (const sessionId of reconciled.invalidSessionIds) {
        await deleteSession({ id: userId }, sessionId, { rebuildLearningState: false });
      }
      if (profile.completedDiagnosticAt !== previousDiagnosticAt
        || profile.lastBenchmarkAt !== previousBenchmarkAt) {
        await writeUserLearningState(userId, {
          profile,
          preferences,
          mastery,
          reviewItems
        });
      }
    }
    return { profile, preferences, mastery, reviewItems };
  }

  async function writeUserLearningState(userId, { profile, preferences, mastery, reviewItems }) {
    const now = Date.now();
    const normalizedProfile = normalizeSpeakingProfile(profile);
    const normalizedPreferences = normalizePreferences(preferences);
    const normalizedMastery = normalizeMasteryMap(mastery);
    const normalizedReviews = normalizeReviewItems(reviewItems);
    const statements = [`
      INSERT INTO user_tutor_profiles_v2 (
        user_id, schema_version, profile, preferences, created_at, updated_at
      ) VALUES (
        ${sqlString(userId)},
        ${TUTOR_V2_SCHEMA_VERSION},
        ${sqlString(JSON.stringify(normalizedProfile))},
        ${sqlString(JSON.stringify(normalizedPreferences))},
        ${now},
        ${now}
      )
      ON CONFLICT(user_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        profile = excluded.profile,
        preferences = excluded.preferences,
        updated_at = excluded.updated_at;
    `, `DELETE FROM user_tutor_skill_mastery WHERE user_id = ${sqlString(userId)};`];
    Object.values(normalizedMastery).forEach((record) => {
      statements.push(`
        INSERT INTO user_tutor_skill_mastery (user_id, skill_id, payload, updated_at)
        VALUES (
          ${sqlString(userId)},
          ${sqlString(record.skillId)},
          ${sqlString(JSON.stringify(record))},
          ${now}
        )
        ON CONFLICT(user_id, skill_id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at;
      `);
    });
    statements.push(`DELETE FROM user_tutor_review_items WHERE user_id = ${sqlString(userId)};`);
    normalizedReviews.forEach((item) => {
      statements.push(`
        INSERT INTO user_tutor_review_items (
          user_id, review_id, skill_id, due_at, payload, updated_at
        ) VALUES (
          ${sqlString(userId)},
          ${sqlString(item.id)},
          ${sqlString(item.skillId)},
          ${item.dueAt},
          ${sqlString(JSON.stringify(item))},
          ${now}
        );
      `);
    });
    await runSqlite(workspaceDbPath, `BEGIN;${statements.join('\n')}COMMIT;`);
    return {
      profile: normalizedProfile,
      preferences: normalizedPreferences,
      mastery: normalizedMastery,
      reviewItems: normalizedReviews
    };
  }

  async function rebuildUserLearningState(userId) {
    const profileSql = `
      SELECT profile, preferences
      FROM user_tutor_profiles_v2
      WHERE user_id = ${sqlString(userId)}
      LIMIT 1;
    `;
    const assessmentSql = `
      SELECT assessment
      FROM user_tutor_turn_assessments
      WHERE user_id = ${sqlString(userId)}
      ORDER BY created_at ASC;
    `;
    const milestoneSql = `
      SELECT session.session_id, session.status, session.mission,
        session.ended_at, session.updated_at,
        (
          SELECT COUNT(*)
          FROM user_tutor_turn_assessments assessment
          WHERE assessment.user_id = session.user_id
            AND assessment.session_id = session.session_id
        ) AS assessment_count
      FROM user_tutor_sessions_v2 session
      WHERE session.user_id = ${sqlString(userId)}
        AND session.status = 'completed';
    `;
    const [profileRows, assessmentRows, milestoneRows] = await Promise.all([
      runSqlite(workspaceDbPath, profileSql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, assessmentSql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, milestoneSql, { json: true }).then(parseSqliteJson)
    ]);
    const currentProfile = normalizeSpeakingProfile(parseStoredJson(profileRows[0]?.profile, {}));
    const preferences = normalizePreferences(parseStoredJson(
      profileRows[0]?.preferences,
      { voice: configuredDefaultVoice }
    ));
    const rebuilt = rebuildTutorLearningState({
      profile: currentProfile,
      assessments: assessmentRows.map((row) => parseStoredJson(row.assessment, {})),
      milestoneSessions: milestoneRows.map((row) => ({
        sessionId: row.session_id,
        status: row.status,
        missionId: cleanString(parseStoredJson(row.mission, {})?.id, 160),
        assessmentCount: Number(row.assessment_count) || 0,
        endedAt: Number(row.ended_at) || null,
        updatedAt: Number(row.updated_at) || 0
      })),
      now: Date.now()
    });
    const learningState = await writeUserLearningState(userId, {
      ...rebuilt,
      preferences
    });
    controllers.forEach((controller) => {
      if (controller.userId !== userId) return;
      controller.profile = learningState.profile;
      controller.mastery = learningState.mastery;
      controller.reviewItems = learningState.reviewItems;
      if (controller.status === 'active') {
        sendSideband(controller, {
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: buildTutorV2RealtimeInstructions({
              profile: controller.profile,
              blueprint: controller.blueprint,
              state: controller.activityState,
              preferences: controller.preferences
            })
          }
        });
      }
    });
    return learningState;
  }

  function serializeController(controller) {
    return {
      id: controller.id,
      schemaVersion: TUTOR_V2_SCHEMA_VERSION,
      status: controller.status,
      mission: controller.mission,
      blueprint: controller.blueprint,
      activityState: controller.activityState,
      currentActivity: getCurrentActivity(controller.blueprint, controller.activityState),
      latestAssessment: controller.latestAssessment || null,
      turns: controller.recentTurns.slice(-MAX_RECENT_TURNS),
      outcome: controller.outcome || null,
      model: controller.model,
      audioClips: controller.liveAudioClips || [],
      voice: controller.voice,
      startedAt: controller.startedAt,
      endedAt: controller.endedAt || null,
      updatedAt: controller.updatedAt,
      metrics: controller.metrics,
      director: {
        status: controller.directorStatus || 'idle',
        processingTurnId: controller.processingTurnId || '',
        sidebandConnected: controller.ws?.readyState === WebSocket.OPEN
      }
    };
  }

  async function persistController(controller) {
    if (controller.status === 'deleted') return;
    const sql = `
      INSERT INTO user_tutor_sessions_v2 (
        user_id, session_id, status, mode, mission, blueprint, activity_state,
        outcome, model, voice, event_log, started_at, ended_at, updated_at
      ) VALUES (
        ${sqlString(controller.userId)},
        ${sqlString(controller.id)},
        ${sqlString(controller.status)},
        ${sqlString(controller.mission.mode)},
        ${sqlString(JSON.stringify(controller.mission))},
        ${sqlString(JSON.stringify(controller.blueprint))},
        ${sqlString(JSON.stringify(controller.activityState))},
        ${sqlString(JSON.stringify(controller.outcome || {}))},
        ${sqlString(controller.model)},
        ${sqlString(controller.voice)},
        ${sqlString(JSON.stringify(controller.eventLog.slice(-MAX_EVENT_LOG)))},
        ${controller.startedAt},
        ${controller.endedAt || 'NULL'},
        ${controller.updatedAt}
      )
      ON CONFLICT(user_id, session_id) DO UPDATE SET
        status = excluded.status,
        mode = excluded.mode,
        mission = excluded.mission,
        blueprint = excluded.blueprint,
        activity_state = excluded.activity_state,
        outcome = excluded.outcome,
        model = excluded.model,
        voice = excluded.voice,
        event_log = excluded.event_log,
        ended_at = excluded.ended_at,
        updated_at = excluded.updated_at;
      INSERT INTO user_tutor_quality_metrics_v2 (user_id, session_id, payload, updated_at)
      VALUES (
        ${sqlString(controller.userId)},
        ${sqlString(controller.id)},
        ${sqlString(JSON.stringify(controller.metrics))},
        ${controller.updatedAt}
      )
      ON CONFLICT(user_id, session_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at;
    `;
    await runSqlite(workspaceDbPath, sql);
  }

  async function readController(userId, sessionId) {
    const key = `${userId}:${sessionId}`;
    if (controllers.has(key)) {
      return controllers.get(key);
    }
    const sql = `
      SELECT *
      FROM user_tutor_sessions_v2
      WHERE user_id = ${sqlString(userId)}
        AND session_id = ${sqlString(sessionId)}
      LIMIT 1;
    `;
    const turnsSql = `
      SELECT turn_id, role, item_id, response_id, transcript, status, started_at, ended_at
      FROM user_tutor_turns_v2
      WHERE user_id = ${sqlString(userId)} AND session_id = ${sqlString(sessionId)}
      ORDER BY started_at DESC
      LIMIT ${MAX_RECENT_TURNS};
    `;
    const qualitySql = `
      SELECT payload
      FROM user_tutor_quality_metrics_v2
      WHERE user_id = ${sqlString(userId)} AND session_id = ${sqlString(sessionId)}
      LIMIT 1;
    `;
    const assessmentSql = `
      SELECT assessment
      FROM user_tutor_turn_assessments
      WHERE user_id = ${sqlString(userId)} AND session_id = ${sqlString(sessionId)}
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const [rows, turnRows, qualityRows, assessmentRows] = await Promise.all([
      runSqlite(workspaceDbPath, sql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, turnsSql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, qualitySql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, assessmentSql, { json: true }).then(parseSqliteJson)
    ]);
    if (!rows.length) return null;
    const row = rows[0];
    const blueprint = normalizeLessonBlueprint(parseStoredJson(row.blueprint, {}));
    const storedMetrics = parseStoredJson(qualityRows[0]?.payload, {});
    const trace = createTutorRealtimeTraceState(storedMetrics);
    const controller = {
      id: sessionId,
      userId,
      status: row.status || 'completed',
      mission: normalizeMission(parseStoredJson(row.mission, {})),
      blueprint,
      activityState: normalizeActivityState(parseStoredJson(row.activity_state, {}), blueprint),
      latestAssessment: assessmentRows.length
        ? normalizeTurnAssessment(parseStoredJson(assessmentRows[0]?.assessment, {}))
        : null,
      outcome: parseStoredJson(row.outcome, null),
      model: row.model || realtimeModel,
      voice: row.voice || 'marin',
      startedAt: Number(row.started_at) || Date.now(),
      endedAt: Number(row.ended_at) || null,
      updatedAt: Number(row.updated_at) || Date.now(),
      eventLog: parseStoredJson(row.event_log, []),
      recentTurns: turnRows.reverse().map((turn) => ({
        turnId: turn.turn_id,
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        itemId: turn.item_id || '',
        responseId: turn.response_id || '',
        transcript: turn.transcript || '',
        status: turn.status || '',
        startedAt: Number(turn.started_at) || 0,
        endedAt: Number(turn.ended_at) || null,
        at: Number(turn.ended_at || turn.started_at) || 0
      })),
      assessmentTurnIds: new Set(),
      ws: null,
      callId: '',
      sidebandRetryTimer: null,
      sidebandAttempt: 0,
      profile: null,
      preferences: null,
      mastery: null,
      reviewItems: null,
      metrics: {
        ...storedMetrics,
        userTurns: Number(storedMetrics.userTurns) || 0,
        ...tutorTraceMetrics(trace)
      },
      trace,
      pendingResponseCreatedAt: null,
      directorStatus: 'idle',
      processingTurnId: '',
      lastTutorAudioStoppedAt: null,
      pendingLearnerResponseLatencyMs: 0,
      tutorAudioOutputActive: false,
      activeUserSpeechItemId: '',
      userSpeechWindows: new Map(),
      lastReadAt: Date.now()
    };
    controllers.set(key, controller);
    return controller;
  }

  function appendEvent(controller, event) {
    const type = cleanString(event?.type, 140);
    if (!type) return;
    controller.eventLog.push({
      type,
      itemId: cleanString(event?.item_id || event?.item?.id, 140),
      responseId: cleanString(event?.response_id || event?.response?.id, 140),
      status: cleanString(event?.response?.status || event?.status, 80),
      detail: cleanString(event?.detail, 500),
      requestId: cleanString(event?.requestId, 160),
      at: Date.now()
    });
    controller.eventLog = controller.eventLog.slice(-MAX_EVENT_LOG);
    controller.updatedAt = Date.now();
  }

  async function requestStructured({ name, schema, instructions, input, maxOutputTokens = 1200 }) {
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: reasoningModel,
        reasoning: { effort: 'low' },
        max_output_tokens: maxOutputTokens,
        instructions,
        input,
        text: {
          format: {
            type: 'json_schema',
            name,
            strict: true,
            schema
          }
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || 'OpenAI structured response failed');
      error.status = response.status;
      throw error;
    }
    const text = extractOpenAiText(payload);
    const parsed = parseStoredJson(text, null);
    if (!parsed) throw new Error('OpenAI returned invalid structured output');
    return parsed;
  }

  async function persistAssessment(controller, assessment) {
    const now = Date.now();
    const sql = `
      INSERT INTO user_tutor_turn_assessments (
        user_id, session_id, turn_id, transcript, assessment, created_at, updated_at
      ) VALUES (
        ${sqlString(controller.userId)},
        ${sqlString(controller.id)},
        ${sqlString(assessment.turnId)},
        ${sqlString(assessment.transcript)},
        ${sqlString(JSON.stringify(assessment))},
        ${now},
        ${now}
      )
      ON CONFLICT(user_id, session_id, turn_id) DO UPDATE SET
        transcript = excluded.transcript,
        assessment = excluded.assessment,
        updated_at = excluded.updated_at;
    `;
    await runSqlite(workspaceDbPath, sql);
  }

  async function persistTranscriptTurn(controller, turn = {}) {
    const turnId = sanitizeId(turn.turnId || turn.itemId || turn.responseId, createId('turn'));
    const role = turn.role === 'assistant' ? 'assistant' : 'user';
    const now = Date.now();
    await runSqlite(workspaceDbPath, `
      INSERT INTO user_tutor_turns_v2 (
        user_id, session_id, turn_id, role, item_id, response_id,
        transcript, status, started_at, ended_at, updated_at
      ) VALUES (
        ${sqlString(controller.userId)},
        ${sqlString(controller.id)},
        ${sqlString(turnId)},
        ${sqlString(role)},
        ${sqlString(cleanString(turn.itemId, 140))},
        ${sqlString(cleanString(turn.responseId, 140))},
        ${sqlString(cleanString(turn.transcript, 12000))},
        ${sqlString(cleanString(turn.status, 80))},
        ${Number(turn.startedAt) || now},
        ${Number(turn.endedAt) || 'NULL'},
        ${now}
      )
      ON CONFLICT(user_id, session_id, turn_id) DO UPDATE SET
        item_id = CASE WHEN excluded.item_id != '' THEN excluded.item_id ELSE item_id END,
        response_id = CASE WHEN excluded.response_id != '' THEN excluded.response_id ELSE response_id END,
        transcript = CASE WHEN excluded.transcript != '' THEN excluded.transcript ELSE transcript END,
        status = CASE WHEN excluded.status != '' THEN excluded.status ELSE status END,
        ended_at = COALESCE(excluded.ended_at, ended_at),
        updated_at = excluded.updated_at;
    `);
    return turnId;
  }

  async function persistEvidence(controller, evidenceItems = []) {
    const normalized = evidenceItems.map(normalizeMasteryEvidence).filter(Boolean);
    if (!normalized.length) return;
    const statements = normalized.map((evidence) => `
      INSERT INTO user_tutor_mastery_evidence (
        user_id, evidence_id, session_id, turn_id, skill_id, source,
        score, confidence, payload, observed_at
      ) VALUES (
        ${sqlString(controller.userId)},
        ${sqlString(evidence.id)},
        ${sqlString(controller.id)},
        ${sqlString(evidence.turnId)},
        ${sqlString(evidence.skillId)},
        ${sqlString(evidence.source)},
        ${evidence.score},
        ${evidence.confidence},
        ${sqlString(JSON.stringify(evidence))},
        ${evidence.observedAt}
      )
      ON CONFLICT(user_id, evidence_id) DO UPDATE SET
        payload = excluded.payload,
        score = excluded.score,
        confidence = excluded.confidence,
        observed_at = excluded.observed_at;
    `);
    await runSqlite(workspaceDbPath, `BEGIN;${statements.join('\n')}COMMIT;`);
  }

  function assessmentEvidence(controller, assessment) {
    const dimensionAverage = Object.values(assessment.dimensions)
      .reduce((sum, value) => sum + value, 0) / Math.max(1, Object.keys(assessment.dimensions).length);
    const score = (assessment.taskScore * 0.65) + (dimensionAverage * 0.35);
    const confidence = Math.max(0.35, assessment.transcriptConfidence, assessment.correction.confidence);
    const evidence = assessment.targetSkillIds.map((skillId) => normalizeMasteryEvidence({
      id: `evidence_${assessment.id}_${skillId.replace(/[^a-z0-9]+/gi, '_')}`,
      skillId,
      source: 'task',
      sessionId: controller.id,
      turnId: assessment.turnId,
      activityId: assessment.activityId,
      score,
      confidence,
      repairSuccessful: assessment.repairSuccessful,
      summary: assessment.taskCompleted ? 'Communicative task completed.' : 'Target attempted.',
      observedAt: assessment.createdAt
    })).filter(Boolean);
    if (assessment.repairSuccessful) {
      assessment.targetSkillIds.forEach((skillId) => {
        const repair = normalizeMasteryEvidence({
          id: `repair_${assessment.id}_${skillId.replace(/[^a-z0-9]+/gi, '_')}`,
          skillId,
          source: 'repair',
          sessionId: controller.id,
          turnId: assessment.turnId,
          activityId: assessment.activityId,
          score: Math.max(assessment.taskScore, 0.8),
          confidence,
          repairSuccessful: true,
          summary: 'Learner successfully repaired a meaningful error.',
          observedAt: assessment.createdAt
        });
        if (repair) evidence.push(repair);
      });
    }
    return evidence;
  }

  function sendSideband(controller, event) {
    if (controller.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      controller.ws.send(JSON.stringify(event));
      return true;
    } catch (error) {
      return false;
    }
  }

  async function assessTurn(controller, { turnId, transcript, acoustic = {}, modelObservation = null, isCurrent = () => true }) {
    if (!turnId || controller.assessmentTurnIds.has(turnId)) {
      return controller.latestAssessment || null;
    }
    controller.assessmentTurnIds.add(turnId);
    const learningState = controller.profile
      ? {
        profile: controller.profile,
        preferences: controller.preferences,
        mastery: controller.mastery,
        reviewItems: controller.reviewItems
      }
      : await readUserLearningState(controller.userId);
    controller.profile = learningState.profile;
    controller.preferences = learningState.preferences;
    controller.mastery = learningState.mastery;
    controller.reviewItems = learningState.reviewItems;
    const activity = getCurrentActivity(controller.blueprint, controller.activityState);
    let raw = null;
    try {
      raw = await requestStructured({
        name: 'tutor_turn_assessment',
        schema: TUTOR_TURN_ASSESSMENT_JSON_SCHEMA,
        instructions: buildAssessmentInstructions(),
        input: JSON.stringify({
          transcript,
          transcriptNotice: 'This text may contain ASR errors.',
          activity,
          activityState: controller.activityState,
          learnerProfile: controller.profile,
          vocabularyCeiling: controller.profile.contentCeiling,
          acoustic,
          modelObservation,
          recentTurns: controller.recentTurns.slice(-6)
        })
      });
    } catch (error) {
      logger.warn?.('[tutor-v2] assessment fallback', error?.message || error);
      if (isTutorLiveModel(controller.model)) {
        controller.assessmentTurnIds.delete(turnId);
        throw error;
      }
    }
    if (!isCurrent()) {
      controller.assessmentTurnIds.delete(turnId);
      return null;
    }
    let assessment = raw
      ? normalizeTurnAssessment({
        ...raw,
        id: createId('assessment'),
        turnId,
        activityId: activity?.id || '',
        transcript,
        transcriptConfidence: acoustic?.transcriptConfidence ?? 0.65,
        responseLatencyMs: acoustic?.responseLatencyMs || 0,
        acoustic,
        createdAt: Date.now()
      })
      : fallbackAssessment({ turnId, activity, transcript, acoustic });
    if (controller.mission.id.startsWith('diagnostic_')) {
      assessment = normalizeTurnAssessment({
        ...assessment,
        correction: {
          ...assessment.correction,
          required: false,
          requiresRepair: false
        }
      });
    }
    controller.latestAssessment = assessment;
    controller.activityState = advanceLessonState({
      blueprint: controller.blueprint,
      state: controller.activityState,
      assessment
    });
    const updatedLearning = applyAssessmentToMastery({
      mastery: controller.mastery,
      reviewItems: controller.reviewItems,
      assessment
    });
    controller.mastery = updatedLearning.mastery;
    controller.reviewItems = updatedLearning.reviewItems;
    controller.profile = applyAssessmentDimensions(
      deriveSpeakingProfile(controller.profile, controller.mastery),
      assessment
    );
    const recentTurnIndex = controller.recentTurns.findIndex((entry) => entry.turnId === turnId);
    const recentTurn = {
      turnId,
      role: 'user',
      transcript,
      assessmentId: assessment.id,
      at: Date.now()
    };
    if (recentTurnIndex === -1) {
      controller.recentTurns.push(recentTurn);
    } else {
      controller.recentTurns[recentTurnIndex] = {
        ...controller.recentTurns[recentTurnIndex],
        ...recentTurn
      };
    }
    controller.recentTurns = controller.recentTurns.slice(-MAX_RECENT_TURNS);
    controller.metrics.userTurns += 1;
    controller.updatedAt = Date.now();

    await Promise.all([
      persistAssessment(controller, assessment),
      persistEvidence(controller, assessmentEvidence(controller, assessment)),
      persistController(controller),
      writeUserLearningState(controller.userId, {
        profile: controller.profile,
        preferences: controller.preferences,
        mastery: controller.mastery,
        reviewItems: controller.reviewItems
      })
    ]);

    if (isTutorLiveModel(controller.model)) return assessment;
    const instructions = buildTutorV2RealtimeInstructions({
      profile: controller.profile,
      blueprint: controller.blueprint,
      state: controller.activityState,
      preferences: controller.preferences
    });
    sendSideband(controller, {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions
      }
    });
    return assessment;
  }

  async function handleToolCall(controller, call) {
    let args = {};
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch (error) {
      args = {};
    }
    const turn = controller.recentTurns.slice().reverse().find((entry) => entry.role === 'user');
    let result = { accepted: false, reason: 'No learner turn is available.' };
    if (call.name === 'report_learning_observation' && turn) {
      const assessment = await assessTurn(controller, {
        turnId: turn.turnId,
        transcript: turn.transcript,
        modelObservation: args
      });
      result = {
        accepted: Boolean(assessment),
        activityState: controller.activityState,
        correction: assessment?.correction || null
      };
    }
    sendSideband(controller, {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result)
      }
    });
    sendSideband(controller, { type: 'response.create' });
  }

  function handleSidebandMessage(controller, rawMessage) {
    let event = null;
    try {
      event = JSON.parse(String(rawMessage));
    } catch (error) {
      return;
    }
    if (isTutorLiveModel(controller.model)) {
      if (!event.type?.includes('_audio.')) appendEvent(controller, event);
      controller.liveGreeting?.handle(event);
      controller.liveDirector?.handle(event);
      return;
    }
    appendEvent(controller, event);
    controller.trace = reduceTutorRealtimeTrace(controller.trace, event, Date.now());
    controller.metrics = {
      ...controller.metrics,
      ...tutorTraceMetrics(controller.trace)
    };
    controller.pendingLearnerResponseLatencyMs = controller.trace.pendingLearnerResponseLatencyMs;
    controller.lastTutorAudioStoppedAt = controller.trace.lastTutorAudioStoppedAt;
    if (event.type === 'output_audio_buffer.started') {
      controller.tutorAudioOutputActive = true;
    }
    if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') {
      controller.tutorAudioOutputActive = false;
    }
    if (event.type === 'input_audio_buffer.speech_started') {
      const itemId = cleanString(event.item_id, 140) || createId('speech');
      controller.activeUserSpeechItemId = itemId;
      controller.userSpeechWindows.set(itemId, {
        startedAt: Date.now(),
        stoppedAt: null,
        speechStartedDuringTutorAudio: controller.tutorAudioOutputActive
      });
      controller.pendingLearnerResponseLatencyMs = controller.lastTutorAudioStoppedAt
        ? Math.max(0, Date.now() - controller.lastTutorAudioStoppedAt)
        : 0;
    }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      const itemId = cleanString(event.item_id, 140) || controller.activeUserSpeechItemId;
      const speechWindow = controller.userSpeechWindows.get(itemId);
      if (speechWindow) {
        controller.userSpeechWindows.set(itemId, {
          ...speechWindow,
          stoppedAt: Date.now()
        });
      }
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const rawTranscript = cleanString(event.transcript, 12000);
      const transcript = normalizeTutorTranscriptText(rawTranscript);
      const turnId = cleanString(event.item_id, 140) || createId('turn');
      const speechWindow = controller.userSpeechWindows.get(turnId)
        || controller.userSpeechWindows.get(controller.activeUserSpeechItemId);
      const speechDurationMs = speechWindow?.stoppedAt && speechWindow?.startedAt
        ? speechWindow.stoppedAt - speechWindow.startedAt
        : 0;
      controller.userSpeechWindows.delete(turnId);
      if (controller.activeUserSpeechItemId) {
        controller.userSpeechWindows.delete(controller.activeUserSpeechItemId);
      }
      controller.activeUserSpeechItemId = '';
      if (rawTranscript && !transcript) {
        appendEvent(controller, {
          type: 'tutor.unsupported_transcript_suppressed',
          item_id: turnId
        });
        sendSideband(controller, {
          type: 'conversation.item.delete',
          item_id: turnId
        });
        return;
      }
      if (isLikelyTutorPlaybackEcho({
        transcript,
        speechStartedDuringTutorAudio: speechWindow?.speechStartedDuringTutorAudio,
        durationMs: speechDurationMs
      })) {
        appendEvent(controller, {
          type: 'tutor.playback_echo_suppressed',
          item_id: turnId
        });
        sendSideband(controller, {
          type: 'conversation.item.delete',
          item_id: turnId
        });
        controller.directorStatus = 'idle';
        controller.processingTurnId = '';
        controller.updatedAt = Date.now();
        void persistController(controller);
        return;
      }
      if (transcript) {
        void persistTranscriptTurn(controller, {
          turnId,
          itemId: event.item_id,
          role: 'user',
          transcript,
          status: 'completed',
          endedAt: Date.now()
        });
        controller.directorStatus = 'assessing';
        controller.processingTurnId = turnId;
        controller.updatedAt = Date.now();
        void (async () => {
          await assessTurn(controller, {
            turnId,
            transcript,
            acoustic: {
              source: 'realtime_transcription',
              transcriptConfidence: 0.65,
              responseLatencyMs: controller.pendingLearnerResponseLatencyMs
            }
          });
          if (controller.status !== 'active') return;
          controller.directorStatus = 'responding';
          controller.pendingResponseCreatedAt = Date.now();
          sendSideband(controller, {
            type: 'response.create',
            response: { max_output_tokens: 480 }
          });
          void persistController(controller);
        })().catch((error) => {
          logger.warn?.('[tutor-v2] directed turn failed', error?.message || error);
          controller.directorStatus = 'responding';
          controller.pendingResponseCreatedAt = Date.now();
          sendSideband(controller, {
            type: 'response.create',
            response: {
              instructions: 'Ask one short, level-appropriate Japanese follow-up question. Do not mention a system error.',
              max_output_tokens: 300
            }
          });
        });
      }
    }
    if (event.type === 'response.output_audio_transcript.done' || event.type === 'response.audio_transcript.done') {
      const transcript = cleanString(event.transcript, 12000);
      const responseId = cleanString(event.response_id, 140);
      const itemId = cleanString(event.item_id, 140);
      const turnId = resolveTutorAssistantTurnId({
        itemId,
        responseId,
        fallback: createId('assistant')
      });
      if (transcript) {
        const turn = {
          turnId,
          itemId,
          responseId,
          role: 'assistant',
          transcript,
          status: 'completed',
          endedAt: Date.now(),
          at: Date.now()
        };
        const existingIndex = controller.recentTurns.findIndex((entry) => entry.turnId === turnId);
        if (existingIndex === -1) controller.recentTurns.push(turn);
        else controller.recentTurns[existingIndex] = { ...controller.recentTurns[existingIndex], ...turn };
        controller.recentTurns = controller.recentTurns.slice(-MAX_RECENT_TURNS);
        void persistTranscriptTurn(controller, turn);
      }
    }
    if (event.type === 'response.created') {
      controller.directorStatus = 'responding';
      controller.pendingResponseCreatedAt = Date.now();
    }
    if (event.type === 'output_audio_buffer.started' && controller.pendingResponseCreatedAt) {
      controller.pendingResponseCreatedAt = null;
    }
    if (event.type === 'response.done') {
      const responseId = cleanString(event.response?.id || event.response_id, 140);
      const responseOutput = Array.isArray(event.response?.output) ? event.response.output : [];
      responseOutput.filter((item) => item?.type === 'message').forEach((item) => {
        const itemId = cleanString(item.id, 140);
        const turnId = resolveTutorAssistantTurnId({ itemId, responseId });
        if (!turnId) return;
        void persistTranscriptTurn(controller, {
          turnId,
          itemId,
          responseId,
          role: 'assistant',
          status: cleanString(event.response?.status, 80),
          endedAt: Date.now()
        });
      });
      const calls = responseOutput
        .filter((item) => item?.type === 'function_call');
      calls.forEach((call) => void handleToolCall(controller, call));
      if (!calls.length) {
        controller.directorStatus = 'idle';
        controller.processingTurnId = '';
      }
      void persistController(controller);
    }
  }

  function clearSidebandRetry(controller) {
    if (!controller.sidebandRetryTimer) return;
    clearTimeout(controller.sidebandRetryTimer);
    controller.sidebandRetryTimer = null;
  }

  function scheduleSideband(controller, callId, attempt = 0, delayMs = SIDEBAND_INITIAL_DELAY_MS) {
    if (!callId || !apiKey || controller.status !== 'active') return;
    clearSidebandRetry(controller);
    controller.callId = callId;
    controller.sidebandAttempt = attempt;
    controller.sidebandRetryTimer = setTimeout(() => {
      controller.sidebandRetryTimer = null;
      openSideband(controller, callId, attempt);
    }, delayMs);
    controller.sidebandRetryTimer.unref?.();
  }

  function openSideband(controller, callId, attempt = 0) {
    if (!callId || !apiKey || controller.status !== 'active') return;
    let didOpen = false;
    let retryScheduled = false;
    let failureHandled = false;
    const ws = new WebSocketImpl(isTutorLiveModel(controller.model)
      ? tutorLiveSidebandUrl(callId)
      : `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Safety-Identifier': createHash('sha256').update(controller.userId).digest('hex')
      }
    });
    controller.ws = ws;

    const handleAttachFailure = ({ statusCode = 0, message = '', detail = '', requestId = '' } = {}) => {
      if (failureHandled || didOpen) return;
      failureHandled = true;
      const retryDelay = getSidebandRetryDelay(statusCode, attempt);
      if (retryDelay !== null && controller.status === 'active' && controller.callId === callId) {
        retryScheduled = true;
        if (controller.ws === ws) controller.ws = null;
        appendEvent(controller, {
          type: 'sideband.retry',
          status: String(statusCode),
          detail,
          requestId
        });
        scheduleSideband(controller, callId, attempt + 1, retryDelay);
        void persistController(controller);
        return;
      }
      controller.trace = reduceTutorRealtimeTrace(controller.trace, { type: 'sideband.error' });
      controller.metrics = { ...controller.metrics, ...tutorTraceMetrics(controller.trace) };
      if (controller.ws === ws) controller.ws = null;
      appendEvent(controller, {
        type: 'sideband.error',
        status: statusCode ? String(statusCode) : '',
        detail,
        requestId
      });
      const diagnostic = [
        message || `HTTP ${statusCode || 'unknown'}`,
        detail,
        requestId ? `request ${requestId}` : ''
      ].filter(Boolean).join(' | ');
      logger.warn?.('[tutor-v2] sideband error', diagnostic);
    };

    ws.on('open', () => {
      didOpen = true;
      controller.sidebandAttempt = 0;
      controller.trace = reduceTutorRealtimeTrace(controller.trace, { type: 'sideband.open' });
      controller.metrics = { ...controller.metrics, ...tutorTraceMetrics(controller.trace) };
      appendEvent(controller, { type: 'sideband.open' });
      if (isTutorLiveModel(controller.model)) {
        controller.liveGreeting.start();
        controller.updatedAt = Date.now();
        void persistController(controller);
        return;
      }
      const instructions = buildTutorV2RealtimeInstructions({
        profile: controller.profile,
        blueprint: controller.blueprint,
        state: controller.activityState,
        preferences: controller.preferences
      });
      sendSideband(controller, {
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions
        }
      });
      controller.updatedAt = Date.now();
    });
    ws.on('message', (message) => handleSidebandMessage(controller, message));
    ws.on('unexpected-response', (request, response) => {
      const statusCode = Number(response.statusCode) || 0;
      const requestId = cleanString(
        response.headers?.['x-request-id'] || response.headers?.['openai-request-id'],
        160
      );
      const chunks = [];
      let byteLength = 0;
      response.on('data', (chunk) => {
        if (byteLength >= 2048) return;
        const bytes = Buffer.from(chunk);
        chunks.push(bytes.subarray(0, 2048 - byteLength));
        byteLength += bytes.length;
      });
      response.on('end', () => {
        const detail = cleanString(Buffer.concat(chunks).toString('utf8'), 500);
        handleAttachFailure({
          statusCode,
          message: `Unexpected server response: ${statusCode}`,
          detail,
          requestId
        });
        request.destroy();
      });
      response.on('error', (error) => {
        handleAttachFailure({
          statusCode,
          message: error?.message || `Unexpected server response: ${statusCode}`,
          requestId
        });
      });
    });
    ws.on('error', (error) => {
      const statusCode = Number(String(error?.message || '').match(/Unexpected server response:\s*(\d+)/i)?.[1] || 0);
      handleAttachFailure({ statusCode, message: error?.message || String(error) });
    });
    ws.on('close', () => {
      if (didOpen) {
        controller.trace = reduceTutorRealtimeTrace(controller.trace, { type: 'sideband.close' });
        controller.metrics = { ...controller.metrics, ...tutorTraceMetrics(controller.trace) };
        appendEvent(controller, { type: 'sideband.close' });
      }
      if (controller.ws === ws) controller.ws = null;
      if (didOpen && isTutorLiveModel(controller.model) && !controller.liveClosing && !controller.liveFinalized
        && controller.status === 'active' && (controller.liveReconnects || 0) < 4) {
        controller.liveReconnects = (controller.liveReconnects || 0) + 1;
        retryScheduled = true;
        scheduleSideband(controller, callId, 0, controller.liveReconnects * 1000);
      }
      if (!retryScheduled) void persistController(controller);
    });
  }

  async function connectRealtime(controller, offerSdp) {
    const safetyIdentifier = createHash('sha256').update(controller.userId).digest('hex');
    if (isTutorLiveModel(controller.model)) {
      if (controller.callId) throw Object.assign(new Error('This session already has a voice connection. Start a new session to reconnect.'), { status: 409 });
      const result = await createTutorLiveCall({ apiKey, safetyIdentifier, offerSdp, fetchImpl,
        options: { ...controller, preferences: controller.preferences } });
      controller.callId = result.callId;
      controller.liveGreeting = createTutorLiveGreeting((event) => sendSideband(controller, event));
      controller.liveAudio = createTutorLiveAudioBuffer();
      controller.liveAudioClips = [];
      controller.liveDirector = createTutorLiveDirector({
        send: (event) => sendSideband(controller, event),
        assess: (turn) => assessTurn(controller, turn),
        context: () => tutorLiveActivityContext(controller),
        persistFragment: (event) => runSqlite(workspaceDbPath, `
          INSERT OR IGNORE INTO user_tutor_live_fragments
          (user_id, session_id, event_id, role, delta, start_ms, end_ms) VALUES (
            ${sqlString(controller.userId)}, ${sqlString(controller.id)},
            ${sqlString(event.event_id || createId('fragment'))},
            ${sqlString(event.type === 'session.input_transcript.delta' ? 'user' : 'assistant')},
            ${sqlString(event.delta)}, ${event.start_ms}, ${event.end_ms});`),
        persistRow: async (row) => {
          const turn = { turnId: row.id, itemId: row.id, role: row.role, transcript: row.transcript,
            status: 'streaming', startedAt: controller.startedAt + row.startMs, endedAt: controller.startedAt + row.endMs };
          const index = controller.recentTurns.findIndex((entry) => entry.turnId === row.id);
          if (index === -1) controller.recentTurns.push(turn);
          else controller.recentTurns[index] = turn;
          controller.recentTurns = controller.recentTurns.slice(-MAX_RECENT_TURNS);
          await persistTranscriptTurn(controller, turn);
        },
        status: (value) => { controller.directorStatus = value; controller.updatedAt = Date.now(); },
        usage: (value, finalized, reason) => {
          controller.liveFinalized = finalized;
          controller.metrics.liveUsage = { seconds: Number(value?.seconds) || 0, finalized, reason: reason || '' };
          void persistController(controller);
        },
        onAudio: (event) => controller.liveAudio.append(event),
        logError: (error) => logger.warn?.('[tutor-live]', error?.message || error)
      });
      return result;
    }
    const formData = new FormData();
    formData.set('sdp', offerSdp);
    formData.set('session', JSON.stringify(createTutorV2RealtimeSessionConfig({
      model: controller.model,
      profile: controller.profile,
      blueprint: controller.blueprint,
      activityState: controller.activityState,
      preferences: controller.preferences,
      voice: controller.voice
    })));
    const response = await fetchImpl('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Safety-Identifier': safetyIdentifier
      },
      body: formData
    });
    const answerSdp = await response.text();
    if (!response.ok) {
      const error = new Error(answerSdp || 'Realtime call failed');
      error.status = response.status;
      throw error;
    }
    const callId = extractRealtimeCallId(response.headers.get('location'));
    if (!callId) {
      const error = new Error('Realtime call ID missing from SDP response');
      error.status = 502;
      throw error;
    }
    return { answerSdp, callId };
  }

  async function createSession(actor, body) {
    const state = await readUserLearningState(actor.id);
    let profile = normalizeSpeakingProfile(body?.speakingProfile || {}, body?.legacyProfile || body?.profile || {});
    if (state.profile.updatedAt && state.profile.completedDiagnosticAt) {
      profile = state.profile;
    } else {
      profile = normalizeSpeakingProfile({
        ...profile,
        contentCeiling: body?.contentCeiling || body?.vocabularyLevel || profile.contentCeiling,
        goal: body?.goal || profile.goal
      });
    }
    const preferences = normalizePreferences({
      ...state.preferences,
      ...(body?.preferences && typeof body.preferences === 'object' ? body.preferences : {}),
      mode: body?.mode || body?.preferences?.mode || state.preferences.mode,
      topic: body?.topic ?? body?.preferences?.topic ?? state.preferences.topic,
      speechRate: body?.speechRate ?? state.preferences.speechRate,
      voice: body?.voice ?? state.preferences.voice,
      transcriptionMode: body?.transcriptionMode ?? state.preferences.transcriptionMode,
      contentCeiling: body?.contentCeiling || body?.vocabularyLevel || profile.contentCeiling
    });
    profile = normalizeSpeakingProfile({
      ...profile,
      contentCeiling: preferences.contentCeiling,
      goal: preferences.goal || profile.goal
    });
    const mission = body?.diagnostic
      ? null
      : selectDailyMission({
        profile,
        mastery: state.mastery,
        reviewItems: state.reviewItems,
        preferences,
        topic: preferences.topic
      });
    let blueprint = body?.diagnostic
      ? buildDiagnosticBlueprint({ profile, durationMinutes: 15 })
      : buildLessonBlueprint({ mission, profile, topic: preferences.topic });
    if (body?.benchmark) {
      const benchmarkId = `benchmark_${Date.now()}`;
      blueprint = normalizeLessonBlueprint({
        ...blueprint,
        id: `blueprint_${benchmarkId}`,
        mission: {
          ...blueprint.mission,
          id: benchmarkId,
          title: 'Monthly speaking benchmark',
          objective: 'Produce a comparable speaking sample across interaction, production, listening, fluency, and phonology.'
        }
      });
    }
    const sessionId = createId('tutorv2');
    const controller = {
      id: sessionId,
      userId: actor.id,
      status: 'active',
      mission: blueprint.mission,
      blueprint,
      activityState: createInitialActivityState(blueprint),
      latestAssessment: null,
      outcome: null,
      model: realtimeModel,
      voice: preferences.voice,
      startedAt: Date.now(),
      endedAt: null,
      updatedAt: Date.now(),
      eventLog: [],
      recentTurns: [],
      assessmentTurnIds: new Set(),
      ws: null,
      callId: '',
      sidebandRetryTimer: null,
      sidebandAttempt: 0,
      profile,
      preferences,
      mastery: state.mastery,
      reviewItems: state.reviewItems,
      metrics: {
        userTurns: 0,
        assistantTurns: 0,
        completedAssistantTurns: 0,
        interruptedAssistantTurns: 0,
        firstAudioLatenciesMs: []
      },
      trace: createTutorRealtimeTraceState(),
      pendingResponseCreatedAt: null,
      directorStatus: 'idle',
      processingTurnId: '',
      lastTutorAudioStoppedAt: null,
      pendingLearnerResponseLatencyMs: 0,
      tutorAudioOutputActive: false,
      activeUserSpeechItemId: '',
      userSpeechWindows: new Map(),
      lastReadAt: Date.now()
    };
    controllers.set(`${actor.id}:${sessionId}`, controller);
    await Promise.all([
      persistController(controller),
      writeUserLearningState(actor.id, {
        profile,
        preferences,
        mastery: state.mastery,
        reviewItems: state.reviewItems
      })
    ]);
    return controller;
  }

  function buildFallbackOutcome(controller) {
    const assessment = controller.latestAssessment;
    return {
      overview: assessment
        ? `You completed ${controller.mission.title} and produced evidence for ${assessment.targetSkillIds.length || 1} target skill.`
        : `You completed ${controller.mission.title}.`,
      wins: assessment?.taskCompleted ? ['You completed the final assessed speaking task.'] : ['You stayed engaged in spoken Japanese practice.'],
      priorityWeakness: assessment?.correction?.corrected || 'Repeat the target in a fresh context during the next session.',
      nextMission: controller.mission.objective,
      dimensionSignals: assessment?.dimensions || {
        interaction: 0.5,
        production: 0.5,
        listening: 0.5,
        grammar: 0.5,
        vocabulary: 0.5,
        fluency: 0.5,
        phonology: 0.5
      }
    };
  }

  async function completeSession(controller) {
    if (controller.status === 'completed') return controller;
    if (controller.liveDirector && !controller.liveClosing) {
      controller.liveClosing = true;
      const finalized = await controller.liveDirector.close();
      controller.metrics.liveUsage = { ...controller.metrics.liveUsage, finalized };
      for (const row of controller.liveDirector.transcript.rows) {
        const bytes = controller.liveAudio.wav(row.role, Math.max(0, row.startMs - 200), row.endMs + 300);
        if (!bytes) continue;
        const requestUrl = new URL('http://localhost/audio');
        requestUrl.search = new URLSearchParams({ sessionId: controller.id, speaker: row.role,
          durationMs: String((bytes.length - 44) / 48), referenceText: row.transcript,
          source: 'live_sideband', approximateAlignment: '1' }).toString();
        const request = Readable.from([bytes]);
        request.headers = { 'content-type': 'audio/wav' };
        try {
          controller.liveAudioClips.push(await storeAudio({ id: controller.userId }, requestUrl, request, row.id));
        } catch (error) {
          logger.warn?.('[tutor-live] recording save failed', error?.message || error);
        }
      }
      controller.liveAudio.clear();
    }
    if (!controller.profile) {
      const state = await readUserLearningState(controller.userId);
      controller.profile = state.profile;
      controller.preferences = state.preferences;
      controller.mastery = state.mastery;
      controller.reviewItems = state.reviewItems;
    }
    let outcome = null;
    const assessmentSql = `
      SELECT assessment
      FROM user_tutor_turn_assessments
      WHERE user_id = ${sqlString(controller.userId)}
        AND session_id = ${sqlString(controller.id)}
      ORDER BY created_at ASC;
    `;
    const assessmentRows = parseSqliteJson(await runSqlite(workspaceDbPath, assessmentSql, { json: true }));
    const assessments = assessmentRows.map((row) => parseStoredJson(row.assessment, null)).filter(Boolean);
    try {
      outcome = await requestStructured({
        name: 'tutor_session_outcome',
        schema: TUTOR_SESSION_OUTCOME_JSON_SCHEMA,
        instructions: buildOutcomeInstructions(),
        input: JSON.stringify({
          mission: controller.mission,
          completedActivities: controller.activityState.completedActivityIds,
          assessments,
          learnerProfile: controller.profile,
          metrics: controller.metrics
        }),
        maxOutputTokens: 900
      });
    } catch (error) {
      logger.warn?.('[tutor-v2] outcome fallback', error?.message || error);
      outcome = buildFallbackOutcome(controller);
    }
    controller.status = 'completed';
    controller.activityState = normalizeActivityState({
      ...controller.activityState,
      status: 'completed',
      updatedAt: Date.now()
    }, controller.blueprint);
    controller.outcome = outcome;
    controller.endedAt = Date.now();
    controller.updatedAt = Date.now();
    const isDiagnostic = controller.mission.id.startsWith('diagnostic_');
    const isBenchmark = controller.mission.id.startsWith('benchmark_');
    const shouldRecordMilestone = shouldRecordTutorMilestone(
      controller.mission.id,
      assessments.length
    );
    if (shouldRecordMilestone) {
      controller.profile = normalizeSpeakingProfile({
        ...controller.profile,
        completedDiagnosticAt: isDiagnostic
          ? controller.endedAt
          : controller.profile.completedDiagnosticAt,
        lastBenchmarkAt: isBenchmark
          ? controller.endedAt
          : controller.profile.lastBenchmarkAt,
        updatedAt: controller.endedAt
      });
    }
    if (controller.ws) {
      try { controller.ws.close(); } catch (error) { /* Ignore shutdown errors. */ }
      controller.ws = null;
    }
    clearSidebandRetry(controller);
    const writes = [
      persistController(controller),
      writeUserLearningState(controller.userId, {
        profile: controller.profile,
        preferences: controller.preferences,
        mastery: controller.mastery,
        reviewItems: controller.reviewItems
      })
    ];
    if (isBenchmark && shouldRecordMilestone) {
      const audioRows = parseSqliteJson(await runSqlite(workspaceDbPath, `
        SELECT clip_id
        FROM user_tutor_audio_v2
        WHERE user_id = ${sqlString(controller.userId)}
          AND session_id = ${sqlString(controller.id)}
        ORDER BY created_at ASC;
      `, { json: true }));
      const benchmarkDimensions = {};
      TUTOR_SPEAKING_DIMENSIONS.forEach((dimension) => {
        const values = assessments.map((assessment) => Number(assessment?.dimensions?.[dimension])).filter(Number.isFinite);
        benchmarkDimensions[dimension] = values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0.5;
      });
      const benchmark = normalizeBenchmarkResult({
        id: controller.id,
        sessionId: controller.id,
        dimensions: benchmarkDimensions,
        taskScore: assessments.length
          ? assessments.reduce((sum, assessment) => sum + (Number(assessment.taskScore) || 0), 0) / assessments.length
          : 0.5,
        audioClipIds: audioRows.map((row) => row.clip_id),
        notes: [controller.outcome?.overview || 'Monthly benchmark completed.'],
        recordedAt: controller.endedAt
      });
      writes.push(runSqlite(workspaceDbPath, `
        INSERT INTO user_tutor_benchmarks_v2 (user_id, benchmark_id, payload, created_at)
        VALUES (
          ${sqlString(controller.userId)},
          ${sqlString(controller.id)},
          ${sqlString(JSON.stringify(benchmark))},
          ${controller.endedAt}
        )
        ON CONFLICT(user_id, benchmark_id) DO UPDATE SET
          payload = excluded.payload,
          created_at = excluded.created_at;
      `));
    }
    await Promise.all(writes);
    return controller;
  }

  async function readProgress(userId) {
    const state = await readUserLearningState(userId);
    const recentSql = `
      SELECT session_id, mode, mission, outcome, started_at, ended_at, updated_at
      FROM user_tutor_sessions_v2
      WHERE user_id = ${sqlString(userId)}
      ORDER BY updated_at DESC
      LIMIT 12;
    `;
    const legacySql = `
      SELECT payload
      FROM user_tutor_legacy_sessions_v2
      WHERE user_id = ${sqlString(userId)}
      ORDER BY imported_at DESC
      LIMIT 25;
    `;
    const evidenceSql = `
      SELECT payload
      FROM user_tutor_mastery_evidence
      WHERE user_id = ${sqlString(userId)}
      ORDER BY observed_at DESC
      LIMIT 200;
    `;
    const benchmarkSql = `
      SELECT payload
      FROM user_tutor_benchmarks_v2
      WHERE user_id = ${sqlString(userId)}
      ORDER BY created_at DESC
      LIMIT 12;
    `;
    const [recentRows, legacyRows, evidenceRows, benchmarkRows] = await Promise.all([
      runSqlite(workspaceDbPath, recentSql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, legacySql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, evidenceSql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, benchmarkSql, { json: true }).then(parseSqliteJson)
    ]);
    const evidence = evidenceRows
      .map((row) => normalizeMasteryEvidence(parseStoredJson(row.payload, {})))
      .filter(Boolean);
    const pronunciationTrends = Object.fromEntries(['phonology', 'fluency'].map((dimension) => {
      const signals = evidence.filter((item) => item.dimension === dimension && item.source === 'acoustic').slice(0, 24);
      return [dimension, signals.map((item) => ({
        score: item.score,
        confidence: item.confidence,
        provider: item.provider,
        observedAt: item.observedAt
      })).reverse()];
    }));
    const byLevel = {};
    ['A1', 'A2', 'B1', 'B2'].forEach((level) => {
      const skills = TUTOR_SKILL_GRAPH.filter((entry) => entry.level === level);
      const values = skills.map((entry) => state.mastery[entry.id]?.mastery || 0);
      byLevel[level] = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    });
    return {
      schemaVersion: TUTOR_V2_SCHEMA_VERSION,
      profile: state.profile,
      preferences: state.preferences,
      mastery: state.mastery,
      dueReviews: getDueReviewItems(state.reviewItems),
      reviewItems: state.reviewItems,
      evidence,
      pronunciationTrends,
      benchmarks: benchmarkRows
        .map((row) => normalizeBenchmarkResult(parseStoredJson(row.payload, {})))
        .filter(Boolean),
      byLevel,
      recentSessions: recentRows.map((row) => ({
        id: row.session_id,
        mode: row.mode,
        mission: parseStoredJson(row.mission, {}),
        outcome: parseStoredJson(row.outcome, null),
        startedAt: Number(row.started_at) || 0,
        endedAt: Number(row.ended_at) || null,
        updatedAt: Number(row.updated_at) || 0
      })),
      legacySessions: legacyRows
        .map((row) => parseStoredJson(row.payload, null))
        .filter(Boolean)
    };
  }

  function percentile(values, percentileValue) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
    return sorted[index];
  }

  function evaluateAssistantLanguagePolicy(turns) {
    const japanese = /[\u3005\u3040-\u30ff\u3400-\u9fff\uff66-\uff9d]/;
    const englishWords = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
    let previousUser = null;
    const results = [];
    turns.forEach((turn) => {
      if (turn.role === 'user') {
        previousUser = turn;
        return;
      }
      if (turn.role !== 'assistant' || !turn.transcript) return;
      const learnerEnglishWords = previousUser?.transcript?.match(englishWords)?.length || 0;
      const learnerAskedInEnglish = previousUser && !japanese.test(previousUser.transcript) && learnerEnglishWords >= 3;
      const assistantHasJapanese = japanese.test(turn.transcript);
      const assistantEnglishWords = turn.transcript.match(englishWords)?.length || 0;
      results.push(learnerAskedInEnglish
        ? assistantHasJapanese && assistantEnglishWords > 0
        : assistantHasJapanese && assistantEnglishWords <= 12);
    });
    return results;
  }

  async function readQuality(userId) {
    const [metricRows, audioRows, turnRows, assessmentRows, labelRows, learningState] = await Promise.all([
      runSqlite(workspaceDbPath, `
        SELECT payload FROM user_tutor_quality_metrics_v2
        WHERE user_id = ${sqlString(userId)} ORDER BY updated_at DESC LIMIT 50;
      `, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, `
        SELECT speaker, SUM(duration_ms) AS duration_ms FROM user_tutor_audio_v2
        WHERE user_id = ${sqlString(userId)} GROUP BY speaker;
      `, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, `
        SELECT role, transcript, started_at FROM user_tutor_turns_v2
        WHERE user_id = ${sqlString(userId)} ORDER BY started_at ASC LIMIT 1000;
      `, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, `
        SELECT assessment FROM user_tutor_turn_assessments
        WHERE user_id = ${sqlString(userId)} ORDER BY created_at DESC LIMIT 500;
      `, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, `
        SELECT accurate FROM user_tutor_correction_labels_v2
        WHERE user_id = ${sqlString(userId)};
      `, { json: true }).then(parseSqliteJson),
      readUserLearningState(userId)
    ]);
    const metrics = metricRows.map((row) => parseStoredJson(row.payload, {}));
    const assistantTurns = metrics.reduce((sum, item) => sum + (Number(item.assistantTurns) || 0), 0);
    const completedAssistantTurns = metrics.reduce((sum, item) => sum + (Number(item.completedAssistantTurns) || 0), 0);
    const firstAudioLatencies = metrics.flatMap((item) => Array.isArray(item.firstAudioLatenciesMs) ? item.firstAudioLatenciesMs : []);
    const durations = Object.fromEntries(audioRows.map((row) => [row.speaker, Number(row.duration_ms) || 0]));
    const totalTalkMs = (durations.user || 0) + (durations.assistant || 0);
    const turns = turnRows.map((row) => ({ role: row.role, transcript: row.transcript || '', startedAt: Number(row.started_at) || 0 }));
    const assistantTranscriptTurns = turns.filter((turn) => turn.role === 'assistant' && turn.transcript);
    const shortTurnResults = assistantTranscriptTurns.map((turn) => {
      const sentences = turn.transcript.split(/[.!?\u3002\uff01\uff1f]+/).map((part) => part.trim()).filter(Boolean);
      return sentences.length <= 2;
    });
    const languagePolicyResults = evaluateAssistantLanguagePolicy(turns);
    const assessments = assessmentRows.map((row) => normalizeTurnAssessment(parseStoredJson(row.assessment, {})));
    const repairRequests = assessments.filter((assessment) => assessment.correction.requiresRepair && assessment.correction.required);
    const successfulRepairs = assessments.filter((assessment) => assessment.repairSuccessful);
    const retentionItems = learningState.reviewItems.filter((item) => item.repetitions >= 2);
    const completionRate = assistantTurns ? completedAssistantTurns / assistantTurns : null;
    const learnerTalkTime = totalTalkMs ? (durations.user || 0) / totalTalkMs : null;
    const responseLengthAdherence = shortTurnResults.length
      ? shortTurnResults.filter(Boolean).length / shortTurnResults.length
      : null;
    const languagePolicyAdherence = languagePolicyResults.length
      ? languagePolicyResults.filter(Boolean).length / languagePolicyResults.length
      : null;
    const correctionPrecision = labelRows.length
      ? labelRows.filter((row) => Number(row.accurate) === 1).length / labelRows.length
      : null;
    const immediateRepairSuccess = repairRequests.length
      ? Math.min(1, successfulRepairs.length / repairRequests.length)
      : null;
    const sevenDayRetention = retentionItems.length
      ? retentionItems.filter((item) => item.lastScore >= 0.7).length / retentionItems.length
      : null;
    const p95FirstAudioMs = percentile(firstAudioLatencies, 0.95);
    const gate = (value, target, comparator = 'gte') => ({
      value,
      target,
      measured: value !== null,
      pass: value === null ? null : (comparator === 'lte' ? value <= target : value >= target)
    });
    return {
      sample: {
        sessions: metricRows.length,
        assistantTurns,
        assistantTranscripts: assistantTranscriptTurns.length,
        correctionLabels: labelRows.length,
        repairRequests: repairRequests.length,
        retentionItems: retentionItems.length
      },
      metrics: {
        completeTutorTurns: completionRate,
        p95FirstAudioMs,
        learnerTalkTime,
        responseLengthAdherence,
        languagePolicyAdherence,
        correctionPrecision,
        immediateRepairSuccess,
        sevenDayRetention
      },
      gates: {
        completeTutorTurns: gate(completionRate, 0.99),
        p95FirstAudioMs: gate(p95FirstAudioMs, 2500, 'lte'),
        learnerTalkTime: gate(learnerTalkTime, 0.65),
        responseLengthAndLanguagePolicy: gate(
          responseLengthAdherence === null || languagePolicyAdherence === null
            ? null
            : Math.min(responseLengthAdherence, languagePolicyAdherence),
          0.95
        ),
        correctionPrecision: gate(correctionPrecision, 0.9),
        immediateRepairSuccess: gate(immediateRepairSuccess, 0.8),
        sevenDayRetention: gate(sevenDayRetention, 0.7)
      }
    };
  }

  async function listSessions(userId) {
    const sql = `
      SELECT session.session_id, session.status, session.mode, session.mission,
        session.blueprint, session.activity_state, session.outcome, session.model,
        session.voice, session.started_at, session.ended_at, session.updated_at,
        (
          SELECT COUNT(*) FROM user_tutor_turns_v2 AS turn
          WHERE turn.user_id = session.user_id AND turn.session_id = session.session_id
        ) AS turn_count
      FROM user_tutor_sessions_v2 AS session
      WHERE session.user_id = ${sqlString(userId)}
      ORDER BY session.updated_at DESC
      LIMIT 25;
    `;
    const legacySql = `
      SELECT session_id, payload, imported_at
      FROM user_tutor_legacy_sessions_v2
      WHERE user_id = ${sqlString(userId)}
      ORDER BY imported_at DESC
      LIMIT 25;
    `;
    const [rows, legacyRows] = await Promise.all([
      runSqlite(workspaceDbPath, sql, { json: true }).then(parseSqliteJson),
      runSqlite(workspaceDbPath, legacySql, { json: true }).then(parseSqliteJson)
    ]);
    const sessions = rows.map((row) => ({
      id: row.session_id,
      schemaVersion: TUTOR_V2_SCHEMA_VERSION,
      status: row.status,
      mode: row.mode,
      mission: normalizeMission(parseStoredJson(row.mission, {})),
      blueprint: normalizeLessonBlueprint(parseStoredJson(row.blueprint, {})),
      activityState: parseStoredJson(row.activity_state, {}),
      outcome: parseStoredJson(row.outcome, null),
      model: row.model || '',
      voice: row.voice || '',
      turnCount: Math.max(0, Number(row.turn_count) || 0),
      startedAt: Number(row.started_at) || 0,
      endedAt: Number(row.ended_at) || null,
      updatedAt: Number(row.updated_at) || 0
    }));
    const currentIds = new Set(sessions.map((session) => session.id));
    legacyRows.forEach((row) => {
      const payload = parseStoredJson(row.payload, null);
      const id = cleanString(row.session_id || payload?.id, 160);
      if (!id || !payload || currentIds.has(id)) return;
      const startedAt = Number(payload.startedAt) || 0;
      const endedAt = Number(payload.endedAt) || null;
      const updatedAt = Number(payload.updatedAt) || endedAt || startedAt || Number(row.imported_at) || 0;
      const topic = cleanString(payload.topic || payload.lessonPlan?.topic, 200) || 'Speaking session';
      sessions.push({
        id,
        schemaVersion: 1,
        legacy: true,
        status: cleanString(payload.status, 30) || 'completed',
        mode: cleanString(payload.mode, 30) || 'guided',
        mission: normalizeMission({
          id: `legacy_${id}`,
          title: topic,
          objective: topic,
          topic,
          mode: cleanString(payload.mode, 30) || 'guided',
          level: cleanString(payload.summary?.estimatedLevel || payload.vocabularyLevel, 10) || 'A1',
          targetSkillIds: [],
          durationMinutes: Math.max(1, Math.round(((endedAt || updatedAt) - startedAt) / 60000) || 1),
          generatedAt: startedAt || updatedAt
        }),
        outcome: payload.summary?.overview ? { overview: cleanString(payload.summary.overview, 2000) } : null,
        model: cleanString(payload.model, 100),
        voice: cleanString(payload.voice, 40),
        turnCount: Array.isArray(payload.turns) ? payload.turns.length : 0,
        startedAt,
        endedAt,
        updatedAt
      });
    });
    const result = sessions.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 25);
    await Promise.all(result.filter((session) => isTutorLiveModel(session.model)).map(async (session) => {
      session.audioClips = await readSessionAudio(userId, session.id);
      session.turns = (await readSessionTurns(userId, session.id)).map((turn) => ({ ...turn,
        audioClipIds: session.audioClips.filter((clip) => clip.turnId === turn.id).map((clip) => clip.id) }));
    }));
    return result;
  }

  async function readSessionAudio(userId, sessionId) {
    const rows = parseSqliteJson(await runSqlite(workspaceDbPath, `
      SELECT clip_id, turn_id, speaker, mime_type, byte_length, duration_ms, created_at
      FROM user_tutor_audio_v2 WHERE user_id = ${sqlString(userId)} AND session_id = ${sqlString(sessionId)}
      ORDER BY created_at ASC;`, { json: true }));
    return rows.map((row) => ({ id: row.clip_id, sessionId, turnId: row.turn_id, speaker: row.speaker,
      mimeType: row.mime_type, byteLength: row.byte_length, durationMs: row.duration_ms, createdAt: row.created_at,
      src: `${TUTOR_V2_API_PREFIX}/audio/${encodeURIComponent(row.clip_id)}` }));
  }

  async function readSessionTurns(userId, sessionId) {
    const rows = parseSqliteJson(await runSqlite(workspaceDbPath, `
      SELECT turn_id, role, item_id, response_id, transcript, status, started_at, ended_at
      FROM user_tutor_turns_v2
      WHERE user_id = ${sqlString(userId)} AND session_id = ${sqlString(sessionId)}
      ORDER BY started_at ASC;
    `, { json: true }));
    return rows.map((row) => ({
      id: row.turn_id,
      turnId: row.turn_id,
      role: row.role === 'assistant' ? 'assistant' : 'user',
      itemId: row.item_id || '',
      responseId: row.response_id || '',
      transcript: row.transcript || '',
      status: row.status || '',
      startedAt: Number(row.started_at) || 0,
      endedAt: Number(row.ended_at) || null
    }));
  }

  async function importLegacyHistory(userId, body = {}) {
    const migrated = migrateLegacyTutorData({
      profile: body.profile || {},
      sessions: Array.isArray(body.sessions) ? body.sessions.slice(-25) : []
    });
    const now = Date.now();
    const statements = migrated.legacySessions.map((session, index) => {
      const sessionId = sanitizeId(session.id, `legacy_${now}_${index}`);
      const payload = {
        ...session,
        id: sessionId,
        schemaVersion: 1,
        legacy: true
      };
      return `
        INSERT INTO user_tutor_legacy_sessions_v2 (user_id, session_id, payload, imported_at)
        VALUES (
          ${sqlString(userId)},
          ${sqlString(sessionId)},
          ${sqlString(JSON.stringify(payload))},
          ${now}
        )
        ON CONFLICT(user_id, session_id) DO UPDATE SET
          payload = excluded.payload,
          imported_at = excluded.imported_at;
      `;
    });
    if (statements.length) {
      await runSqlite(workspaceDbPath, `BEGIN;${statements.join('\n')}COMMIT;`);
    }
    const profileRows = parseSqliteJson(await runSqlite(workspaceDbPath, `
      SELECT user_id FROM user_tutor_profiles_v2
      WHERE user_id = ${sqlString(userId)} LIMIT 1;
    `, { json: true }));
    const state = await readUserLearningState(userId);
    if (!profileRows.length) {
      await writeUserLearningState(userId, {
        ...state,
        profile: normalizeSpeakingProfile({
          ...state.profile,
          ...migrated.speakingProfile,
          contentCeiling: migrated.speakingProfile.contentCeiling || state.profile.contentCeiling,
          updatedAt: Date.now()
        }),
        preferences: normalizePreferences({
          ...state.preferences,
          ...(body.preferences && typeof body.preferences === 'object' ? body.preferences : {})
        })
      });
    }
    return { imported: statements.length, schemaVersion: TUTOR_V2_SCHEMA_VERSION };
  }

  async function deleteSession(actor, sessionId, { rebuildLearningState = true } = {}) {
    const safeSessionId = sanitizeId(sessionId);
    const key = `${actor.id}:${safeSessionId}`;
    const controller = controllers.get(key);
    if (controller) controller.status = 'deleted';
    if (controller?.liveDirector) {
      clearSidebandRetry(controller);
      await controller.liveDirector.close();
      controller.liveDirector.cancel();
      controller.liveAudio?.clear();
    }
    const audioRows = parseSqliteJson(await runSqlite(workspaceDbPath, `
      SELECT storage_path
      FROM user_tutor_audio_v2
      WHERE user_id = ${sqlString(actor.id)}
        AND session_id = ${sqlString(safeSessionId)};
    `, { json: true }));
    await Promise.all(audioRows.map((row) => fs.unlink(row.storage_path).catch(() => {})));
    await runSqlite(workspaceDbPath, `
      BEGIN;
      DELETE FROM user_tutor_audio_v2
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_audio_analysis_v2
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_turn_assessments
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_live_fragments
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_turns_v2
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_mastery_evidence
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_quality_metrics_v2
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_correction_labels_v2
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_benchmarks_v2
      WHERE user_id = ${sqlString(actor.id)} AND benchmark_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_legacy_sessions_v2
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      DELETE FROM user_tutor_sessions_v2
      WHERE user_id = ${sqlString(actor.id)} AND session_id = ${sqlString(safeSessionId)};
      COMMIT;
    `);
    if (controller) clearSidebandRetry(controller);
    if (controller?.ws) {
      try { controller.ws.close(); } catch (error) { /* Ignore deletion shutdown errors. */ }
    }
    controllers.delete(key);
    const learningState = rebuildLearningState
      ? await rebuildUserLearningState(actor.id)
      : null;
    return {
      ok: true,
      profile: learningState?.profile || null
    };
  }

  async function deleteAllTutorData(actor) {
    await Promise.all(Array.from(controllers.values()).filter((controller) => controller.userId === actor.id)
      .map(async (controller) => {
        controller.status = 'deleted';
        clearSidebandRetry(controller);
        await controller.liveDirector?.close();
        controller.liveDirector?.cancel();
      }));
    const audioRows = parseSqliteJson(await runSqlite(workspaceDbPath, `
      SELECT storage_path
      FROM user_tutor_audio_v2
      WHERE user_id = ${sqlString(actor.id)};
    `, { json: true }));
    await Promise.all(audioRows.map((row) => fs.unlink(row.storage_path).catch(() => {})));
    controllers.forEach((controller, key) => {
      if (controller.userId !== actor.id) return;
      controller.liveDirector?.cancel();
      controller.liveAudio?.clear();
      clearSidebandRetry(controller);
      if (controller.ws) {
        try { controller.ws.close(); } catch (error) { /* Ignore privacy cleanup shutdown errors. */ }
      }
      controllers.delete(key);
    });
    await runSqlite(workspaceDbPath, `
      BEGIN;
      DELETE FROM user_tutor_audio_analysis_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_audio_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_turn_assessments WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_turns_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_live_fragments WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_mastery_evidence WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_quality_metrics_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_correction_labels_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_benchmarks_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_sessions_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_review_items WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_skill_mastery WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_legacy_sessions_v2 WHERE user_id = ${sqlString(actor.id)};
      DELETE FROM user_tutor_profiles_v2 WHERE user_id = ${sqlString(actor.id)};
      COMMIT;
    `);
    return { ok: true };
  }

  async function storeAudio(actor, requestUrl, req, turnId) {
    const sessionId = sanitizeId(requestUrl.searchParams.get('sessionId'));
    const speaker = requestUrl.searchParams.get('speaker') === 'assistant' ? 'assistant' : 'user';
    const durationMs = Math.max(0, Math.trunc(Number(requestUrl.searchParams.get('durationMs')) || 0));
    const speechRate = Math.max(0, Number(requestUrl.searchParams.get('speechRate')) || 0);
    const pauseRatio = Math.max(0, Math.min(1, Number(requestUrl.searchParams.get('pauseRatio')) || 0));
    const responseLatencyMs = Math.max(0, Math.trunc(Number(requestUrl.searchParams.get('responseLatencyMs')) || 0));
    const pinned = requestUrl.searchParams.get('pinned') === '1';
    const requestedBenchmark = requestUrl.searchParams.get('benchmark') === '1';
    const controller = await readController(actor.id, sessionId);
    if (!controller) {
      const error = new Error('Tutor session not found');
      error.status = 404;
      throw error;
    }
    if (!controller.preferences || !controller.profile || !controller.mastery || !controller.reviewItems) {
      const learningState = await readUserLearningState(actor.id);
      controller.preferences = controller.preferences || learningState.preferences;
      controller.profile = controller.profile || learningState.profile;
      controller.mastery = controller.mastery || learningState.mastery;
      controller.reviewItems = controller.reviewItems || learningState.reviewItems;
    }
    const benchmark = requestedBenchmark || controller.mission.id.startsWith('benchmark_');
    const bytes = await readRequestBody(req, MAX_AUDIO_BODY_BYTES);
    if (!bytes.length) {
      const error = new Error('Missing audio body');
      error.status = 400;
      throw error;
    }
    const mimeType = cleanString(req.headers['content-type'], 120) || 'audio/webm';
    const clipId = createId('clip');
    const extension = mimeTypeToExtension(mimeType);
    const userDir = path.join(audioDirectory, sanitizeId(actor.id, 'local'), sanitizeId(sessionId));
    await fs.mkdir(userDir, { recursive: true });
    const storagePath = path.join(userDir, `${sanitizeId(clipId)}.${extension}`);
    await fs.writeFile(storagePath, bytes);
    const now = Date.now();
    const expiresAt = pinned || benchmark ? null : now + (TUTOR_V2_AUDIO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const sql = `
      INSERT INTO user_tutor_audio_v2 (
        user_id, clip_id, session_id, turn_id, speaker, mime_type, storage_path,
        byte_length, duration_ms, pinned, benchmark, expires_at, created_at, updated_at
      ) VALUES (
        ${sqlString(actor.id)},
        ${sqlString(clipId)},
        ${sqlString(sessionId)},
        ${sqlString(sanitizeId(turnId))},
        ${sqlString(speaker)},
        ${sqlString(mimeType)},
        ${sqlString(storagePath)},
        ${bytes.length},
        ${durationMs},
        ${pinned ? 1 : 0},
        ${benchmark ? 1 : 0},
        ${expiresAt || 'NULL'},
        ${now},
        ${now}
      );
    `;
    await runSqlite(workspaceDbPath, sql);
    if (Date.now() - lastPruneAt > ACTIVITY_POLL_CACHE_MS * 1000) {
      void pruneExpiredAudio();
    }
    let pronunciation = null;
    if (speaker === 'user' && controller.preferences.externalSpeechConsent
      && requestUrl.searchParams.get('approximateAlignment') !== '1') {
      pronunciation = await scoreWithAzure({
        bytes,
        mimeType,
        referenceText: cleanString(requestUrl.searchParams.get('referenceText'), 1000)
      }).catch((error) => ({
        available: false,
        provider: 'azure',
        reason: error?.message || 'Pronunciation assessment failed'
      }));
    }
    const analysis = {
      source: requestUrl.searchParams.get('source') === 'live_sideband'
        ? 'live_sideband_approximate_alignment'
        : (pronunciation?.available ? 'browser_audio+azure' : 'browser_audio'),
      durationMs,
      speechRate,
      pauseRatio,
      responseLatencyMs,
      pronunciation,
      updatedAt: Date.now()
    };
    await runSqlite(workspaceDbPath, `
      INSERT INTO user_tutor_audio_analysis_v2 (
        user_id, clip_id, session_id, turn_id, payload, updated_at
      ) VALUES (
        ${sqlString(actor.id)},
        ${sqlString(clipId)},
        ${sqlString(sessionId)},
        ${sqlString(sanitizeId(turnId))},
        ${sqlString(JSON.stringify(analysis))},
        ${analysis.updatedAt}
      )
      ON CONFLICT(user_id, clip_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at;
    `);
    if (speaker === 'user') {
      await enrichAssessmentWithAudio(controller, sanitizeId(turnId), clipId, analysis);
    }
    await pruneAudioBudget(actor.id, sessionId);
    return {
      id: clipId,
      sessionId,
      turnId: sanitizeId(turnId),
      speaker,
      mimeType,
      byteLength: bytes.length,
      durationMs,
      pinned,
      benchmark,
      expiresAt,
      src: `${TUTOR_V2_API_PREFIX}/audio/${encodeURIComponent(clipId)}`,
      pronunciation
    };
  }

  async function enrichAssessmentWithAudio(controller, turnId, clipId, analysis) {
    const rows = parseSqliteJson(await runSqlite(workspaceDbPath, `
      SELECT assessment
      FROM user_tutor_turn_assessments
      WHERE user_id = ${sqlString(controller.userId)}
        AND session_id = ${sqlString(controller.id)}
        AND turn_id = ${sqlString(turnId)}
      LIMIT 1;
    `, { json: true }));
    if (!rows.length) return;
    const previous = normalizeTurnAssessment(parseStoredJson(rows[0].assessment, {}));
    const pronunciation = analysis.pronunciation?.available ? analysis.pronunciation : null;
    const enriched = normalizeTurnAssessment({
      ...previous,
      responseLatencyMs: analysis.responseLatencyMs || previous.responseLatencyMs,
      acoustic: {
        ...previous.acoustic,
        source: analysis.source,
        confidence: pronunciation ? 0.8 : 0.5,
        durationMs: analysis.durationMs,
        speechRate: analysis.speechRate,
        pauseRatio: analysis.pauseRatio,
        accuracy: pronunciation?.accuracy ?? previous.acoustic.accuracy,
        fluency: pronunciation?.fluency ?? previous.acoustic.fluency
      }
    });
    if (controller.latestAssessment?.turnId === turnId) controller.latestAssessment = enriched;
    const acousticEvidence = [];
    previous.targetSkillIds.forEach((skillId) => {
      if (Number.isFinite(pronunciation?.accuracy)) {
        acousticEvidence.push(normalizeMasteryEvidence({
          id: `acoustic_${clipId}_${skillId.replace(/[^a-z0-9]+/gi, '_')}_accuracy`,
          skillId,
          source: 'acoustic',
          sessionId: controller.id,
          turnId,
          activityId: previous.activityId,
          dimension: 'phonology',
          score: pronunciation.accuracy,
          confidence: 0.8,
          provider: 'azure',
          providerMetric: 'accuracy',
          summary: 'Japanese segmental accuracy signal; pitch and prosody are not scored.',
          observedAt: Date.now()
        }));
      }
      if (Number.isFinite(pronunciation?.fluency)) {
        acousticEvidence.push(normalizeMasteryEvidence({
          id: `acoustic_${clipId}_${skillId.replace(/[^a-z0-9]+/gi, '_')}_fluency`,
          skillId,
          source: 'acoustic',
          sessionId: controller.id,
          turnId,
          activityId: previous.activityId,
          dimension: 'fluency',
          score: pronunciation.fluency,
          confidence: 0.8,
          provider: 'azure',
          providerMetric: 'fluency',
          summary: 'Japanese fluency signal from the configured specialist provider.',
          observedAt: Date.now()
        }));
      }
    });
    if (!controller.profile || !controller.preferences || !controller.mastery || !controller.reviewItems) {
      const learningState = await readUserLearningState(controller.userId);
      controller.profile = controller.profile || learningState.profile;
      controller.preferences = controller.preferences || learningState.preferences;
      controller.mastery = controller.mastery || learningState.mastery;
      controller.reviewItems = controller.reviewItems || learningState.reviewItems;
    }
    if (Number.isFinite(pronunciation?.accuracy)) {
      controller.profile = applyProfileDimensionEvidence(controller.profile, 'phonology', pronunciation.accuracy, 0.8);
    }
    if (Number.isFinite(pronunciation?.fluency)) {
      controller.profile = applyProfileDimensionEvidence(controller.profile, 'fluency', pronunciation.fluency, 0.8);
    }
    await Promise.all([
      persistAssessment(controller, enriched),
      persistEvidence(controller, acousticEvidence),
      persistController(controller),
      writeUserLearningState(controller.userId, {
        profile: controller.profile,
        preferences: controller.preferences,
        mastery: controller.mastery,
        reviewItems: controller.reviewItems
      })
    ]);
  }

  async function pruneAudioBudget(userId, activeSessionId) {
    const rows = parseSqliteJson(await runSqlite(workspaceDbPath, `
      SELECT clip_id, session_id, storage_path, byte_length, duration_ms
      FROM user_tutor_audio_v2
      WHERE user_id = ${sqlString(userId)}
        AND pinned = 0
        AND benchmark = 0
      ORDER BY created_at ASC;
    `, { json: true }));
    let totalBytes = rows.reduce((sum, row) => sum + (Number(row.byte_length) || 0), 0);
    let activeDurationMs = rows
      .filter((row) => row.session_id === activeSessionId)
      .reduce((sum, row) => sum + (Number(row.duration_ms) || 0), 0);
    const remove = [];
    rows.forEach((row) => {
      const overBudget = totalBytes > boundedAudioMaxBytes;
      const overSessionDuration = row.session_id === activeSessionId && activeDurationMs > (10 * 60 * 1000);
      if (!overBudget && !overSessionDuration) return;
      remove.push(row);
      totalBytes -= Number(row.byte_length) || 0;
      if (row.session_id === activeSessionId) activeDurationMs -= Number(row.duration_ms) || 0;
    });
    if (!remove.length) return;
    await Promise.all(remove.map((row) => fs.unlink(row.storage_path).catch(() => {})));
    const clipIds = remove.map((row) => sqlString(row.clip_id)).join(',');
    await runSqlite(workspaceDbPath, `
      DELETE FROM user_tutor_audio_analysis_v2
      WHERE user_id = ${sqlString(userId)} AND clip_id IN (${clipIds});
      DELETE FROM user_tutor_audio_v2
      WHERE user_id = ${sqlString(userId)} AND clip_id IN (${clipIds});
    `);
  }

  async function scoreWithAzure({ bytes, mimeType, referenceText }) {
    if (!azureSpeechKey || !azureSpeechRegion) {
      return { available: false, provider: 'azure', reason: 'Azure Speech is not configured.' };
    }
    const normalizedMime = cleanString(mimeType, 120).toLowerCase();
    if (!normalizedMime.includes('wav') && !normalizedMime.includes('ogg')) {
      return {
        available: false,
        provider: 'azure',
        reason: 'Azure scoring requires WAV or Ogg audio; the recording remains available for playback.'
      };
    }
    const config = {
      ReferenceText: referenceText || '',
      GradingSystem: 'HundredMark',
      Granularity: 'Word',
      Dimension: 'Comprehensive',
      EnableMiscue: Boolean(referenceText)
    };
    const endpoint = `https://${azureSpeechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ja-JP&format=detailed`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureSpeechKey,
        'Content-Type': mimeType,
        'Pronunciation-Assessment': Buffer.from(JSON.stringify(config)).toString('base64')
      },
      body: bytes
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || 'Azure pronunciation assessment failed');
    const assessment = payload?.NBest?.[0]?.PronunciationAssessment || {};
    return {
      available: true,
      provider: 'azure',
      locale: 'ja-JP',
      accuracy: Number.isFinite(Number(assessment.AccuracyScore)) ? Number(assessment.AccuracyScore) / 100 : null,
      fluency: Number.isFinite(Number(assessment.FluencyScore)) ? Number(assessment.FluencyScore) / 100 : null,
      completeness: Number.isFinite(Number(assessment.CompletenessScore)) ? Number(assessment.CompletenessScore) / 100 : null,
      pronunciation: Number.isFinite(Number(assessment.PronScore)) ? Number(assessment.PronScore) / 100 : null,
      pitchScore: null,
      prosodyScore: null,
      calibrated: false,
      notice: 'Japanese pitch and prosody are not scored by this adapter.'
    };
  }

  async function readAudio(actor, clipId) {
    const sql = `
      SELECT mime_type, storage_path
      FROM user_tutor_audio_v2
      WHERE user_id = ${sqlString(actor.id)}
        AND clip_id = ${sqlString(clipId)}
      LIMIT 1;
    `;
    const rows = parseSqliteJson(await runSqlite(workspaceDbPath, sql, { json: true }));
    if (!rows.length) return null;
    const storagePath = cleanString(rows[0].storage_path, 2000);
    if (!storagePath || !path.resolve(storagePath).startsWith(path.resolve(audioDirectory))) return null;
    const bytes = await fs.readFile(storagePath).catch(() => null);
    return bytes ? { bytes, mimeType: rows[0].mime_type || 'audio/webm' } : null;
  }

  async function pruneExpiredAudio() {
    lastPruneAt = Date.now();
    const now = Date.now();
    const sql = `
      SELECT user_id, clip_id, storage_path
      FROM user_tutor_audio_v2
      WHERE pinned = 0
        AND benchmark = 0
        AND expires_at IS NOT NULL
        AND expires_at <= ${now};
    `;
    const rows = parseSqliteJson(await runSqlite(workspaceDbPath, sql, { json: true }));
    await Promise.all(rows.map((row) => fs.unlink(row.storage_path).catch(() => {})));
    if (rows.length) {
      const clipIds = rows.map((row) => sqlString(row.clip_id)).join(',');
      const clauses = rows.map((row) => `(
        user_id = ${sqlString(row.user_id)} AND clip_id = ${sqlString(row.clip_id)}
      )`);
      await runSqlite(workspaceDbPath, `
        DELETE FROM user_tutor_audio_analysis_v2 WHERE clip_id IN (${clipIds});
        DELETE FROM user_tutor_audio_v2 WHERE ${clauses.join(' OR ')};
      `);
    }
  }

  async function handleRequest(req, res, requestUrl) {
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith(TUTOR_V2_API_PREFIX)) return false;
    if (!isTutorSameOriginRequest(req)) {
      writeJson(res, 403, { error: 'Use the speaking tutor from the app.' });
      return true;
    }
    try {
      const actor = await requireActor(req, res);
      if (!actor) return true;

      if (pathname === `${TUTOR_V2_API_PREFIX}/today` && req.method === 'GET') {
        const state = await readUserLearningState(actor.id);
        const mission = selectDailyMission({
          profile: state.profile,
          mastery: state.mastery,
          reviewItems: state.reviewItems,
          preferences: state.preferences
        });
        writeJson(res, 200, {
          mission,
          profile: state.profile,
          preferences: state.preferences,
          dueReviews: getDueReviewItems(state.reviewItems),
          diagnosticRecommended: !state.profile.completedDiagnosticAt,
          voiceModel: realtimeModel
        }, { 'Cache-Control': 'no-store' });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/diagnostic` && req.method === 'POST') {
        const body = await readRequestJson(req);
        const controller = await createSession(actor, { ...body, diagnostic: true });
        writeJson(res, 201, { session: serializeController(controller) });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/benchmark` && req.method === 'POST') {
        const body = await readRequestJson(req);
        const controller = await createSession(actor, { ...body, diagnostic: true, benchmark: true });
        writeJson(res, 201, { session: serializeController(controller) });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/import-legacy` && req.method === 'POST') {
        const body = await readRequestJson(req);
        writeJson(res, 200, await importLegacyHistory(actor.id, body));
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/data` && req.method === 'DELETE') {
        writeJson(res, 200, await deleteAllTutorData(actor));
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/sessions` && req.method === 'GET') {
        writeJson(res, 200, { sessions: await listSessions(actor.id) }, { 'Cache-Control': 'no-store' });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/sessions` && req.method === 'POST') {
        const body = await readRequestJson(req);
        const controller = await createSession(actor, body);
        writeJson(res, 201, { session: serializeController(controller) });
        return true;
      }

      const sessionMatch = pathname.match(/^\/api\/tutor\/v2\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === 'GET') {
        const controller = await readController(actor.id, sanitizeId(decodeURIComponent(sessionMatch[1])));
        if (!controller) {
          writeJson(res, 404, { error: 'Tutor session not found' });
          return true;
        }
        controller.lastReadAt = Date.now();
        writeJson(res, 200, {
          session: {
            ...serializeController(controller),
            turns: await readSessionTurns(actor.id, controller.id)
          }
        }, { 'Cache-Control': 'no-store' });
        return true;
      }

      if (sessionMatch && req.method === 'DELETE') {
        writeJson(res, 200, await deleteSession(actor, decodeURIComponent(sessionMatch[1])));
        return true;
      }

      const connectMatch = pathname.match(/^\/api\/tutor\/v2\/sessions\/([^/]+)\/connect$/);
      if (connectMatch && req.method === 'POST') {
        if (!apiKey) {
          writeJson(res, 501, { error: 'Missing OPENAI_API_KEY' });
          return true;
        }
        const controller = await readController(actor.id, sanitizeId(decodeURIComponent(connectMatch[1])));
        if (!controller || controller.status !== 'active') {
          writeJson(res, 404, { error: 'Active tutor session not found' });
          return true;
        }
        if (!controller.profile) {
          const state = await readUserLearningState(actor.id);
          controller.profile = state.profile;
          controller.preferences = state.preferences;
          controller.mastery = state.mastery;
          controller.reviewItems = state.reviewItems;
        }
        const offerSdp = (await readRequestBody(req, 1024 * 1024)).toString('utf8');
        if (!offerSdp.trim()) {
          writeJson(res, 400, { error: 'Missing SDP offer' });
          return true;
        }
        const { answerSdp, callId } = await connectRealtime(controller, offerSdp);
        writeSdp(res, 200, answerSdp);
        scheduleSideband(controller, callId);
        return true;
      }

      const endMatch = pathname.match(/^\/api\/tutor\/v2\/sessions\/([^/]+)\/end$/);
      if (endMatch && req.method === 'POST') {
        const controller = await readController(actor.id, sanitizeId(decodeURIComponent(endMatch[1])));
        if (!controller) {
          writeJson(res, 404, { error: 'Tutor session not found' });
          return true;
        }
        await completeSession(controller);
        const progress = await readProgress(actor.id);
        writeJson(res, 200, {
          session: serializeController(controller),
          profile: progress.profile,
          progress
        });
        return true;
      }

      const assessmentMatch = pathname.match(/^\/api\/tutor\/v2\/turns\/([^/]+)\/assessment$/);
      if (assessmentMatch && req.method === 'POST') {
        const body = await readRequestJson(req);
        const controller = await readController(actor.id, sanitizeId(body.sessionId));
        if (!controller) {
          writeJson(res, 404, { error: 'Tutor session not found' });
          return true;
        }
        const assessment = await assessTurn(controller, {
          turnId: sanitizeId(decodeURIComponent(assessmentMatch[1])),
          transcript: cleanString(body.transcript, 12000),
          acoustic: body.acoustic || {}
        });
        writeJson(res, 200, {
          assessment,
          activityState: controller.activityState,
          currentActivity: getCurrentActivity(controller.blueprint, controller.activityState),
          director: {
            status: controller.directorStatus || 'idle',
            sidebandConnected: controller.ws?.readyState === WebSocket.OPEN
          }
        });
        return true;
      }

      const audioUploadMatch = pathname.match(/^\/api\/tutor\/v2\/turns\/([^/]+)\/audio$/);
      if (audioUploadMatch && req.method === 'POST') {
        const clip = await storeAudio(actor, requestUrl, req, decodeURIComponent(audioUploadMatch[1]));
        writeJson(res, 201, { clip });
        return true;
      }

      const audioReadMatch = pathname.match(/^\/api\/tutor\/v2\/audio\/([^/]+)$/);
      if (audioReadMatch && req.method === 'GET') {
        const audio = await readAudio(actor, sanitizeId(decodeURIComponent(audioReadMatch[1])));
        if (!audio) {
          writeJson(res, 404, { error: 'Audio not found' });
          return true;
        }
        res.writeHead(200, {
          'Content-Type': audio.mimeType,
          'Cache-Control': 'private, max-age=3600'
        });
        res.end(audio.bytes);
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/progress` && req.method === 'GET') {
        writeJson(res, 200, await readProgress(actor.id), { 'Cache-Control': 'no-store' });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/quality` && req.method === 'GET') {
        writeJson(res, 200, await readQuality(actor.id), { 'Cache-Control': 'no-store' });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/quality/labels` && req.method === 'POST') {
        const body = await readRequestJson(req);
        const sessionId = sanitizeId(body.sessionId);
        const turnId = sanitizeId(body.turnId);
        if (!sessionId || !turnId || typeof body.accurate !== 'boolean') {
          writeJson(res, 400, { error: 'sessionId, turnId, and an accurate boolean are required' });
          return true;
        }
        const labelId = sanitizeId(body.id, createId('label'));
        const now = Date.now();
        await runSqlite(workspaceDbPath, `
          INSERT INTO user_tutor_correction_labels_v2 (
            user_id, label_id, session_id, turn_id, accurate, evaluator, notes, created_at
          ) VALUES (
            ${sqlString(actor.id)},
            ${sqlString(labelId)},
            ${sqlString(sessionId)},
            ${sqlString(turnId)},
            ${body.accurate ? 1 : 0},
            ${sqlString(cleanString(body.evaluator, 160))},
            ${sqlString(cleanString(body.notes, 1000))},
            ${now}
          )
          ON CONFLICT(user_id, label_id) DO UPDATE SET
            accurate = excluded.accurate,
            evaluator = excluded.evaluator,
            notes = excluded.notes;
        `);
        writeJson(res, 201, { ok: true, id: labelId });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/preferences` && req.method === 'GET') {
        const state = await readUserLearningState(actor.id);
        writeJson(res, 200, { preferences: state.preferences, profile: state.profile });
        return true;
      }

      if (pathname === `${TUTOR_V2_API_PREFIX}/preferences` && req.method === 'PUT') {
        const body = await readRequestJson(req);
        const state = await readUserLearningState(actor.id);
        const preferences = normalizePreferences({ ...state.preferences, ...body, updatedAt: Date.now() });
        for (const controller of controllers.values()) {
          if (controller.userId === actor.id && controller.status === 'active') {
            controller.preferences = preferences;
          }
        }
        const profile = normalizeSpeakingProfile({
          ...state.profile,
          contentCeiling: preferences.contentCeiling,
          goal: preferences.goal || state.profile.goal,
          updatedAt: Date.now()
        });
        const written = await writeUserLearningState(actor.id, {
          ...state,
          profile,
          preferences
        });
        writeJson(res, 200, { preferences: written.preferences, profile: written.profile });
        return true;
      }

      writeJson(res, 405, { error: 'Unsupported Tutor v2 route or method' });
      return true;
    } catch (error) {
      const status = Number.isFinite(error?.status) ? Math.trunc(error.status) : 500;
      logger.error?.('[tutor-v2] request failed', error);
      writeJson(res, status, { error: error?.message || 'Tutor v2 request failed' });
      return true;
    }
  }

  async function close() {
    await Promise.allSettled(Array.from(controllers.values())
      .filter((controller) => controller.liveDirector)
      .map(async (controller) => {
        controller.liveClosing = true;
        await controller.liveDirector.close();
        controller.liveAudio?.clear();
      }));
    controllers.forEach((controller) => {
      clearSidebandRetry(controller);
      if (controller.ws) {
        try { controller.ws.close(); } catch (error) { /* Ignore shutdown errors. */ }
      }
    });
    controllers.clear();
  }

  return {
    ensureSchema,
    handleRequest,
    close,
    readProgress,
    readQuality,
    scoreWithAzure
  };
}
