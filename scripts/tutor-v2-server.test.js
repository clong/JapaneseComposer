import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createTutorV2TranscriptionConfig,
  createTutorV2RealtimeSessionConfig,
  createTutorV2Service,
  extractRealtimeCallId,
  getSidebandRetryDelay,
  rebuildTutorLearningState,
  reconcileTutorMilestoneState,
  shouldRecordTutorMilestone,
  TUTOR_V2_EVIDENCE_MIGRATION_ID,
  TUTOR_V2_MIGRATION_ID,
  TUTOR_V2_QUALITY_MIGRATION_ID
} from './tutor-v2-server.js';
import {
  buildDiagnosticBlueprint,
  createInitialActivityState
} from '../src/tutor-v2.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('Realtime Whisper transcription config omits unsupported prompt steering', () => {
  assert.deepEqual(createTutorV2TranscriptionConfig('auto'), {
    model: 'gpt-realtime-whisper'
  });
  assert.deepEqual(createTutorV2TranscriptionConfig('ja'), {
    model: 'gpt-realtime-whisper',
    language: 'ja'
  });
  assert.deepEqual(createTutorV2TranscriptionConfig('en'), {
    model: 'gpt-realtime-whisper',
    language: 'en'
  });
  assert.equal('prompt' in createTutorV2TranscriptionConfig('auto'), false);
});

test('Realtime call IDs are parsed safely and sideband retries only transient 404s', () => {
  assert.equal(extractRealtimeCallId('/v1/realtime/calls/rtc_u1_example_123'), 'rtc_u1_example_123');
  assert.equal(extractRealtimeCallId('https://api.openai.com/v1/realtime/calls/rtc_example?source=webrtc'), 'rtc_example');
  assert.equal(extractRealtimeCallId('/v1/realtime/calls/not-a-call'), '');
  assert.equal(extractRealtimeCallId(''), '');

  assert.equal(getSidebandRetryDelay(404, 0), 400);
  assert.equal(getSidebandRetryDelay(404, 3), 3200);
  assert.equal(getSidebandRetryDelay(404, 4), null);
  assert.equal(getSidebandRetryDelay(401, 0), null);
  assert.equal(getSidebandRetryDelay(500, 0), null);
});

test('Realtime session starts without tools that require a missing sideband handler', () => {
  const blueprint = buildDiagnosticBlueprint({});
  const config = createTutorV2RealtimeSessionConfig({
    model: 'gpt-realtime-2',
    blueprint,
    activityState: createInitialActivityState(blueprint),
    preferences: {
      transcriptionMode: 'auto',
      speechRate: 0.85,
      voice: 'marin',
      contentCeiling: 'N5'
    },
    voice: 'marin'
  });

  assert.equal(config.type, 'realtime');
  assert.equal(config.model, 'gpt-realtime-2');
  assert.deepEqual(config.tools, []);
  assert.equal(config.tool_choice, 'none');
  assert.equal(config.audio.input.turn_detection.create_response, false);
  assert.equal(config.audio.input.turn_detection.interrupt_response, false);
  assert.ok(Math.abs(config.audio.output.speed - 0.85) < 0.001);
});

test('failed baselines cannot become profile milestones', () => {
  assert.equal(shouldRecordTutorMilestone('diagnostic_1', 0), false);
  assert.equal(shouldRecordTutorMilestone('diagnostic_1', 1), true);
  assert.equal(shouldRecordTutorMilestone('mission_1', 3), false);

  const reconciled = reconcileTutorMilestoneState({
    completedDiagnosticAt: 123,
    strengths: ['Existing strength'],
    recurringMistakes: ['Existing mistake']
  }, [{
    sessionId: 'failed_baseline',
    status: 'completed',
    missionId: 'diagnostic_1',
    assessmentCount: 0,
    userTurnCount: 0
  }], 456);
  assert.equal(reconciled.profile.completedDiagnosticAt, null);
  assert.deepEqual(reconciled.profile.strengths, ['Existing strength']);
  assert.deepEqual(reconciled.profile.recurringMistakes, ['Existing mistake']);
  assert.deepEqual(reconciled.invalidSessionIds, ['failed_baseline']);
});

