import { createProbeContract, cleanTutorCaption, learnerIntentOverride, FACT_KEYS } from './tutor-probes.js';
// The diagnostic owns question selection; the voice model only delivers the current probe.
export const DIAGNOSTIC_VERSION = 2;
export const DIAGNOSTIC_DOMAINS = ['interaction', 'vocabulary', 'production', 'listening'];
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const CEILINGS = ['N5', 'N4', 'N3', 'N2'];
const LIMIT_MS = 10 * 60_000;
const MIN_MS = 8 * 60_000;
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const bounded = (value, max = 1) => Math.max(0, Math.min(max, Number(value) || 0));
const probeKey = evidence => (evidence.prompt || evidence.questionId).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

const PROBES = {
  interaction: [
    ['a1.introductions', 'Personal information', 'Ask for their name first: お名前は何ですか？ Accept a name alone. On another probe ask where they live; never ask their name again.'],
    ['a2.follow-up', 'A related question', 'Invite one simple question from the learner about the familiar topic you are discussing. Keep the vocabulary and response length simple.'],
    ['b1.problem-solving', 'A practical problem', 'Introduce one small everyday problem related to the current topic and ask for one suggestion.'],
    ['b2.negotiation', 'Discuss a constraint', 'Add one concrete constraint to the previous suggestion and invite a workable alternative.']
  ],
  vocabulary: [
    ['a1.core-vocabulary', 'Familiar words', 'Ask for a favorite food, drink, or familiar place. On a second probe ask for a related example, not the same question. A single word is enough.'],
    ['a1.core-vocabulary', 'Describe a familiar thing', 'Ask for one simple descriptive word about the food, drink, or place already mentioned. Increase vocabulary demand only.'],
    ['a2.preferences', 'A concrete distinction', 'Ask what distinguishes two familiar choices from the current topic. Accept one short phrase.'],
    ['b1.explanation', 'Explain an unfamiliar word', 'Ask the learner to describe one item from the current topic without using its name. Keep grammar and length demands unchanged.']
  ],
  production: [
    ['a1.polite-present', 'A simple statement', 'Ask one simple present-tense question about when or where the learner eats, drinks, or visits the thing already mentioned. Accept one short sentence.'],
    ['a2.experiences', 'A past action', 'Ask one short past-tense question about that same familiar activity. Change tense only; accept one sentence.'],
    ['b1.clause-linking', 'Connect a reason', 'Ask why about the previous answer. Add one reason clause, keeping the same topic and concrete vocabulary.'],
    ['b2.discourse-control', 'Qualify a statement', 'Ask whether there is an exception to the previous answer. Add one qualification without introducing a new topic or abstract vocabulary.']
  ],
  listening: [
    ['a1.listening-core', 'Understand one detail', 'Say one very short fact about the familiar topic, then ask for one detail from it. Use basic concrete words; a one-word answer is enough.'],
    ['a2.listening-details', 'Understand two details', 'Give two short related facts about the same topic, then ask about just one detail. Increase listening load only, not answer length.'],
    ['b1.listening-connected', 'Understand a reason', 'Give a short familiar statement with a reason, then ask which reason was given. Keep the same vocabulary.'],
    ['b2.listening-nuance', 'Understand a contrast', 'Give a brief contrasting preference on the same topic, then ask which option the speaker finally chose. Keep the answer short.']
  ]
};

