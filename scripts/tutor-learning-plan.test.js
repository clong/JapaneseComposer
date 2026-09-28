import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticState, recordDiagnosticResult, diagnosticReport, finishDiagnosticIfDue } from '../src/tutor-diagnostic.js';
import { createProbeContract, validateSpokenProbe, learnerIntentOverride, cleanTutorCaption, groupLogicalTutorTurns, captureSpokenProbe } from '../src/tutor-probes.js';
import { buildLearningPlan, learningMetrics, recordLessonPerformance } from '../src/tutor-learning-plan.js';
import { reconstructExchanges, reassessDiagnostic } from './tutor-reassessment.js';
import { createTutorLearningStore } from './tutor-learning-store.js';

test('September 27 regression: optional invitation, session status and already-answered objections are not failures', () => {
  assert.equal(learnerIntentOverride('今質問はありません', '何か簡単な質問がありますか？'), 'optional_decline');
  assert.equal(learnerIntentOverride('クリスは終わりましたか'), 'session_status');
  assert.equal(learnerIntentOverride('もう言いましたよ、牛乳のうどんです'), 'already_answered');
  const state = createDiagnosticState('regression');
  assert.doesNotMatch(state.pendingQuestion.task, /Say exactly/);
  assert.match(state.pendingQuestion.task, /learner should answer/);
  const next = recordDiagnosticResult(state, { intent: 'answer', success: false, complete: true, validity: 'valid', confidence: 1 },
    { turnId: 'status', questionId: state.pendingQuestion.id, transcript: '終わりましたか' });
  assert.equal(next.evidence.length, 0);
});

test('listening requires the exact supplied facts and rejects the repeated udon question', () => {
  const state = createDiagnosticState('listening');
  const q = { id: 'q1', contract: createProbeContract(state, 'listening', 0) };
  assert.equal(validateSpokenProbe(q, q.contract.promptJa).validity, 'valid');
  assert.equal(validateSpokenProbe(q, 'どんなうどんを注文しましたか？').validity, 'invalid');
  assert.equal(validateSpokenProbe(q, '').validity, 'uncertain');
  assert.equal(validateSpokenProbe(q, q.contract.promptJa, [{ questionId: 'old', intent: 'answer', validity: 'valid', prompt: q.contract.promptJa }]).validity, 'invalid');
  assert.equal(validateSpokenProbe(q, 'お店で選ぶものは何で変わりますか？').validity, 'invalid');
});

test('known personal facts cannot produce an accidental immediate repeated question', () => {
  const state = createDiagnosticState('known');
  state.facts = ['name', 'home', 'food'].map(key => ({ key, valueJa: 'クリス' }));
  state.exchanges = ['name', 'home', 'food'].map((templateId, index) => ({ templateId, intent: 'answer', validity: 'valid', questionId: `q${index}` }));
  const contract = createProbeContract(state, 'interaction', 0);
  assert.equal(contract.retrieval, true);
  assert.equal(contract.templateId, 'name', 'Only an explicitly delayed retrieval may revisit a known fact.');
  state.exchanges = state.exchanges.slice(-2);
  assert.equal(createProbeContract(state, 'interaction', 0).exhausted, true);
});

test('a contract-matching clarification replaces a mistaken spoken question without replacing transcript rows', () => {
  const q = createDiagnosticState('spoken').pendingQuestion;
  captureSpokenProbe(q, 'お仕事は何ですか？', 'wrong');
  assert.equal(validateSpokenProbe(q, q.spokenText).validity, 'invalid');
  captureSpokenProbe(q, q.contract.promptJa, 'corrected');
  assert.equal(q.spokenRowId, 'corrected');
  assert.equal(validateSpokenProbe(q, q.spokenText).validity, 'valid');
  assert.equal(captureSpokenProbe(q, '仕事について質問してください。', 'unrelated'), false);
});