test('deleting session evidence rebuilds the speaking profile and review state', () => {
  const assessment = {
    id: 'assessment_remaining',
    turnId: 'turn_remaining',
    activityId: 'activity_remaining',
    transcript: '日本に行きました。',
    transcriptConfidence: 0.9,
    understood: true,
    taskCompleted: true,
    taskScore: 0.52,
    dimensions: {
      interaction: 0.52,
      production: 0.5,
      listening: 0.48,
      grammar: 0.5,
      vocabulary: 0.46,
      fluency: 0.44,
      phonology: 0.5
    },
    targetSkillIds: ['a1.introductions'],
    grammarFindings: ['Particle choice'],
    vocabularyFindings: [],
    fillers: [],
    correction: {
      required: false,
      requiresRepair: false,
      original: '',
      corrected: '',
      explanation: '',
      confidence: 0.8
    },
    repairSuccessful: false,
    notes: [],
    createdAt: 1000
  };
  const rebuilt = rebuildTutorLearningState({
    profile: {
      overallLevel: 'B2',
      contentCeiling: 'N3',
      strengths: ['Clear interaction'],
      recurringMistakes: ['Particle choice'],
      completedDiagnosticAt: 900,
      lastBenchmarkAt: 950
    },
    assessments: [assessment],
    milestoneSessions: [],
    now: 2000
  });

  assert.equal(rebuilt.profile.overallLevel, 'A1');
  assert.equal(rebuilt.profile.contentCeiling, 'N3');
  assert.equal(rebuilt.profile.completedDiagnosticAt, null);
  assert.equal(rebuilt.profile.lastBenchmarkAt, null);
  assert.deepEqual(rebuilt.profile.strengths, []);
  assert.deepEqual(rebuilt.profile.recurringMistakes, ['Particle choice']);
  assert.equal(rebuilt.mastery['a1.introductions'].evidenceCount, 1);
  assert.equal(rebuilt.reviewItems.length, 1);

  const empty = rebuildTutorLearningState({ profile: rebuilt.profile, now: 3000 });
  assert.equal(empty.profile.overallLevel, 'A1');
  assert.equal(empty.profile.dimensions.interaction.evidenceCount, 0);
  assert.deepEqual(empty.profile.recurringMistakes, []);
  assert.deepEqual(empty.mastery, {});
  assert.deepEqual(empty.reviewItems, []);
});

test('Tutor v2 migrations create versioned learning and file-audio metadata tables', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jc-tutor-v2-'));
  const sqlCalls = [];
  const service = createTutorV2Service({
    workspaceDbPath: path.join(directory, 'workspace.sqlite'),
    audioDirectory: path.join(directory, 'audio'),
    runSqlite: async (_dbPath, sql, options = {}) => {
      sqlCalls.push(sql);
      return options.json ? '[]' : '';
    },
    sqlString: (value) => `'${String(value).replaceAll("'", "''")}'`,
    parseSqliteJson: (value) => JSON.parse(value || '[]'),
    writeJson: () => {},
    getActor: async () => ({ id: 'local' }),
    logger: { warn() {}, error() {} }
  });
  try {
    await service.ensureSchema();
    const schema = sqlCalls.join('\n');
    assert.match(schema, new RegExp(TUTOR_V2_MIGRATION_ID));
    assert.match(schema, new RegExp(TUTOR_V2_EVIDENCE_MIGRATION_ID));
    assert.match(schema, new RegExp(TUTOR_V2_QUALITY_MIGRATION_ID));
    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tutor_profiles_v2/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tutor_skill_mastery/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tutor_mastery_evidence/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tutor_audio_analysis_v2/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tutor_turns_v2/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS user_tutor_quality_metrics_v2/);
    assert.match(schema, /storage_path TEXT NOT NULL/);
  } finally {
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Tutor v2 routes keep server credentials behind SDP and sideband control', async () => {
  const source = await fs.readFile(path.join(root, 'scripts/tutor-v2-server.js'), 'utf8');
  assert.ok(source.includes("const connectMatch = pathname.match(/^\\/api\\/tutor\\/v2\\/sessions"));
  assert.doesNotMatch(source, /https:\/\/api\.openai\.com\/v1\/realtime\/client_secrets/);
  assert.match(source, /https:\/\/api\.openai\.com\/v1\/realtime\/calls/);
  assert.match(source, /const formData = new FormData\(\)/);
  assert.match(source, /formData\.set\('sdp', offerSdp\)/);
  assert.match(source, /formData\.set\('session'/);
  assert.match(source, /wss:\/\/api\.openai\.com\/v1\/realtime\?call_id=/);
  assert.match(source, /type: 'session\.update'/);
  assert.match(source, /type: 'response\.create'/);
  assert.match(source, /writeSdp\(res, 200, answerSdp\);\s*scheduleSideband\(controller, callId\);/);
  assert.match(source, /Unexpected server response:\\s\*\(\\d\+\)/);
  assert.match(source, /ws\.on\('unexpected-response'/);
  assert.match(source, /interrupt_response: false/);
  assert.match(source, /tool_choice: 'none'/);
  assert.doesNotMatch(source, /writeJson\([^\n]+\{[^\n]+apiKey/);
});

test('Tutor v2 exposes the planned session, assessment, progress, and privacy surfaces', async () => {
  const source = await fs.readFile(path.join(root, 'scripts/tutor-v2-server.js'), 'utf8');
  for (const pathFragment of [
    '/today', '/diagnostic', '/benchmark', '/sessions', '/connect', '/end',
    '/assessment', '/audio/', '/progress', '/quality', '/preferences', '/import-legacy', '/data'
  ]) {
    assert.ok(source.includes(pathFragment), `missing route fragment ${pathFragment}`);
  }
  assert.match(source, /async function deleteSession/);
  assert.match(source, /AS turn_count/);
  assert.match(source, /ORDER BY session\.updated_at DESC/);
  assert.match(source, /SELECT session_id, payload, imported_at\s+FROM user_tutor_legacy_sessions_v2/);
  assert.match(source, /legacy: true/);
  assert.match(source, /DELETE FROM user_tutor_audio_v2/);
  assert.match(source, /DELETE FROM user_tutor_legacy_sessions_v2/);
  assert.match(source, /rebuildUserLearningState\(actor\.id\)/);
  assert.match(source, /DELETE FROM user_tutor_skill_mastery WHERE user_id/);
  assert.match(source, /fs\.unlink/);
});
