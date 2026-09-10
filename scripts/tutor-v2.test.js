import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceLessonState,
  applyAssessmentToMastery,
  buildDiagnosticBlueprint,
  buildLessonBlueprint,
  buildTutorV2RealtimeInstructions,
  createInitialActivityState,
  deriveSpeakingProfile,
  getDueReviewItems,
  migrateLegacyTutorData,
  normalizeBenchmarkResult,
  normalizeMasteryEvidence,
  normalizeSpeakingProfile,
  selectDailyMission,
  TUTOR_SKILL_GRAPH,
  TUTOR_TURN_ASSESSMENT_JSON_SCHEMA
} from '../src/tutor-v2.js';

function assessment(overrides = {}) {
  return {
    id: 'assessment_1',
    turnId: 'turn_1',
    activityId: 'activity_1',
    transcript: 'レストランで水をお願いします。',
    transcriptConfidence: 0.9,
    understood: true,
    taskCompleted: true,
    taskScore: 0.8,
    dimensions: {
      interaction: 0.8,
      production: 0.7,
      listening: 0.7,
      grammar: 0.75,
      vocabulary: 0.8,
      fluency: 0.65,
      phonology: 0.6
    },
    targetSkillIds: ['a1.basic-requests'],
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
    notes: [],
    ...overrides
  };
}

test('skill graph is prerequisite-consistent across A1-B2', () => {
  const ids = new Set(TUTOR_SKILL_GRAPH.map((entry) => entry.id));
  assert.ok(TUTOR_SKILL_GRAPH.length >= 30);
  assert.deepEqual(new Set(TUTOR_SKILL_GRAPH.map((entry) => entry.level)), new Set(['A1', 'A2', 'B1', 'B2']));
  TUTOR_SKILL_GRAPH.forEach((entry) => {
    entry.prerequisites.forEach((id) => assert.ok(ids.has(id), `${entry.id} has missing prerequisite ${id}`));
  });
});

test('legacy tutor profile becomes a multidimensional speaking profile', () => {
  const migrated = migrateLegacyTutorData({
    profile: {
      estimatedLevel: 'N4 / A2',
      vocabularyLevel: 'N4',
      strengths: ['listening']
    },
    sessions: [{ id: 'legacy_1' }]
  });
  assert.equal(migrated.speakingProfile.overallLevel, 'A2');
  assert.equal(migrated.speakingProfile.contentCeiling, 'N4');
  assert.equal(migrated.speakingProfile.dimensions.interaction.level, 'A2');
  assert.equal(migrated.legacySessions[0].legacy, true);
});

test('fresh profile and mastery timestamps remain absent until evidence exists', () => {
  const profile = normalizeSpeakingProfile({ overallLevel: 'A1' });
  assert.equal(profile.completedDiagnosticAt, null);
  assert.equal(profile.lastBenchmarkAt, null);

  const migrated = migrateLegacyTutorData({ profile: {}, sessions: [] });
  assert.equal(migrated.speakingProfile.completedDiagnosticAt, null);
  assert.equal(migrated.speakingProfile.lastBenchmarkAt, null);
});

test('daily mission prioritizes due and weak skills', () => {
  const now = Date.now();
  const mission = selectDailyMission({
    profile: normalizeSpeakingProfile({ overallLevel: 'A2' }),
    mastery: {
      'a1.introductions': { skillId: 'a1.introductions', mastery: 0.9, confidence: 0.8 },
      'a1.simple-questions': { skillId: 'a1.simple-questions', mastery: 0.8, confidence: 0.8 },
      'a1.basic-requests': { skillId: 'a1.basic-requests', mastery: 0.35, confidence: 0.7 }
    },
    reviewItems: [{
      id: 'review_request',
      skillId: 'a1.basic-requests',
      dueAt: now - 1000,
      intervalDays: 1
    }],
    preferences: { mode: 'scenario', durationMinutes: 10 },
    now
  });
  assert.equal(mission.mode, 'scenario');
  assert.equal(mission.durationMinutes, 10);
  assert.equal(mission.targetSkillIds[0], 'a1.basic-requests');
  assert.equal(mission.reviewItemIds[0], 'review_request');
});

test('lesson state routes a high-confidence correction through repair', () => {
  const blueprint = buildLessonBlueprint({
    mission: {
      id: 'mission_1',
      mode: 'guided',
      level: 'A1',
      targetSkillIds: ['a1.basic-requests']
    },
    profile: { contentCeiling: 'N5' }
  });
  assert.ok(blueprint.activities.every((activity) => activity.difficultyLevel === 'A1'));
  let state = createInitialActivityState(blueprint);
  state = { ...state, activityIndex: 2, phase: 'scaffolded_attempt' };
  state = advanceLessonState({
    blueprint,
    state,
    assessment: assessment({
      correction: {
        required: true,
        confidence: 0.92,
        category: 'particle',
        original: '水がお願いします',
        corrected: '水をお願いします',
        explanation: 'Use を for the requested object.',
        requiresRepair: true
      }
    })
  });
  assert.equal(state.phase, 'repair');
  assert.equal(state.repairRequired, true);
  assert.equal(state.pendingCorrection, '水をお願いします');

  state = advanceLessonState({
    blueprint,
    state,
    assessment: assessment({ repairSuccessful: true })
  });
  assert.equal(state.repairRequired, false);
  assert.notEqual(state.phase, 'repair');
});