function probe(state, domain, band, assistance = 'none', allowFallback = true) {
  let contract = state.version >= 2 ? createProbeContract(state, domain, band) : null;
  if (allowFallback && contract?.exhausted) {
    for (const other of DIAGNOSTIC_DOMAINS.filter(d => d !== domain)) {
      const alternative = createProbeContract(state, other, state.bands[other]);
      if (alternative.exhausted) continue;
      domain = other; band = state.bands[other]; contract = alternative; break;
    }
  }
  const [skillId, goal, defaultTask] = PROBES[domain][band];
  const previous = state.evidence.filter(e => e.domain === domain && e.band === band);
  const previousQuestions = new Set(previous.map(e => e.questionId)).size;
  const task = domain === 'interaction' && band === 0
    ? previousQuestions > 1 ? 'Ask one new basic personal detail linked to the current topic. Accept one word. Do not repeat a question already answered or ask their name again.'
      : previous.length ? 'Ask one simple question about where the learner lives: どこに住んでいますか？ Accept a place name. Do not ask their name again.'
      : 'Ask only: お名前は何ですか？ Accept a name alone. Do not combine questions.'
    : domain === 'vocabulary' && band === 0 && previous.length
      ? 'Ask for a familiar drink to go with the food just mentioned. Accept one word. Do not repeat the food question.'
      : domain === 'production' && band === 0
        ? previous.length ? 'Ask WHERE the learner does the familiar activity just discussed. Use present tense and accept one short sentence. Do not repeat the time question.'
          : 'Ask WHEN the learner does the familiar activity just discussed. Use present tense and accept one short sentence.'
      : previous.length ? `${defaultTask} Use a different detail from earlier probes at this level.`
      : defaultTask;
  return { id: `${state.id}_q${state.revision}`, revision: state.revision, domain, band, skillId, contract,
    level: LEVELS[band], vocabularyCeiling: domain === 'vocabulary' ? CEILINGS[band] : 'N5', goal,
    task: contract ? `The learner should ${contract.responseType === 'retrieve_supplied_fact'
      ? 'identify the requested detail from the tutor\'s supplied facts'
      : contract.responseType === 'perform_task' ? 'perform the task requested by the Japanese prompt'
        : 'answer the Japanese question about themselves'}. Tutor prompt: ${contract.promptJa}` : task,
    assistance, spokenText: '' };
}

export function createDiagnosticState(id, now = Date.now()) {
  const state = { version: DIAGNOSTIC_VERSION, id, revision: 1, status: 'active', completionReason: '',
    elapsedMs: 0, resumedAt: now, evidence: [], bands: Object.fromEntries(DIAGNOSTIC_DOMAINS.map(d => [d, 0])),
    topic: '', exchanges: [], facts: [], supportNeeds: [], pendingQuestion: null };
  state.pendingQuestion = probe(state, 'interaction', 0);
  return state;
}

export function normalizeDiagnosticState(value) {
  if (!value || ![1, DIAGNOSTIC_VERSION].includes(value.version) || !value.pendingQuestion) return null;
  const state = createDiagnosticState(text(value.id, 120), Number(value.resumedAt) || Date.now());
  state.version = value.version;
  state.revision = Math.max(1, Math.trunc(Number(value.revision) || 1));
  state.status = ['active', 'paused', 'completed'].includes(value.status) ? value.status : 'paused';
  state.completionReason = text(value.completionReason, 60);
  state.elapsedMs = bounded(value.elapsedMs, LIMIT_MS + 30_000);
  state.resumedAt = state.status === 'active' ? Number(value.resumedAt) || Date.now() : null;
  state.topic = text(value.topic, 120);
  state.exchanges = (value.exchanges || []).slice(-180);
  state.facts = (value.facts || []).filter(f => FACT_KEYS.includes(f.key)).slice(-30);
  state.supportNeeds = (value.supportNeeds || []).slice(-30);
  state.evidence = (Array.isArray(value.evidence) ? value.evidence : []).slice(-160)
    .filter(e => [1, DIAGNOSTIC_VERSION].includes(e?.version) && DIAGNOSTIC_DOMAINS.includes(e.domain)
      && ['independent', 'supported', 'uncertain', 'not_yet_demonstrated'].includes(e.outcome)
      && typeof e.questionId === 'string' && typeof e.turnId === 'string')
    .map(e => ({ ...e, band: Math.trunc(bounded(e.band, 3)), confidence: bounded(e.confidence),
      answer: text(e.answer, 4000), prompt: text(e.prompt, 1000), observations: text(e.observations, 400) }));
  for (const domain of DIAGNOSTIC_DOMAINS) state.bands[domain] = Math.trunc(bounded(value.bands?.[domain], 3));
  const q = value.pendingQuestion;
  const domain = DIAGNOSTIC_DOMAINS.includes(q.domain) ? q.domain : 'interaction';
  const restoredProbe = probe(state, domain, Math.trunc(bounded(q.band, 3)),
    ['none', 'hint', 'simplified', 'explanation'].includes(q.assistance) ? q.assistance : 'none', false);
  state.pendingQuestion = { ...restoredProbe,
    contract: q.contract?.version === 1 ? q.contract : state.version === 1 ? null : restoredProbe.contract,
    id: text(q.id, 160) || `${state.id}_q${state.revision}`, task: text(q.task, 1000) || restoredProbe.task,
    spokenText: text(q.spokenText, 1000), spokenRowId: text(q.spokenRowId, 140) };
  return state;
}