test('vocabulary assistance does not lower unrelated sentence-production evidence', () => {
  let state = createDiagnosticState('help');
  state.pendingQuestion.domain = 'production';
  state = recordDiagnosticResult(state, { intent: 'clarification', complete: true, confidence: 1,
    validity: 'valid', assistanceSubject: 'vocabulary', supportPhrase: '頼んだ' },
    { turnId: 'help', questionId: state.pendingQuestion.id, transcript: '頼んだって意味は何ですか' });
  assert.equal(state.pendingQuestion.assistance, 'none');
  assert.equal(state.supportNeeds[0].phrase, '頼んだ');
  assert.equal(state.evidence.length, 0);
  state = recordDiagnosticResult(state, { intent: 'answer', complete: true, success: true, confidence: 1,
    validity: 'valid', assistance: true, assistanceSubject: 'none' },
    { turnId: 'after-help', questionId: state.pendingQuestion.id, transcript: '水を飲みました' });
  assert.equal(state.evidence[0].outcome, 'independent', 'Explaining a word does not make an otherwise independent sentence construction supported.');
});

test('logical caption display combines split past tense and strips protocol markers without modifying raw rows', () => {
  const turns = [{ id: 'a', role: 'assistant', transcript: '何を飲みましたか？' },
    { id: 'u1', role: 'user', transcript: '最近あまり飲みません' }, { id: 'u2', role: 'user', transcript: 'でした' },
    { id: 'u3', role: 'user', transcript: '<|stream' }];
  const grouped = groupLogicalTutorTurns(turns, [{ turnId: 'answer1', rowIds: ['u1', 'u2'], answer: '最近あまり飲みませんでした' }]);
  assert.equal(grouped.length, 2); assert.equal(grouped[1].transcript, '最近あまり飲みませんでした');
  assert.equal(turns[3].transcript, '<|stream'); assert.equal(cleanTutorCaption('<|stream'), '');
  assert.equal(reconstructExchanges(turns)[0].answer, '最近あまり飲みませんでした');
});

test('invalid probes do not contribute coverage, and an active exchange gets at most thirty seconds grace', () => {
  const state = createDiagnosticState('time', 1000);
  const result = recordDiagnosticResult(state, { intent: 'answer', complete: true, confidence: 1, validity: 'invalid' },
    { turnId: 'bad', questionId: state.pendingQuestion.id, transcript: '水です' }, 2000);
  assert.equal(diagnosticReport(result, 2000).progress.sampledAreas, 0);
  assert.equal(finishDiagnosticIfDue(state, 601000, { exchangePending: true }).status, 'active');
  assert.equal(finishDiagnosticIfDue(state, 631000, { exchangePending: true }).status, 'completed');
});

const evidence = (id, outcome = 'independent', extra = {}) => ({ id, sessionId: 'session', turnId: id, answerRevision: 1,
  validity: 'valid', outcome, skillId: 'a1.introductions', band: 0, prompt: `Question ${id}`, createdAt: 1000, ...extra });
test('learning metrics count logical answers once and compare targets at the same difficulty', () => {
  const a = evidence('a');
  const metrics = learningMetrics({ evidence: [a, a, { ...a, skillId: 'a1.core-vocabulary' }, evidence('b', 'supported'),
    evidence('c', 'independent', { validity: 'invalid' }), evidence('d', 'not_yet_demonstrated', { band: 1 })] });
  assert.equal(metrics.attempts, 3); assert.equal(metrics.independent, 1); assert.equal(metrics.supported, 1);
  assert.equal(metrics.independentRate, 1 / 3); assert.equal(metrics.comparable.length, 3);
  assert.equal(metrics.sevenDayRetention.rate, null);
  const failures = learningMetrics({ evidence: [a, evidence('failure', 'uncertain', { scorable: true }),
    evidence('unclear', 'uncertain', { scorable: false }), evidence('same-band', 'supported', { band: 'A1' })] });
  assert.equal(failures.attempts, 3);
  assert.equal(failures.independentRate, 1 / 3);
  assert.equal(failures.comparable.length, 1, 'Numeric diagnostic bands and lesson CEFR levels must be comparable.');
});

test('retention requires scheduled independent retrieval after seven days and at least three samples', () => {
  const review = { scheduled: true, independent: true, learnedAt: 1000, attemptedAt: 1000 + 7 * 86400000, success: true };
  assert.equal(learningMetrics({ reviews: [review, { ...review, independent: false }, { ...review, attemptedAt: 2000 }] }).sevenDayRetention.attempts, 1);
  assert.equal(learningMetrics({ reviews: [review, review, { ...review, success: false }] }).sevenDayRetention.rate, 2 / 3);
});