test('assessment updates mastery and schedules delayed retrieval', () => {
  const now = Date.now();
  const result = applyAssessmentToMastery({ assessment: assessment(), now });
  assert.ok(result.mastery['a1.basic-requests'].mastery > 0.2);
  assert.equal(result.mastery['a1.basic-requests'].evidenceCount, 1);
  assert.equal(result.reviewItems.length, 1);
  assert.ok(result.reviewItems[0].dueAt > now);
  assert.equal(getDueReviewItems(result.reviewItems, now).length, 0);
  const profile = deriveSpeakingProfile({ overallLevel: 'A1' }, result.mastery);
  assert.ok(profile.dimensions.interaction.evidenceCount > 0);
});

test('diagnostic and realtime instructions expose controlled phases', () => {
  const blueprint = buildDiagnosticBlueprint({ profile: { overallLevel: 'A2' } });
  const state = createInitialActivityState(blueprint);
  const instructions = buildTutorV2RealtimeInstructions({
    profile: { overallLevel: 'A2', contentCeiling: 'N4' },
    blueprint,
    state,
    preferences: { speechRate: 0.85 }
  });
  assert.equal(blueprint.activities.length, 8);
  assert.deepEqual(blueprint.activities.slice(0, 5).map((activity) => activity.difficultyLevel), ['A1', 'A1', 'A1', 'A1', 'A1']);
  assert.equal(blueprint.activities[5].difficultyLevel, 'A2');
  assert.equal(blueprint.activities[6].difficultyLevel, 'B1');
  assert.match(instructions, /# Current activity/);
  assert.match(instructions, /always starts with very simple A1\/N5 Japanese/);
  assert.match(instructions, /This product practices spoken Japanese only/);
  assert.match(instructions, /Never ask the learner to speak English/);
  assert.match(instructions, /Use one instructional move and exactly one question per turn/);
  assert.match(instructions, /Vocabulary ceiling: N4/);
});

test('diagnostic repeats simple tasks before advancing and never routes through repair', () => {
  const blueprint = buildDiagnosticBlueprint();
  let state = createInitialActivityState(blueprint);
  const missed = assessment({
    understood: false,
    taskCompleted: false,
    taskScore: 0.2,
    correction: {
      required: true,
      confidence: 0.95,
      category: 'missed_target',
      original: 'わかりません',
      corrected: 'クリスです',
      explanation: 'Answer with your name.',
      requiresRepair: true
    }
  });
  state = advanceLessonState({ blueprint, state, assessment: missed });
  assert.equal(state.activityIndex, 0);
  assert.equal(state.attemptCount, 1);
  assert.equal(state.repairRequired, false);

  state = advanceLessonState({ blueprint, state, assessment: missed });
  assert.equal(state.activityIndex, 1);
  assert.equal(state.attemptCount, 0);
  assert.equal(state.diagnosticStruggleCount, 2);
});

test('diagnostic unlocks harder bands only after lower-band success', () => {
  const blueprint = buildDiagnosticBlueprint();
  let state = createInitialActivityState(blueprint);
  for (let index = 0; index < 5; index += 1) {
    state = advanceLessonState({ blueprint, state, assessment: assessment() });
  }
  assert.equal(state.activityIndex, 5);
  assert.equal(state.diagnosticPassCount, 5);

  state = advanceLessonState({
    blueprint,
    state,
    assessment: assessment({ understood: false, taskCompleted: false, taskScore: 0.25 })
  });
  state = advanceLessonState({
    blueprint,
    state,
    assessment: assessment({ understood: false, taskCompleted: false, taskScore: 0.25 })
  });
  assert.equal(state.activityIndex, 7);
  assert.equal(state.phase, 'recap');
});

test('turn assessment schema is strict and dimension-complete', () => {
  assert.equal(TUTOR_TURN_ASSESSMENT_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    Object.keys(TUTOR_TURN_ASSESSMENT_JSON_SCHEMA.properties.dimensions.properties),
    ['interaction', 'production', 'listening', 'grammar', 'vocabulary', 'fluency', 'phonology']
  );
});

test('mastery evidence rejects unregistered skills and preserves source confidence', () => {
  assert.equal(normalizeMasteryEvidence({ skillId: 'not-real', source: 'task' }), null);
  const evidence = normalizeMasteryEvidence({
    id: 'evidence_1',
    skillId: 'a1.simple-questions',
    source: 'repair',
    score: 0.88,
    confidence: 0.91,
    repairSuccessful: true
  });
  assert.equal(evidence.source, 'repair');
  assert.equal(evidence.repairSuccessful, true);
  assert.equal(evidence.confidence, 0.91);
});

test('benchmark results retain comparable multidimensional scores', () => {
  const result = normalizeBenchmarkResult({
    id: 'benchmark_1',
    sessionId: 'session_1',
    taskScore: 0.72,
    dimensions: { interaction: 0.8, fluency: 0.65 },
    audioClipIds: ['clip_1']
  });
  assert.equal(result.promptVersion, 'jf-speaking-v1');
  assert.equal(result.dimensions.interaction, 0.8);
  assert.equal(result.audioClipIds[0], 'clip_1');
});
