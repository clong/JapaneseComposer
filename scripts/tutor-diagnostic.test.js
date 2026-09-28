import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticState, recordDiagnosticResult, diagnosticReport, pauseDiagnostic, resumeDiagnostic,
  finishDiagnosticIfDue, diagnosticActivity, normalizeDiagnosticState, validateDiagnosticDecision } from '../src/tutor-diagnostic.js';
import { createTutorDiagnosticDirector } from './tutor-diagnostic-director.js';
import { createTutorLiveSessionConfig } from '../src/tutor-live.js';
import { buildDiagnosticBlueprint, createInitialActivityState, normalizeTurnAssessment, advanceLessonState } from '../src/tutor-v2.js';

function answer(state, overrides = {}, time = 2000) {
  return recordDiagnosticResult(state, { intent: 'answer', complete: true, success: true, confidence: 0.9,
    validity: 'valid', assistance: false, observation: 'Answered the pending question.', topic: 'food', ...overrides },
  { turnId: `t${state.exchanges.length}`, questionId: state.pendingQuestion.id, answerRevision: state.exchanges.length + 1,
    transcript: 'すしです。' }, time);
}

test('baseline starts extremely simply and two distinct successes unlock one harder factor', () => {
  let state = createDiagnosticState('test', 1000);
  assert.match(diagnosticActivity(state).instructions, /お名前は何ですか/);
  state = answer(state);
  assert.equal(state.pendingQuestion.band, 0);
  assert.equal(diagnosticReport(state).domains[0].level, null);
  state = answer(state);
  assert.equal(state.pendingQuestion.band, 1);
  assert.equal(state.pendingQuestion.vocabularyCeiling, 'N5', 'Interaction challenge does not simultaneously raise vocabulary difficulty.');
  assert.equal(state.evidence.at(-1).nextDecision, 'increase_one_factor');
  assert.equal(diagnosticReport(state).domains[0].level, 'A1');
});

test('help and meta questions do not consume attempts or lower ability', () => {
  let state = createDiagnosticState('test', 1000);
  const id = state.pendingQuestion.id;
  state = answer(state, { intent: 'off_topic', success: false });
  state = answer(state, { intent: 'clarification', success: false });
  assert.equal(state.pendingQuestion.id, id);
  assert.equal(state.evidence.length, 0);
  state = answer(state);
  assert.equal(state.evidence[0].outcome, 'supported');
  assert.equal(state.pendingQuestion.band, 0);
});

test('repeating the same spoken question does not count as two distinct successful probes', () => {
  let state = createDiagnosticState('repeat', 1000);
  state.pendingQuestion.spokenText = 'お名前は何ですか？'; state = answer(state);
  state.pendingQuestion.spokenText = 'お名前は何ですか。'; state = answer(state);
  assert.equal(state.pendingQuestion.band, 0);
  assert.equal(diagnosticReport(state).domains[0].level, null);
});

test('a first difficulty requests help; repeated difficulty becomes targeted evidence', () => {
  let state = createDiagnosticState('test', 1000);
  state = answer(state, { success: false });
  assert.equal(state.evidence[0].outcome, 'uncertain');
  assert.equal(state.pendingQuestion.assistance, 'hint');
  state = answer(state, { success: false });
  assert.equal(state.evidence[1].outcome, 'not_yet_demonstrated');
  assert.equal(state.pendingQuestion.domain, 'vocabulary');
});

test('unclear and unfinished speech do not award evidence; results are idempotent and question-bound', () => {
  const state = createDiagnosticState('test', 1000);
  assert.equal(answer(state, { complete: false }).evidence.length, 0);
  assert.equal(answer(state, { confidence: 0.3 }).evidence.length, 0);
  const turn = { turnId: 't1', questionId: state.pendingQuestion.id, answerRevision: 1, transcript: 'Chrisです' };
  const result = { intent: 'answer', complete: true, success: true, confidence: 0.9, validity: 'valid' };
  const next = recordDiagnosticResult(state, result, turn, 2000);
  assert.equal(recordDiagnosticResult(next, result, turn, 2500).evidence.length, 1);
});