test('deletion or reassessment recomputes retention eligibility without changing the stored review', async () => {
  const day = 86400000;
  let rows = [evidence('original'), evidence('later', 'independent', { createdAt: 1000 + 3 * day })];
  const review = { skillId: 'a1.introductions', scheduled: true, independent: true,
    learnedAt: 1000, attemptedAt: 1000 + 8 * day, success: true };
  const store = createTutorLearningStore({ quote: value => `'${value}'`, execute: async () => {},
    query: async sql => (sql.includes('user_tutor_learning_evidence') ? rows
      : sql.includes('user_tutor_review_attempts') ? [review] : []).map(payload => ({ payload: JSON.stringify(payload) })) });
  assert.equal((await store.read('local')).metrics.sevenDayRetention.attempts, 1);
  rows = rows.slice(1);
  assert.equal((await store.read('local')).metrics.sevenDayRetention.attempts, 0);
  rows = [evidence('invalid', 'independent', { validity: 'invalid' }),
    evidence('retrieval', 'independent', { createdAt: review.attemptedAt })];
  assert.equal((await store.read('local')).reviews[0].learnedAt, null);
  assert.equal(review.learnedAt, 1000, 'Reconciliation must preserve the original stored record.');
});

test('a failed plan does not prevent later independent answers from being recorded', () => {
  const failed = { status: 'failed', error: 'Retry preparing your learning plan.' };
  assert.equal(recordLessonPerformance(failed, '', evidence('answer')), failed);
});

test('five-lesson plan distinguishes untested targets and preserves completed objectives', () => {
  const a = evidence('a'); const b = evidence('b');
  let plan = buildLearningPlan({ evidence: [], now: 1000 });
  assert.equal(plan.lessons.length, 5); assert.ok(plan.lessons.some(l => l.status === 'locked'));
  const lesson = plan.lessons.find(l => l.primarySkillId === a.skillId);
  assert.match(lesson.reason, /not been assessed/);
  plan = recordLessonPerformance(plan, lesson.id, a);
  plan = recordLessonPerformance(plan, lesson.id, a);
  assert.equal(plan.lessons.find(l => l.id === lesson.id).status, 'ready');
  plan = recordLessonPerformance(plan, lesson.id, b);
  assert.equal(plan.lessons.find(l => l.id === lesson.id).status, 'completed');
  const next = buildLearningPlan({ evidence: [a, b], previous: plan, now: 2000 });
  assert.equal(next.lessons[0].status, 'completed');
  assert.equal(next.lessons.filter(l => l.status !== 'completed').length, 5);
  assert.equal(buildLearningPlan({ evidence: [], previous: next }).lessons.some(l => l.status === 'completed'), false);
  const afterDeletion = buildLearningPlan({ evidence: [a], previous: next });
  const unfinished = afterDeletion.lessons.find(l => l.primarySkillId === a.skillId);
  assert.equal(unfinished.status, 'ready');
  assert.equal(unfinished.independentProbeKeys.length, 1, 'Deleted performances cannot remain credited toward completion.');
});

test('reassessment retains originals and excludes invalid prompts from revised evidence', async () => {
  const original = createDiagnosticState('old'); original.version = 1;
  original.evidence = [evidence('old', 'not_yet_demonstrated', { domain: 'listening', prompt: 'どんなうどんを注文しましたか？',
    answer: 'もう言いましたよ、牛乳のうどんです', assistance: 'none', questionId: 'oldq' })];
  const result = await reassessDiagnostic({ diagnostic: original, sessionId: 'old', turns: [
    { turnId: 'a', role: 'assistant', transcript: original.evidence[0].prompt },
    { turnId: 'u', role: 'user', transcript: original.evidence[0].answer }],
    assess: async () => ({ intent: 'answer', probeValid: false, complete: true, success: false, confidence: 1, invalidReason: 'Missing listening fact' }) });
  assert.equal(original.evidence.length, 1); assert.equal(result.diagnostic.evidence.length, 0);
  assert.equal(result.decisions[0].intent, 'already_answered');
});