export function diagnosticElapsed(state, now = Date.now()) {
  return state.elapsedMs + (state.status === 'active' ? Math.max(0, now - state.resumedAt) : 0);
}

export function diagnosticReport(state, now = Date.now()) {
  if (!state) return { version: 0, status: 'limited_evidence', provisional: true, domains: [] };
  const domains = DIAGNOSTIC_DOMAINS.map(domain => {
    const evidence = state.evidence.filter(e => e.domain === domain && (e.outcome !== 'uncertain' || e.scorable === true)
      && !['invalid', 'uncertain'].includes(e.validity));
    const independent = evidence.filter(e => e.outcome === 'independent');
    const supported = evidence.filter(e => e.outcome === 'supported');
    const repeatedGaps = evidence.filter(e => e.outcome === 'not_yet_demonstrated');
    const established = LEVELS.filter((_, band) => new Set(independent.filter(e => e.band === band).map(probeKey)).size >= 2);
    return { domain, status: independent.length ? 'independent' : supported.length ? 'supported'
      : repeatedGaps.length ? 'not_yet_demonstrated' : 'not_assessed',
    level: established.at(-1) || null, sampleCount: new Set(evidence.map(probeKey)).size,
    independent: independent.length, supported: supported.length, gaps: repeatedGaps.length,
    examples: evidence.filter(e => e.outcome !== 'uncertain').slice(-2).map(e => ({
      prompt: e.prompt, answer: e.answer, observation: e.observations, outcome: e.outcome, confidence: e.confidence
    })) };
  });
  const elapsedMs = diagnosticElapsed(state, now);
  const sampledAreas = domains.filter(d => d.sampleCount >= 2).length;
  const phase = state.status === 'completed' || elapsedMs >= LIMIT_MS ? 'Finishing'
    : state.evidence.length < 2 ? 'Getting started' : sampledAreas === 4 ? 'Exploring your level' : 'Sampling skills';
  return { version: state.version, status: state.status, completionReason: state.completionReason,
    supportNeeds: (state.supportNeeds || []).map(({ subject, phrase, turnId }) => ({ subject, phrase, turnId })),
    progress: { elapsedMs, sampledAreas, totalAreas: 4, phase, currentSkill: state.pendingQuestion.domain,
      remainingMinMs: Math.max(0, MIN_MS - elapsedMs), remainingMaxMs: Math.max(0, LIMIT_MS - elapsedMs) },
    provisional: true, assessedAnswers: state.evidence.length, domains,
    coverage: domains.filter(d => d.sampleCount >= 2).length / DIAGNOSTIC_DOMAINS.length,
    unassessed: [...domains.filter(d => d.status === 'not_assessed').map(d => d.domain), 'phonology', 'measured fluency'] };
}

export function pauseDiagnostic(value, now = Date.now()) {
  const state = normalizeDiagnosticState(value);
  if (!state || state.status === 'completed') return state;
  state.elapsedMs = diagnosticElapsed(state, now);
  state.status = 'paused'; state.resumedAt = null; state.completionReason = 'stopped_early';
  return state;
}

export function resumeDiagnostic(value, now = Date.now()) {
  const state = normalizeDiagnosticState(value);
  if (!state || state.status === 'completed') return state;
  state.status = 'active'; state.resumedAt = now; state.completionReason = '';
  return state;
}

export function diagnosticActivity(state) {
  const q = state.pendingQuestion;
  return { id: q.id, phase: state.status === 'completed' ? 'recap' : 'independent_attempt', goal: q.goal,
    difficultyLevel: q.level, targetSkillIds: [q.skillId], exitCriteria: { minAttempts: 1, maxAttempts: 2, requiredScore: 0.7 },
    instructions: state.status === 'completed' ? 'The baseline has ended. Thank the learner briefly in Japanese. Ask no new question.'
      : `${q.task} ${state.topic ? `Continue the existing topic (${state.topic}); do not reset the introduction.` : ''} ${q.assistance === 'none' ? '' : 'Simplify the SAME question or offer one short hint. Do not reveal the full answer.'}` };
}