test('baseline pauses and resumes without counting time away, and time limit is honestly partial', () => {
  const paused = pauseDiagnostic(createDiagnosticState('test', 1000), 61_000);
  assert.equal(paused.elapsedMs, 60_000);
  const resumed = resumeDiagnostic(paused, 1_000_000);
  assert.equal(resumed.pendingQuestion.id, paused.pendingQuestion.id);
  assert.equal(finishDiagnosticIfDue(resumed, 1_100_000).status, 'active');
  const done = finishDiagnosticIfDue(resumed, 1_540_000);
  assert.equal(done.completionReason, 'time_limit_partial');
  assert.equal(diagnosticReport(done).coverage, 0);
  assert.equal(diagnosticReport(null).status, 'limited_evidence');
});

test('new baseline prompts forbid assessment narration and missing dimensions stay unassessed', () => {
  const blueprint = buildDiagnosticBlueprint({ profile: { contentCeiling: 'N1' } });
  const activityState = createInitialActivityState(blueprint);
  const config = createTutorLiveSessionConfig({ blueprint, activityState, preferences: { contentCeiling: 'N1' } });
  assert.match(config.instructions, /Never announce checking/);
  assert.doesNotMatch(config.instructions, /Briefly acknowledge that you are checking/);
  assert.match(config.instructions, /Vocabulary ceiling: N5/);
  const normalized = normalizeTurnAssessment({ dimensions: { interaction: 0.8 } });
  assert.equal(normalized.dimensions.phonology, null);
  assert.equal(normalized.dimensions.vocabulary, null);
  assert.equal(normalized.acoustic.accuracy, null);
});

test('coverage finishes only after eight minutes, with distinct probes across all four domains', () => {
  let state = createDiagnosticState('complete', 1000);
  for (let i = 0; i < 12; i += 1) state = answer(state, {}, 2000 + i * 1000);
  assert.equal(diagnosticReport(state).coverage, 1);
  assert.equal(finishDiagnosticIfDue(state, 480_999).status, 'active');
  assert.equal(finishDiagnosticIfDue(state, 481_000).completionReason, 'sufficient_coverage');
  assert.deepEqual(diagnosticReport(state).unassessed, ['phonology', 'measured fluency']);
});

test('uneven skills retain separate difficulty and supported answers do not unlock a harder band', () => {
  let state = createDiagnosticState('uneven', 1000);
  state = answer(answer(state));
  assert.equal(state.pendingQuestion.band, 1);
  state = answer(state, { success: false });
  assert.equal(state.pendingQuestion.assistance, 'hint');
  state = answer(state);
  assert.equal(state.evidence.at(-1).outcome, 'supported');
  assert.equal(state.pendingQuestion.domain, 'vocabulary');
  assert.equal(state.pendingQuestion.band, 0);
  assert.equal(state.bands.interaction, 0);
  assert.equal(diagnosticReport(state).domains[0].level, 'A1');
});

test('adaptive state rejects stale activity revisions and cannot fall into legacy checklist progression', () => {
  const blueprint = buildDiagnosticBlueprint();
  const state = createInitialActivityState(blueprint);
  assert.deepEqual(advanceLessonState({ blueprint, state, assessment: { taskCompleted: true } }), state);
  const diagnostic = recordDiagnosticResult(state.diagnostic, { intent: 'answer', complete: true, success: true, confidence: 1 },
    { questionId: state.diagnostic.pendingQuestion.id, activityRevision: 99, turnId: 'old', answerRevision: 1 });
  assert.equal(diagnostic.evidence.length, 0);
  assert.throws(() => validateDiagnosticDecision({ intent: 'answer' }), /incomplete/);
  assert.equal(normalizeDiagnosticState({ version: 99 }), null);
});