export function recordDiagnosticResult(value, result, turn, now = Date.now()) {
  const state = normalizeDiagnosticState(value);
  if (!state || state.status !== 'active' || turn.questionId !== state.pendingQuestion.id
    || (turn.activityRevision != null && turn.activityRevision !== state.pendingQuestion.revision)) return state;
  if (state.evidence.some(e => e.turnId === turn.turnId && e.answerRevision === turn.answerRevision)) return state;
  const q = state.pendingQuestion;
  result = { ...result, intent: learnerIntentOverride(turn.transcript, turn.prompt || q.spokenText) || result.intent };
  if (state.exchanges.some(e => e.turnId === turn.turnId && e.answerRevision === turn.answerRevision)) return state;
  const validity = result.validity || (q.contract ? 'uncertain' : 'valid');
  const exchange = { version: 2, turnId: turn.turnId, answerRevision: turn.answerRevision, questionId: q.id,
    rowIds: turn.rowIds || [], prompt: turn.prompt || q.spokenText || q.task, answer: cleanTutorCaption(turn.transcript),
    domain: q.domain, skillId: q.skillId, band: q.band, templateId: q.contract?.templateId || '',
    contract: q.contract || null, assistance: q.assistance,
    intent: result.intent, validity, invalidReason: result.invalidReason || '', createdAt: now };
  if (result.complete !== false && result.intent !== 'incomplete') state.exchanges.push(exchange);
  if (state.version >= 2 && validity !== 'valid' && result.intent === 'answer') {
    state.revision += 1; state.pendingQuestion = probe(state, q.domain, q.band); return state;
  }
  if (result.intent === 'clarification' && validity === 'valid') {
    const subject = result.assistanceSubject || 'task';
    state.supportNeeds.push({ subject, phrase: text(result.supportPhrase || turn.transcript, 160),
      skillId: subject === 'vocabulary' ? 'a1.core-vocabulary' : q.skillId, questionId: q.id, turnId: turn.turnId, createdAt: now });
    if (subject !== 'vocabulary' || q.domain === 'vocabulary') q.assistance = 'explanation';
  }
  if (['optional_decline', 'already_answered'].includes(result.intent)) {
    state.revision += 1; state.pendingQuestion = probe(state, q.domain, q.band); return state;
  }
  if (result.intent !== 'answer' || result.complete === false || result.confidence < 0.65) {
    return state;
  }
  if (q.contract?.factKey && result.success) {
    const fact = (result.facts || []).find(f => f.key === q.contract.factKey && f.confidence >= 0.8);
    if (fact) state.facts = [...state.facts.filter(f => f.key !== fact.key), { ...fact, sourceTurnId: turn.turnId }];
  }
  const passed = result.success === true;
  const help = state.supportNeeds.filter(s => s.questionId === q.id);
  const vocabularyOnlyHelp = q.domain !== 'vocabulary' && help.length && help.every(s => s.subject === 'vocabulary');
  const assisted = q.assistance !== 'none' || (result.assistance === true
    && !vocabularyOnlyHelp && (result.assistanceSubject !== 'vocabulary' || q.domain === 'vocabulary'));
  const priorFailure = state.evidence.some(e => e.questionId === q.id && e.outcome === 'uncertain');
  const outcome = passed ? (assisted ? 'supported' : 'independent')
    : (assisted || priorFailure ? 'not_yet_demonstrated' : 'uncertain');
  const evidence = { version: state.version, validity, scorable: true, id: `${turn.turnId}:${turn.answerRevision}`, turnId: turn.turnId,
    answerRevision: turn.answerRevision, questionId: q.id, activityRevision: q.revision,
    contract: q.contract || null,
    domain: q.domain, skillId: q.skillId, band: q.band, level: q.level, prompt: q.spokenText || q.task,
    answer: text(turn.transcript, 4000), assistance: q.assistance, outcome, confidence: bounded(result.confidence),
    observations: text(result.observation, 400), nextDecision: '', createdAt: now };
  state.evidence.push(evidence);
  state.topic = text(result.topic, 120) || state.topic;
  if (!passed && !assisted && !priorFailure) {
    q.assistance = 'hint'; evidence.nextDecision = 'offer_hint';
    return finishDiagnosticIfDue(state, now);
  }
  const relevant = state.evidence.filter(e => e.domain === q.domain && e.band === q.band);
  const lastDifficulty = relevant.findLastIndex(e => ['supported', 'not_yet_demonstrated'].includes(e.outcome));
  const successes = new Set(relevant.slice(lastDifficulty + 1).filter(e => e.outcome === 'independent').map(probeKey)).size;
  let domain = q.domain;
  let band = q.band;
  if (successes >= 2 && band < 3) {
    band += 1; evidence.nextDecision = 'increase_one_factor';
  } else if (!passed || assisted || q.band > 0) {
    if (!passed || assisted) state.bands[domain] = Math.max(0, band - 1);
    domain = DIAGNOSTIC_DOMAINS.slice().sort((a, b) => state.evidence.filter(e => e.domain === a).length - state.evidence.filter(e => e.domain === b).length)[0];
    band = state.bands[domain]; evidence.nextDecision = 'sample_another_skill';
  } else evidence.nextDecision = 'confirm_with_distinct_probe';
  state.bands[domain] = band;
  state.revision += 1;
  state.pendingQuestion = probe(state, domain, band);
  return finishDiagnosticIfDue(state, now);
}