const caption = (id, delta, start = 0, end = start + 500) => ({ type: 'session.input_transcript.delta', event_id: id, delta, start_ms: start, end_ms: end });
const delegate = id => ({ type: 'session.delegation.created', delegation: { id, target: 'client' } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness(assess = async () => ({ intent: 'answer', complete: true, speak: '次の短い質問。' }), options = {}) {
  const sent = []; const calls = []; const traces = [];
  const director = createTutorDiagnosticDirector({ send: e => { sent.push(e); return true; },
    assess: async turn => { calls.push(turn); return assess(turn); }, question: () => ({ id: 'q1', revision: 1, task: 'Name?' }),
    context: () => 'Pending task', persistRow: async () => {}, persistFragment: async () => {},
    status() {}, usage() {}, logError() {}, trace: e => traces.push(e), stableMs: 5, speechQuietMs: 0, ...options });
  return { director, sent, calls, traces };
}

test('missing delegation recovers a split introduction as one logical answer', async () => {
  const h = harness();
  try {
    h.director.handle(caption('u1', 'クリスと申します。出身は', 0, 1000));
    h.director.handle(caption('u2', 'カリフォルニアです', 2700, 3500));
    await delay(20); await h.director.drain();
    assert.equal(h.calls.length, 1);
    assert.match(h.calls[0].transcript, /出身は カリフォルニアです/);
    assert.equal(h.sent.filter(e => e.type === 'session.commentary.append').length, 1);
    assert.equal(h.sent.filter(e => e.type === 'session.instructions.append').length, 0);
    h.director.handle(delegate('d1')); h.director.handle(delegate('d2'));
    await delay(15); assert.equal(h.calls.length, 1);
  } finally { h.director.cancel(); }
});

test('late caption revisions discard stale work and retry without another delegation', async () => {
  let finish;
  const h = harness(async turn => {
    if (h.calls.length === 1) await new Promise(resolve => { finish = resolve; });
    return turn.isCurrent() ? { intent: 'answer', complete: true, speak: '次の質問。' } : null;
  });
  try {
    h.director.handle(caption('u1', '出身は')); await delay(15);
    h.director.handle(caption('u2', 'カリフォルニアです', 1600, 2400));
    finish(); await delay(25); await h.director.drain();
    assert.equal(h.calls.length, 2);
    assert.equal(h.sent.filter(e => e.type === 'session.commentary.append').length, 1);
  } finally { h.director.cancel(); }
});

test('a caption arriving before queued delivery extends the old question without committing stale evidence', async () => {
  let question = { id: 'q1', revision: 1, task: 'Where are you from?' };
  let commits = 0;
  let now = 1000;
  const h = harness(async turn => ({ intent: 'answer', complete: true, speak: 'Next question',
    commit() {
      assert.equal(turn.isCurrent(), true);
      commits += 1; question = { id: 'q2', revision: 2, task: 'Favorite food?' }; return true;
    }
  }), { question: () => question, speechQuietMs: 100, now: () => now, stableMs: 0 });
  try {
    h.director.handle(caption('u1', 'クリスと申します。出身は', 0, 1000));
    await delay(15); await h.director.drain();
    assert.equal(h.calls.length, 1); assert.equal(commits, 0);
    now += 50;
    h.director.handle(caption('u2', 'カリフォルニアです', 1700, 2500));
    await delay(15); await h.director.drain();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].questionId, 'q1');
    assert.match(h.calls[1].transcript, /出身は\s*カリフォルニアです/);
    assert.equal(commits, 0);
    now += 150; await delay(120);
    assert.equal(commits, 1);
    assert.equal(question.id, 'q2');
    assert.equal(h.sent.filter(e => e.type === 'session.commentary.append').length, 1);
    h.director.handle(delegate('late')); await delay(15);
    assert.equal(h.calls.length, 2);
  } finally { h.director.cancel(); }
});

test('stopping before queued speech preserves a current assessment without speaking', async () => {
  let commits = 0;
  const h = harness(async () => ({ intent: 'answer', complete: true, speak: 'Next question',
    commit() { commits += 1; return true; }
  }), { speechQuietMs: 1000 });
  try {
    h.director.handle(caption('u1', 'クリスです'));
    await delay(20); await h.director.drain();
    assert.equal(commits, 0);
    await h.director.close(1);
    assert.equal(commits, 1);
    assert.equal(h.sent.filter(e => e.type === 'session.commentary.append').length, 0);
    assert.equal(h.sent.filter(e => e.type === 'session.thinking.append').length, 0);
  } finally { h.director.cancel(); }
});

test('manual handoff rechecks an unfinished answer; silence alone does not start assessment', async () => {
  const h = harness(async () => ({ intent: 'incomplete', complete: false }));
  try {
    h.director.finalize(); await delay(270); assert.equal(h.calls.length, 0);
    h.director.handle(caption('u1', '出身は')); await delay(15);
    assert.equal(h.calls.length, 1); assert.equal(h.sent.length, 0);
    await delay(20); assert.equal(h.calls.length, 1);
    h.director.finalize(); await delay(270); assert.equal(h.calls.length, 2);
  } finally { h.director.cancel(); }
});

test('stopping during assessment prevents a late result from speaking', async () => {
  let finish;
  const h = harness(async () => { await new Promise(resolve => { finish = resolve; }); return { intent: 'answer', complete: true, speak: 'no' }; });
  h.director.handle(caption('u1', 'Chrisです')); await delay(15);
  h.director.handle({ type: 'session.closed', usage: { seconds: 1 } });
  finish(); await h.director.drain();
  assert.equal(h.sent.length, 0); h.director.cancel();
});

test('a clarification already spoken by Live is not repeated by the director', async () => {
  const h = harness(async () => ({ intent: 'clarification', complete: false, speak: 'Repeat this question' }));
  try {
    h.director.handle(caption('u1', 'もう一度お願いします', 0, 1000));
    h.director.handle({ type: 'session.output_transcript.delta', event_id: 'a1', delta: 'どこに住んでいますか？', start_ms: 800, end_ms: 2500 });
    await delay(20); await h.director.drain();
    assert.equal(h.calls.length, 1);
    assert.equal(h.sent.filter(e => e.type === 'session.commentary.append').length, 0);
    assert.ok(h.traces.some(t => t.type === 'director.reply_already_spoken'));
  } finally { h.director.cancel(); }
});

test('short hallucinated captions on silent audio do not become learning evidence', async () => {
  const h = harness();
  try {
    h.director.handle({ type: 'session.input_audio.append', audio: Buffer.alloc(960).toString('base64') });
    h.director.handle(caption('noise', 'いい'));
    await delay(20);
    assert.equal(h.calls.length, 0);
    assert.ok(h.traces.some(t => t.type === 'director.uncertain_audio'));
  } finally { h.director.cancel(); }
});

test('speech during slow assessment invalidates it before a late caption arrives', async () => {
  let finish;
  const h = harness(async turn => {
    if (h.calls.length === 1) await new Promise(resolve => { finish = resolve; });
    return turn.isCurrent() ? { intent: 'answer', complete: true, speak: '次の質問。' } : null;
  });
  try {
    h.director.handle(caption('u1', 'クリスです')); await delay(15);
    const pcm = Buffer.alloc(960); pcm.writeInt16LE(8000);
    h.director.handle({ type: 'session.input_audio.append', audio: pcm.toString('base64') });
    assert.equal(h.calls[0].isCurrent(), false);
    h.director.handle(caption('u2', 'カリフォルニアです', 2000, 3000));
    finish(); await delay(25); await h.director.drain();
    assert.equal(h.sent.filter(e => e.type === 'session.commentary.append').length, 1);
  } finally { h.director.cancel(); }
});

test('assessment failure retries once, keeps the answer, and offers the same question without mastery', async () => {
  let unavailable = true;
  const h = harness(async () => {
    if (unavailable) throw new Error('Temporary backend outage');
    return { intent: 'answer', complete: true, speak: '次の質問。' };
  });
  try {
    h.director.handle(caption('u1', 'クリスです'));
    await delay(1100); await h.director.drain();
    assert.equal(h.calls.length, 2);
    assert.match(h.sent.find(e => e.type === 'session.commentary.append').content, /SAME Japanese question/);
    await delay(50); assert.equal(h.calls.length, 2);
    unavailable = false; h.director.finalize(); await delay(280); await h.director.drain();
    assert.equal(h.calls[2].transcript, 'クリスです');
  } finally { h.director.cancel(); }
});