export function finishDiagnosticIfDue(value, now = Date.now(), { exchangePending = false } = {}) {
  const state = normalizeDiagnosticState(value);
  if (!state || state.status !== 'active') return state;
  const elapsed = diagnosticElapsed(state, now);
  const sufficient = diagnosticReport(state).coverage === 1 && state.evidence.length >= 8;
  if ((!exchangePending && (elapsed >= LIMIT_MS || (elapsed >= MIN_MS && sufficient))) || elapsed >= LIMIT_MS + 30_000) {
    state.elapsedMs = elapsed; state.resumedAt = null; state.status = 'completed';
    state.completionReason = sufficient ? 'sufficient_coverage' : 'time_limit_partial';
  }
  return state;
}

export function diagnosticReply(state, result, question) {
  if (state.version >= 2) {
    if (state.status === 'completed') return 'Thank the learner briefly in Japanese. The baseline conversation has ended. Do not claim a learning plan is ready yet. Ask no question.';
    const prompt = state.pendingQuestion.contract?.promptJa;
    if (result.intent === 'session_status') return `Briefly explain that this is an 8-10 minute Japanese baseline. Then repeat exactly: ${prompt}`;
    if (['clarification', 'off_topic'].includes(result.intent)) return `Answer the learner's question briefly, using English for an English question. Then say exactly: ${prompt}`;
    if (result.complete === false || result.intent === 'incomplete') return '';
    if (result.intent === 'answer' && result.validity === 'valid' && !result.success
      && state.pendingQuestion.id === question.id) return `Offer this hint, then repeat the same question. Say exactly: ${state.pendingQuestion.contract.hintJa}${prompt}`;
    if (result.success && result.validity === 'valid' && question.contract?.tutorAnswerJa) return `Answer as the practice character, then ask the next question. Say exactly: ${question.contract.tutorAnswerJa}${prompt}`;
    return `Say exactly, without adding another question: ${prompt}`;
  }
  if (result.intent === 'clarification' || result.intent === 'off_topic') {
    return `Answer the learner's question briefly (English only if they ask in English), then return to the SAME Japanese question: ${question.spokenText || question.task}. No assessment narration.`;
  }
  if (result.intent === 'unclear' || result.confidence < 0.65) {
    return 'Ask for one brief repetition in Japanese. Do not suggest that the learner failed or change the pending question.';
  }
  if (result.complete !== false && result.intent === 'answer') {
    return state.status === 'completed'
      ? 'Say briefly in Japanese that this conversation is finished. Do not claim a learning plan is ready. Do not ask another question.'
      : state.pendingQuestion.id === question.id && state.pendingQuestion.assistance !== 'none'
        ? 'Give one short hint for the SAME Japanese question, then invite another attempt. Do not reveal the answer or announce assessment.'
        : `Answer any question the learner asked. Then, in Japanese: ${state.pendingQuestion.task} No praise or checking announcements. Only one question.`;
  }
  return '';
}

export const DIAGNOSTIC_ASSESSMENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['intent', 'complete', 'success', 'assistance', 'confidence', 'topic', 'observation', 'probeValid', 'invalidReason', 'assistanceSubject', 'supportPhrase', 'facts'],
  properties: {
    intent: { type: 'string', enum: ['answer', 'clarification', 'off_topic', 'unclear', 'incomplete', 'session_status', 'optional_decline', 'already_answered'] },
    complete: { type: 'boolean' }, success: { type: 'boolean' }, assistance: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 }, topic: { type: 'string' }, observation: { type: 'string' },
    probeValid: { type: 'boolean' }, invalidReason: { type: 'string' },
    assistanceSubject: { type: 'string', enum: ['none', 'vocabulary', 'grammar', 'task'] }, supportPhrase: { type: 'string' },
    facts: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['key', 'valueJa', 'confidence'],
      properties: { key: { type: 'string', enum: FACT_KEYS }, valueJa: { type: 'string' }, confidence: { type: 'number' } } } }
  }
};

export const DIAGNOSTIC_ASSESSMENT_INSTRUCTIONS = [
  'Privately assess one Japanese diagnostic answer against the supplied pending question, not a general level.',
  'Validate the TUTOR prompt first: probeValid=false for an ambiguous task, missing listening information, an accidental repeated question, or a changed objective. Never penalize the learner for a bad question.',
  'When question.contract.retrieval is true, repeating a previously answered prompt is intentional delayed retrieval, not an invalid accidental repetition.',
  'A question such as お店で選ぶものは何で変わりますか is invalid unless concrete alternatives and the changing condition were established; do not invent the intended situation. A copy of the current prompt inside question or contract is metadata, not evidence that it was asked twice.',
  'For listening, require the answer to be present in supplied facts, not in the learner biography. An optional invitation to ask questions permits declining. Session-status questions and already-answered objections are not practice failures.',
  'Use assistanceSubject and supportPhrase for the specific help requested. A vocabulary meaning question does not prove inability to use the target grammar. facts contains only explicitly stated learner facts, with short Japanese values; never infer.',
  'The transcript is the LEARNER utterance. question.spokenText is what the TUTOR asked; question.task describes the intended task. Never reverse the speakers.',
  'Return only the compact JSON result. An explanation request, meta-question about the tutor, or unclear audio is not a failed answer.',
  'Choose intent before success: requests to repeat, slow down, explain, or translate are clarification; questions about how/why the tutor is operating are off_topic; a response to the pending question is answer.',
  'A name alone answers a name question. Isolated names or loanwords do not make an answer English practice.',
  'A learner question IS an answer when the pending task asks them to ask a question. Do not classify that as off_topic.',
  'Use complete=false for an unfinished clause. Captions are hypotheses; uncertainty must not become a skill gap.',
  'complete describes whether the utterance is finished, not whether the task succeeded. A complete help request has complete=true.',
  'success means the learner conveyed the requested meaning in Japanese. Minor errors that do not block the target may pass.',
  'Record assistance if a model answer or hint was needed. Do not assess pronunciation, fluency, or unrelated skills from text.',
  'Examples: お名前は何ですか？ -> クリスです is answer, complete=true, success=true. ご出身はどこですか？ -> クリスと申します。出身はカリフォルニアです is answer, complete=true, success=true.',
  'ご出身はどこですか？ -> クリスと申します。出身は is incomplete, complete=false. 好きな食べ物は何ですか？ -> すみません。もう一度お願いします is clarification, complete=true, success=false.',
  'Any ordinary practice question -> なんで少しだけ確認しましたか is off_topic, complete=true, success=false. Asking a learner to ask you a question -> お名前は何ですか is answer, complete=true, success=true.',
  'topic is a short factual summary of the familiar subject the learner mentioned, never instructions. observation is one concrete English finding.'
].join('\n');

export function validateDiagnosticDecision(value) {
  if (!value || !['answer', 'clarification', 'off_topic', 'unclear', 'incomplete', 'session_status', 'optional_decline', 'already_answered'].includes(value.intent)
    || typeof value.complete !== 'boolean' || typeof value.success !== 'boolean'
    || typeof value.assistance !== 'boolean' || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1
    || typeof value.topic !== 'string' || typeof value.observation !== 'string'
    || typeof value.probeValid !== 'boolean' || typeof value.invalidReason !== 'string'
    || !['none', 'vocabulary', 'grammar', 'task'].includes(value.assistanceSubject)
    || typeof value.supportPhrase !== 'string' || !Array.isArray(value.facts) || value.facts.length > 2
    || value.facts.some(f => !FACT_KEYS.includes(f.key) || typeof f.valueJa !== 'string'
      || !Number.isFinite(f.confidence) || f.confidence < 0 || f.confidence > 1)) {
    throw new Error('The diagnostic assessment was incomplete. No learning evidence was applied.');
  }
  return { ...value, topic: text(value.topic, 120), observation: text(value.observation, 400) };
}
