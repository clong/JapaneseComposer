export const TUTOR_V2_SCHEMA_VERSION = 2;

export const TUTOR_CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const TUTOR_SPEAKING_DIMENSIONS = [
  'interaction',
  'production',
  'listening',
  'grammar',
  'vocabulary',
  'fluency',
  'phonology'
];
export const TUTOR_PRACTICE_MODES = ['guided', 'scenario', 'pronunciation', 'free'];
export const TUTOR_EVIDENCE_SOURCES = ['task', 'repair', 'acoustic', 'benchmark', 'teacher'];
export const TUTOR_ACTIVITY_PHASES = [
  'briefing',
  'model',
  'scaffolded_attempt',
  'independent_attempt',
  'feedback',
  'repair',
  'transfer',
  'recap'
];

const DAY_MS = 24 * 60 * 60 * 1000;
const LEVEL_ORDER = new Map(TUTOR_CEFR_LEVELS.map((level, index) => [level, index]));

function cleanString(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanStringList(value, maxItems = 20, maxLength = 240) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => cleanString(item, maxLength)).filter(Boolean)
    : [];
}

function cleanNumber(value, fallback = 0, min = 0, max = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function cleanTimestamp(value, fallback = Date.now()) {
  if (value == null || value === '') {
    return fallback;
  }
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
}

function optionalTimestamp(value) {
  if (value == null || value === '') {
    return null;
  }
  return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null;
}

function normalizeCefrLevel(value, fallback = 'A1') {
  const normalized = cleanString(value, 2).toUpperCase();
  return TUTOR_CEFR_LEVELS.includes(normalized) ? normalized : fallback;
}

function normalizeMode(value) {
  const normalized = cleanString(value, 24).toLowerCase();
  return TUTOR_PRACTICE_MODES.includes(normalized) ? normalized : 'guided';
}

function normalizePhase(value) {
  const normalized = cleanString(value, 40).toLowerCase();
  return TUTOR_ACTIVITY_PHASES.includes(normalized) ? normalized : 'briefing';
}

function normalizeLevelSignal(value, fallback = 'A1') {
  const text = cleanString(value, 24).toUpperCase();
  const match = text.match(/(?:^|[^A-Z0-9])(A1|A2|B1|B2|C1|C2)(?:$|[^A-Z0-9])/);
  return match ? match[1] : normalizeCefrLevel(text, fallback);
}

function skill({ id, level, type, title, objective, prerequisites = [], tags = [] }) {
  return Object.freeze({
    id,
    framework: 'JF_CAN_DO',
    level,
    type,
    title,
    objective,
    prerequisites,
    tags,
    enabled: true,
    contentStatus: 'internal_seed'
  });
}

export const TUTOR_SKILL_GRAPH = Object.freeze([
  skill({ id: 'a1.introductions', level: 'A1', type: 'can_do', title: 'Introductions', objective: 'Exchange a simple greeting and basic personal information.', tags: ['social', 'interaction'] }),
  skill({ id: 'a1.simple-questions', level: 'A1', type: 'can_do', title: 'Simple questions', objective: 'Ask and answer short questions about familiar things.', prerequisites: ['a1.introductions'], tags: ['interaction'] }),
  skill({ id: 'a1.daily-routine', level: 'A1', type: 'can_do', title: 'Daily routine', objective: 'Describe a familiar daily activity with short connected phrases.', prerequisites: ['a1.simple-questions'], tags: ['production'] }),
  skill({ id: 'a1.basic-requests', level: 'A1', type: 'can_do', title: 'Basic requests', objective: 'Make and respond to a simple request in a familiar setting.', prerequisites: ['a1.simple-questions'], tags: ['scenario', 'interaction'] }),
  skill({ id: 'a1.particles-core', level: 'A1', type: 'grammar', title: 'Core particles', objective: 'Use は, が, を, に, and で clearly in short utterances.', tags: ['grammar'] }),
  skill({ id: 'a1.polite-present', level: 'A1', type: 'grammar', title: 'Polite present', objective: 'Use です and ます forms in simple present statements and questions.', tags: ['grammar', 'register'] }),
  skill({ id: 'a1.core-vocabulary', level: 'A1', type: 'vocabulary', title: 'Core concrete vocabulary', objective: 'Retrieve common words for people, places, time, food, and daily actions.', tags: ['vocabulary'] }),
  skill({ id: 'a1.repair-basic', level: 'A1', type: 'conversation', title: 'Basic repair', objective: 'Ask for repetition, slower speech, or a simple explanation.', prerequisites: ['a1.simple-questions'], tags: ['interaction', 'strategy'] }),
  skill({ id: 'a1.listening-core', level: 'A1', type: 'listening', title: 'Essential listening', objective: 'Understand short, clear questions about familiar personal information.', prerequisites: ['a1.introductions'], tags: ['listening'] }),
  skill({ id: 'a1.mora-timing', level: 'A1', type: 'pronunciation', title: 'Mora timing', objective: 'Keep short Japanese utterances rhythmically clear at the mora level.', tags: ['phonology', 'rhythm'] }),
  skill({ id: 'a1.vowel-length', level: 'A1', type: 'pronunciation', title: 'Vowel length', objective: 'Produce short and long vowel contrasts clearly in controlled phrases.', prerequisites: ['a1.mora-timing'], tags: ['phonology'] }),

  skill({ id: 'a2.transactions', level: 'A2', type: 'can_do', title: 'Everyday transactions', objective: 'Complete a routine purchase, order, or reservation exchange.', prerequisites: ['a1.basic-requests'], tags: ['scenario', 'interaction'] }),
  skill({ id: 'a2.experiences', level: 'A2', type: 'can_do', title: 'Past experiences', objective: 'Describe a recent event and answer simple follow-up questions.', prerequisites: ['a1.daily-routine'], tags: ['production'] }),
  skill({ id: 'a2.plans', level: 'A2', type: 'can_do', title: 'Plans and invitations', objective: 'Discuss a simple plan, invitation, time, and meeting place.', prerequisites: ['a1.simple-questions'], tags: ['interaction'] }),
  skill({ id: 'a2.preferences', level: 'A2', type: 'can_do', title: 'Preferences and reasons', objective: 'State a preference and give a short concrete reason.', prerequisites: ['a1.daily-routine'], tags: ['production'] }),
  skill({ id: 'a2.te-form', level: 'A2', type: 'grammar', title: 'て-form sequences', objective: 'Use the て-form for requests and short action sequences.', prerequisites: ['a1.polite-present'], tags: ['grammar'] }),
  skill({ id: 'a2.plain-polite', level: 'A2', type: 'grammar', title: 'Plain and polite forms', objective: 'Recognize and use basic plain versus polite choices appropriately.', prerequisites: ['a1.polite-present'], tags: ['grammar', 'register'] }),
  skill({ id: 'a2.sokuon', level: 'A2', type: 'pronunciation', title: 'Geminate consonants', objective: 'Produce っ contrasts clearly in controlled words and phrases.', prerequisites: ['a1.mora-timing'], tags: ['phonology', 'rhythm'] }),
  skill({ id: 'a2.follow-up', level: 'A2', type: 'conversation', title: 'Follow-up questions', objective: 'Keep an exchange moving with a relevant short follow-up question.', prerequisites: ['a1.repair-basic'], tags: ['interaction', 'strategy'] }),
  skill({ id: 'a2.listening-details', level: 'A2', type: 'listening', title: 'Everyday listening details', objective: 'Catch key details in short messages about plans, times, places, and routine events.', prerequisites: ['a1.listening-core'], tags: ['listening'] }),

  skill({ id: 'b1.narrative', level: 'B1', type: 'can_do', title: 'Connected narrative', objective: 'Tell a connected story with sequence, cause, and outcome.', prerequisites: ['a2.experiences'], tags: ['production'] }),
  skill({ id: 'b1.opinions', level: 'B1', type: 'can_do', title: 'Supported opinions', objective: 'Explain an opinion with reasons and respond to another viewpoint.', prerequisites: ['a2.preferences'], tags: ['interaction', 'production'] }),
  skill({ id: 'b1.problem-solving', level: 'B1', type: 'can_do', title: 'Problem solving', objective: 'Explain a practical problem, compare options, and agree on a response.', prerequisites: ['a2.transactions', 'a2.plans'], tags: ['scenario', 'interaction'] }),
  skill({ id: 'b1.explanation', level: 'B1', type: 'can_do', title: 'Clear explanation', objective: 'Explain a familiar process or idea in connected language.', prerequisites: ['a2.experiences'], tags: ['production'] }),
  skill({ id: 'b1.clause-linking', level: 'B1', type: 'grammar', title: 'Clause linking', objective: 'Connect ideas using reason, contrast, condition, and sequence.', prerequisites: ['a2.te-form'], tags: ['grammar'] }),
  skill({ id: 'b1.register-control', level: 'B1', type: 'conversation', title: 'Register control', objective: 'Maintain an appropriate polite or casual register across an exchange.', prerequisites: ['a2.plain-polite'], tags: ['interaction', 'register'] }),
  skill({ id: 'b1.fluency', level: 'B1', type: 'conversation', title: 'Sustained fluency', objective: 'Sustain a familiar discussion with manageable pauses and self-repair.', prerequisites: ['a2.follow-up'], tags: ['fluency', 'strategy'] }),
  skill({ id: 'b1.pitch-awareness', level: 'B1', type: 'pronunciation', title: 'Pitch awareness', objective: 'Notice and imitate phrase-level pitch movement without sacrificing intelligibility.', prerequisites: ['a2.sokuon'], tags: ['phonology', 'pitch'] }),
  skill({ id: 'b1.listening-connected', level: 'B1', type: 'listening', title: 'Connected listening', objective: 'Follow the main points and supporting details in clear connected speech on familiar topics.', prerequisites: ['a2.listening-details'], tags: ['listening'] }),

  skill({ id: 'b2.nuanced-opinion', level: 'B2', type: 'can_do', title: 'Nuanced opinion', objective: 'Develop and qualify a viewpoint while addressing counterarguments.', prerequisites: ['b1.opinions'], tags: ['interaction', 'production'] }),
  skill({ id: 'b2.negotiation', level: 'B2', type: 'can_do', title: 'Negotiation', objective: 'Negotiate constraints, clarify implications, and reach a workable agreement.', prerequisites: ['b1.problem-solving'], tags: ['scenario', 'interaction'] }),
  skill({ id: 'b2.abstract-explanation', level: 'B2', type: 'can_do', title: 'Abstract explanation', objective: 'Explain an unfamiliar or abstract issue with clear organization.', prerequisites: ['b1.explanation'], tags: ['production'] }),
  skill({ id: 'b2.discourse-control', level: 'B2', type: 'grammar', title: 'Discourse control', objective: 'Use cohesive devices and stance markers without sounding over-rehearsed.', prerequisites: ['b1.clause-linking'], tags: ['grammar', 'fluency'] }),
  skill({ id: 'b2.interaction-strategy', level: 'B2', type: 'conversation', title: 'Interaction strategy', objective: 'Manage turns, clarify assumptions, and redirect a complex discussion naturally.', prerequisites: ['b1.register-control', 'b1.fluency'], tags: ['interaction', 'strategy'] }),
  skill({ id: 'b2.prosodic-control', level: 'B2', type: 'pronunciation', title: 'Prosodic control', objective: 'Use pacing, prominence, and phrase boundaries to make intent easy to follow.', prerequisites: ['b1.pitch-awareness'], tags: ['phonology', 'fluency'] }),
  skill({ id: 'b2.listening-nuance', level: 'B2', type: 'listening', title: 'Nuanced listening', objective: 'Follow stance, qualification, and implied contrast in extended standard Japanese.', prerequisites: ['b1.listening-connected'], tags: ['listening'] })
]);

const SKILL_BY_ID = new Map(TUTOR_SKILL_GRAPH.map((entry) => [entry.id, entry]));

export function normalizeSpeakingProfile(profile = {}, legacyProfile = null) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const legacy = legacyProfile && typeof legacyProfile === 'object' ? legacyProfile : {};
  const fallbackLevel = normalizeLevelSignal(source.overallLevel || legacy.estimatedLevel, 'A1');
  const dimensionsSource = source.dimensions && typeof source.dimensions === 'object'
    ? source.dimensions
    : {};
  const dimensions = {};
  TUTOR_SPEAKING_DIMENSIONS.forEach((dimension) => {
    const value = dimensionsSource[dimension] && typeof dimensionsSource[dimension] === 'object'
      ? dimensionsSource[dimension]
      : {};
    dimensions[dimension] = {
      level: normalizeCefrLevel(value.level, fallbackLevel),
      score: cleanNumber(value.score, 0.2),
      confidence: cleanNumber(value.confidence, 0),
      evidenceCount: Math.max(0, Math.trunc(Number(value.evidenceCount) || 0))
    };
  });
  return {
    schemaVersion: TUTOR_V2_SCHEMA_VERSION,
    overallLevel: normalizeCefrLevel(source.overallLevel, fallbackLevel),
    contentCeiling: cleanString(source.contentCeiling || legacy.vocabularyLevel, 8).toUpperCase() || 'N5',
    goal: cleanString(source.goal, 240) || 'Hold comfortable everyday conversations in Japanese.',
    nativeLanguage: cleanString(source.nativeLanguage, 40) || 'English',
    targetLanguage: 'Japanese',
    dimensions,
    strengths: cleanStringList(source.strengths || legacy.strengths, 12, 180),
    prioritySkills: cleanStringList(source.prioritySkills, 12, 120),
    recurringMistakes: cleanStringList(source.recurringMistakes || legacy.recurringMistakes, 20, 220),
    completedDiagnosticAt: optionalTimestamp(source.completedDiagnosticAt),
    lastBenchmarkAt: optionalTimestamp(source.lastBenchmarkAt),
    updatedAt: cleanTimestamp(source.updatedAt)
  };
}

export function normalizeMasteryRecord(record = {}, skillId = '') {
  const id = cleanString(record.skillId || skillId, 120);
  if (!id || !SKILL_BY_ID.has(id)) {
    return null;
  }
  return {
    skillId: id,
    mastery: cleanNumber(record.mastery, 0.2),
    confidence: cleanNumber(record.confidence, 0),
    evidenceCount: Math.max(0, Math.trunc(Number(record.evidenceCount) || 0)),
    successfulRepairs: Math.max(0, Math.trunc(Number(record.successfulRepairs) || 0)),
    lastPracticedAt: optionalTimestamp(record.lastPracticedAt),
    nextReviewAt: optionalTimestamp(record.nextReviewAt),
    updatedAt: cleanTimestamp(record.updatedAt)
  };
}

export function normalizeMasteryMap(value = {}) {
  const sourceEntries = Array.isArray(value)
    ? value.map((entry) => [entry?.skillId, entry])
    : Object.entries(value && typeof value === 'object' ? value : {});
  return Object.fromEntries(sourceEntries
    .map(([skillId, record]) => normalizeMasteryRecord(record, skillId))
    .filter(Boolean)
    .map((record) => [record.skillId, record]));
}

export function normalizeMasteryEvidence(evidence = {}) {
  const source = evidence && typeof evidence === 'object' ? evidence : {};
  const skillId = cleanString(source.skillId, 120);
  const evidenceSource = cleanString(source.source, 40).toLowerCase();
  if (!skillId || !SKILL_BY_ID.has(skillId) || !TUTOR_EVIDENCE_SOURCES.includes(evidenceSource)) {
    return null;
  }
  const dimension = cleanString(source.dimension, 40).toLowerCase();
  return {
    id: cleanString(source.id, 140) || `evidence_${Date.now()}`,
    skillId,
    source: evidenceSource,
    sessionId: cleanString(source.sessionId, 140),
    turnId: cleanString(source.turnId, 140),
    activityId: cleanString(source.activityId, 140),
    dimension: TUTOR_SPEAKING_DIMENSIONS.includes(dimension) ? dimension : '',
    score: cleanNumber(source.score, 0.5),
    confidence: cleanNumber(source.confidence, 0.5),
    repairSuccessful: Boolean(source.repairSuccessful),
    summary: cleanString(source.summary, 500),
    provider: cleanString(source.provider, 80),
    providerMetric: cleanString(source.providerMetric, 80),
    observedAt: cleanTimestamp(source.observedAt)
  };
}

export function normalizeReviewItem(item = {}) {
  const skillId = cleanString(item.skillId, 120);
  const id = cleanString(item.id, 120);
  if (!id || !SKILL_BY_ID.has(skillId)) {
    return null;
  }
  return {
    id,
    skillId,
    prompt: cleanString(item.prompt, 600),
    dueAt: cleanTimestamp(item.dueAt),
    intervalDays: Math.max(1, Math.min(90, Math.trunc(Number(item.intervalDays) || 1))),
    repetitions: Math.max(0, Math.trunc(Number(item.repetitions) || 0)),
    lastScore: cleanNumber(item.lastScore, 0),
    sourceTurnId: cleanString(item.sourceTurnId, 120),
    createdAt: cleanTimestamp(item.createdAt),
    updatedAt: cleanTimestamp(item.updatedAt)
  };
}

export function normalizeReviewItems(items = []) {
  return Array.isArray(items)
    ? items.map(normalizeReviewItem).filter(Boolean).sort((a, b) => a.dueAt - b.dueAt)
    : [];
}

export function getDueReviewItems(items = [], now = Date.now()) {
  return normalizeReviewItems(items).filter((item) => item.dueAt <= now);
}

export function normalizeMission(mission = {}) {
  const targetSkillIds = cleanStringList(mission.targetSkillIds, 6, 120).filter((id) => SKILL_BY_ID.has(id));
  const primarySkill = SKILL_BY_ID.get(targetSkillIds[0]);
  return {
    id: cleanString(mission.id, 120) || `mission_${Date.now()}`,
    title: cleanString(mission.title, 160) || primarySkill?.title || 'Japanese speaking practice',
    objective: cleanString(mission.objective, 500) || primarySkill?.objective || 'Sustain a short Japanese exchange.',
    mode: normalizeMode(mission.mode),
    level: normalizeCefrLevel(mission.level, primarySkill?.level || 'A1'),
    durationMinutes: Math.max(5, Math.min(30, Math.trunc(Number(mission.durationMinutes) || 12))),
    targetSkillIds,
    reviewItemIds: cleanStringList(mission.reviewItemIds, 12, 120),
    topic: cleanString(mission.topic, 200),
    successTarget: cleanNumber(mission.successTarget, 0.8, 0.6, 0.95),
    generatedAt: cleanTimestamp(mission.generatedAt)
  };
}

function getAvailableSkillsForLevel(level) {
  const maxIndex = LEVEL_ORDER.get(normalizeCefrLevel(level)) ?? 0;
  return TUTOR_SKILL_GRAPH.filter((entry) => (LEVEL_ORDER.get(entry.level) ?? 0) <= Math.min(maxIndex + 1, 3));
}

function prerequisitesReady(entry, mastery) {
  return entry.prerequisites.every((id) => (mastery[id]?.mastery || 0) >= 0.45);
}

export function selectDailyMission({
  profile = {},
  mastery = {},
  reviewItems = [],
  preferences = {},
  topic = '',
  now = Date.now()
} = {}) {
  const normalizedProfile = normalizeSpeakingProfile(profile);
  const normalizedMastery = normalizeMasteryMap(mastery);
  const due = getDueReviewItems(reviewItems, now);
  const mode = normalizeMode(preferences.mode);
  const candidates = getAvailableSkillsForLevel(normalizedProfile.overallLevel)
    .filter((entry) => prerequisitesReady(entry, normalizedMastery))
    .map((entry) => ({
      entry,
      mastery: normalizedMastery[entry.id]?.mastery ?? 0.2,
      due: due.some((item) => item.skillId === entry.id),
      priority: normalizedProfile.prioritySkills.includes(entry.id)
    }))
    .sort((left, right) => {
      const leftScore = left.mastery - (left.due ? 0.35 : 0) - (left.priority ? 0.2 : 0);
      const rightScore = right.mastery - (right.due ? 0.35 : 0) - (right.priority ? 0.2 : 0);
      return leftScore - rightScore;
    });
  const primary = candidates[0]?.entry || TUTOR_SKILL_GRAPH[0];
  const supporting = candidates
    .slice(1)
    .map(({ entry }) => entry)
    .find((entry) => entry.type !== primary.type && entry.level === primary.level);
  const selectedSkills = [primary, supporting].filter(Boolean);
  return normalizeMission({
    id: `mission_${new Date(now).toISOString().slice(0, 10)}`,
    title: due.length ? `Review: ${primary.title}` : primary.title,
    objective: primary.objective,
    mode,
    level: primary.level,
    durationMinutes: preferences.durationMinutes,
    targetSkillIds: selectedSkills.map((entry) => entry.id),
    reviewItemIds: due.filter((item) => selectedSkills.some((entry) => entry.id === item.skillId)).map((item) => item.id),
    topic: topic || cleanString(preferences.topic, 200),
    successTarget: 0.8,
    generatedAt: now
  });
}

function createActivity({
  phase,
  goal,
  instructions,
  difficultyLevel = 'A1',
  minAttempts = 1,
  maxAttempts = 2,
  targetSkillIds = []
}, index) {
  return {
    id: `activity_${index + 1}_${phase}`,
    phase,
    goal,
    instructions,
    difficultyLevel: normalizeCefrLevel(difficultyLevel),
    targetSkillIds,
    exitCriteria: {
      minAttempts,
      maxAttempts,
      requiredScore: phase === 'repair' ? 0.7 : 0.65
    }
  };
}

export function normalizeLessonBlueprint(blueprint = {}) {
  const mission = normalizeMission(blueprint.mission || blueprint);
  const sourceActivities = Array.isArray(blueprint.activities) ? blueprint.activities : [];
  const activities = sourceActivities.slice(0, 16).map((activity, index) => {
    const phase = normalizePhase(activity?.phase);
    const exitCriteria = activity?.exitCriteria && typeof activity.exitCriteria === 'object'
      ? activity.exitCriteria
      : {};
    return {
      id: cleanString(activity?.id, 120) || `activity_${index + 1}_${phase}`,
      phase,
      goal: cleanString(activity?.goal, 500),
      instructions: cleanString(activity?.instructions, 1000),
      difficultyLevel: normalizeCefrLevel(activity?.difficultyLevel, mission.level),
      targetSkillIds: cleanStringList(activity?.targetSkillIds, 6, 120).filter((id) => SKILL_BY_ID.has(id)),
      exitCriteria: {
        minAttempts: Math.max(0, Math.min(5, Math.trunc(Number(exitCriteria.minAttempts) || 1))),
        maxAttempts: Math.max(1, Math.min(6, Math.trunc(Number(exitCriteria.maxAttempts) || 2))),
        requiredScore: cleanNumber(exitCriteria.requiredScore, 0.65, 0.4, 1)
      }
    };
  });
  if (!activities.length) {
    return null;
  }
  return {
    id: cleanString(blueprint.id, 120) || `blueprint_${Date.now()}`,
    schemaVersion: TUTOR_V2_SCHEMA_VERSION,
    mission,
    activities,
    languageBudget: {
      defaultLanguage: 'ja',
      englishBridgeMaxSentences: 1,
      tutorMaxSentences: 2,
      vocabularyCeiling: cleanString(blueprint.languageBudget?.vocabularyCeiling, 8).toUpperCase() || 'N5'
    },
    createdAt: cleanTimestamp(blueprint.createdAt)
  };
}

export function buildLessonBlueprint({ mission = {}, profile = {}, topic = '' } = {}) {
  const normalizedMission = normalizeMission({ ...mission, topic: topic || mission.topic });
  const normalizedProfile = normalizeSpeakingProfile(profile);
  const targets = normalizedMission.targetSkillIds;
  const targetLabel = targets.map((id) => SKILL_BY_ID.get(id)?.title).filter(Boolean).join(' and ');
  let phases = TUTOR_ACTIVITY_PHASES;
  if (normalizedMission.mode === 'free') {
    phases = ['briefing', 'independent_attempt', 'feedback', 'repair', 'transfer', 'recap'];
  } else if (normalizedMission.mode === 'pronunciation') {
    phases = ['briefing', 'model', 'scaffolded_attempt', 'feedback', 'repair', 'transfer', 'recap'];
  }
  const activityCopy = {
    briefing: ['Set the goal', `Briefly introduce ${targetLabel || normalizedMission.title} in Japanese and ask one easy opening question.`],
    model: ['Hear a useful model', 'Give one natural Japanese model phrase. Ask the learner to notice its meaning and sound before trying it.'],
    scaffolded_attempt: ['Try with support', 'Prompt a short attempt and offer only the minimum hint needed.'],
    independent_attempt: ['Use it independently', 'Create a realistic exchange where the learner must use the target without being given the answer.'],
    feedback: ['Focus the correction', 'If there is a high-confidence meaningful issue, give one concise correction and explain only what matters.'],
    repair: ['Repair the turn', 'Ask the learner to say the corrected idea again. Do not advance until the repair is understandable or two attempts have occurred.'],
    transfer: ['Transfer the skill', 'Change one detail of the situation and ask the learner to use the same skill in a new way.'],
    recap: ['Finish and retrieve', 'Ask the learner for one final short use of the target, then close with one specific win and one next step.']
  };
  const activities = phases.map((phase, index) => createActivity({
    phase,
    goal: activityCopy[phase][0],
    instructions: activityCopy[phase][1],
    difficultyLevel: normalizedMission.level,
    minAttempts: phase === 'independent_attempt' && normalizedMission.mode === 'free' ? 4 : (phase === 'briefing' ? 0 : 1),
    maxAttempts: phase === 'independent_attempt' && normalizedMission.mode === 'free' ? 8 : 2,
    targetSkillIds: targets
  }, index));
  return normalizeLessonBlueprint({
    id: `blueprint_${normalizedMission.id}`,
    mission: normalizedMission,
    activities,
    languageBudget: {
      vocabularyCeiling: normalizedProfile.contentCeiling
    },
    createdAt: Date.now()
  });
}

export function buildDiagnosticBlueprint({ profile = {}, durationMinutes = 15 } = {}) {
  const normalizedProfile = normalizeSpeakingProfile(profile);
  const mission = normalizeMission({
    id: `diagnostic_${Date.now()}`,
    title: 'Speaking baseline',
    objective: 'Establish a reliable baseline across interaction, production, listening, language control, fluency, and phonology.',
    mode: 'guided',
    level: 'A1',
    durationMinutes,
    targetSkillIds: ['a1.introductions', 'a1.simple-questions', 'a1.mora-timing', 'a2.experiences', 'b1.opinions'],
    successTarget: 0.75
  });
  const definitions = [
    {
      phase: 'briefing',
      difficultyLevel: 'A1',
      goal: 'Simple greeting',
      instructions: 'Do not explain the baseline yet. Say exactly one short greeting, then ask: お名前は何ですか？ Accept a name or a short self-introduction.',
      targetSkillIds: ['a1.introductions']
    },
    {
      phase: 'independent_attempt',
      difficultyLevel: 'A1',
      goal: 'Familiar personal question',
      instructions: 'Ask one concrete N5-level question, such as 好きな食べ物は何ですか？ Do not combine questions.',
      targetSkillIds: ['a1.simple-questions', 'a1.core-vocabulary']
    },
    {
      phase: 'model',
      difficultyLevel: 'A1',
      goal: 'Essential listening',
      instructions: 'Say one very short N5-level statement about a familiar fact, then ask one concrete detail question. Use no more than eight Japanese words.',
      targetSkillIds: ['a1.listening-core']
    },
    {
      phase: 'scaffolded_attempt',
      difficultyLevel: 'A1',
      goal: 'Simple request',
      instructions: 'Use a basic cafe roleplay. Ask the learner to request one drink in Japanese. Give one short model only if they need help.',
      targetSkillIds: ['a1.basic-requests', 'a1.polite-present']
    },
    {
      phase: 'model',
      difficultyLevel: 'A1',
      goal: 'Controlled pronunciation',
      instructions: 'Give one short N5 phrase with clear mora timing or a long vowel and ask for one repetition. Do not diagnose pronunciation from the transcript.',
      targetSkillIds: ['a1.mora-timing', 'a1.vowel-length']
    },
    {
      phase: 'independent_attempt',
      difficultyLevel: 'A2',
      goal: 'Short past experience',
      instructions: 'Only after the A1 gate is passed, ask for two or three short sentences about something the learner did recently.',
      targetSkillIds: ['a2.experiences']
    },
    {
      phase: 'transfer',
      difficultyLevel: 'B1',
      goal: 'Opinion with a reason',
      instructions: 'Only after an A2 success, ask for a simple opinion and one reason on a familiar topic. Do not ask an abstract or specialized question.',
      targetSkillIds: ['b1.opinions']
    },
    {
      phase: 'recap',
      difficultyLevel: 'A1',
      goal: 'Close the baseline',
      instructions: 'Thank the learner briefly in Japanese. Say the baseline is complete and that their next practice will adapt to this result. Ask no English practice question.',
      targetSkillIds: ['a1.repair-basic']
    }
  ];
  return normalizeLessonBlueprint({
    id: `blueprint_${mission.id}`,
    mission,
    activities: definitions.map((definition, index) => createActivity({
      ...definition,
      minAttempts: 1,
      maxAttempts: definition.phase === 'recap' ? 1 : 2
    }, index)),
    languageBudget: { vocabularyCeiling: normalizedProfile.contentCeiling }
  });
}

export function normalizeActivityState(state = {}, blueprint = null) {
  const normalizedBlueprint = normalizeLessonBlueprint(blueprint || state.blueprint || {});
  const maxIndex = Math.max(0, (normalizedBlueprint?.activities.length || 1) - 1);
  const activityIndex = Math.max(0, Math.min(maxIndex, Math.trunc(Number(state.activityIndex) || 0)));
  const activity = normalizedBlueprint?.activities[activityIndex] || null;
  return {
    blueprintId: cleanString(state.blueprintId, 120) || normalizedBlueprint?.id || '',
    activityIndex,
    activityId: activity?.id || cleanString(state.activityId, 120),
    phase: activity?.phase || normalizePhase(state.phase),
    attemptCount: Math.max(0, Math.trunc(Number(state.attemptCount) || 0)),
    completedActivityIds: cleanStringList(state.completedActivityIds, 20, 120),
    repairRequired: Boolean(state.repairRequired),
    pendingCorrection: cleanString(state.pendingCorrection, 600),
    lastAssessmentId: cleanString(state.lastAssessmentId, 120),
    diagnosticPassCount: Math.max(0, Math.trunc(Number(state.diagnosticPassCount) || 0)),
    diagnosticStruggleCount: Math.max(0, Math.trunc(Number(state.diagnosticStruggleCount) || 0)),
    diagnosticHighestLevel: normalizeCefrLevel(state.diagnosticHighestLevel, 'A1'),
    status: ['active', 'completed', 'error'].includes(state.status) ? state.status : 'active',
    startedAt: cleanTimestamp(state.startedAt),
    updatedAt: cleanTimestamp(state.updatedAt)
  };
}

export function createInitialActivityState(blueprint) {
  return normalizeActivityState({
    blueprintId: blueprint?.id,
    activityIndex: 0,
    attemptCount: 0,
    completedActivityIds: [],
    repairRequired: false,
    status: 'active',
    startedAt: Date.now(),
    updatedAt: Date.now()
  }, blueprint);
}

export function normalizeTurnAssessment(assessment = {}) {
  const source = assessment && typeof assessment === 'object' ? assessment : {};
  const correction = source.correction && typeof source.correction === 'object' ? source.correction : {};
  const acoustic = source.acoustic && typeof source.acoustic === 'object' ? source.acoustic : {};
  const dimensions = {};
  TUTOR_SPEAKING_DIMENSIONS.forEach((dimension) => {
    dimensions[dimension] = cleanNumber(source.dimensions?.[dimension], 0.5);
  });
  return {
    id: cleanString(source.id, 120) || `assessment_${Date.now()}`,
    turnId: cleanString(source.turnId, 120),
    activityId: cleanString(source.activityId, 120),
    transcript: cleanString(source.transcript, 12000),
    transcriptConfidence: cleanNumber(source.transcriptConfidence, 0.5),
    responseLatencyMs: Math.max(0, Math.trunc(Number(source.responseLatencyMs) || 0)),
    languageSpans: Array.isArray(source.languageSpans)
      ? source.languageSpans.slice(0, 20).map((span) => ({
        language: span?.language === 'en' ? 'en' : 'ja',
        text: cleanString(span?.text, 1000),
        confidence: cleanNumber(span?.confidence, 0.5)
      })).filter((span) => span.text)
      : [],
    understood: Boolean(source.understood),
    taskCompleted: Boolean(source.taskCompleted),
    taskScore: cleanNumber(source.taskScore, 0.5),
    grammarFindings: cleanStringList(source.grammarFindings, 8, 280),
    vocabularyFindings: cleanStringList(source.vocabularyFindings, 8, 280),
    fillers: cleanStringList(source.fillers, 12, 80),
    dimensions,
    targetSkillIds: cleanStringList(source.targetSkillIds, 8, 120).filter((id) => SKILL_BY_ID.has(id)),
    correction: {
      required: Boolean(correction.required),
      confidence: cleanNumber(correction.confidence, 0),
      category: cleanString(correction.category, 60),
      original: cleanString(correction.original, 600),
      corrected: cleanString(correction.corrected, 600),
      explanation: cleanString(correction.explanation, 800),
      requiresRepair: Boolean(correction.requiresRepair)
    },
    repairSuccessful: Boolean(source.repairSuccessful),
    acoustic: {
      source: cleanString(acoustic.source, 80) || 'none',
      confidence: cleanNumber(acoustic.confidence, 0),
      durationMs: Math.max(0, Math.trunc(Number(acoustic.durationMs) || 0)),
      speechRate: Math.max(0, Number(acoustic.speechRate) || 0),
      pauseRatio: cleanNumber(acoustic.pauseRatio, 0),
      accuracy: Number.isFinite(Number(acoustic.accuracy)) ? cleanNumber(acoustic.accuracy) : null,
      fluency: Number.isFinite(Number(acoustic.fluency)) ? cleanNumber(acoustic.fluency) : null,
      calibratedPitchScore: null
    },
    notes: cleanStringList(source.notes, 8, 280),
    createdAt: cleanTimestamp(source.createdAt)
  };
}

export function normalizeBenchmarkResult(result = {}) {
  const source = result && typeof result === 'object' ? result : {};
  const dimensions = {};
  TUTOR_SPEAKING_DIMENSIONS.forEach((dimension) => {
    dimensions[dimension] = cleanNumber(source.dimensions?.[dimension], 0.5);
  });
  return {
    id: cleanString(source.id, 140) || `benchmark_${Date.now()}`,
    sessionId: cleanString(source.sessionId, 140),
    promptVersion: cleanString(source.promptVersion, 80) || 'jf-speaking-v1',
    dimensions,
    taskScore: cleanNumber(source.taskScore, 0.5),
    audioClipIds: cleanStringList(source.audioClipIds, 20, 140),
    notes: cleanStringList(source.notes, 12, 300),
    recordedAt: cleanTimestamp(source.recordedAt)
  };
}

function findActivityIndexByPhase(blueprint, phase, afterIndex = -1) {
  return blueprint.activities.findIndex((activity, index) => index > afterIndex && activity.phase === phase);
}

function isDiagnosticBlueprint(blueprint) {
  return blueprint?.mission?.id?.startsWith('diagnostic_');
}

function nextDiagnosticActivityIndex(blueprint, startIndex, state) {
  for (let index = startIndex; index < blueprint.activities.length; index += 1) {
    const candidate = blueprint.activities[index];
    if (candidate.phase === 'recap' || candidate.difficultyLevel === 'A1') {
      return index;
    }
    if (candidate.difficultyLevel === 'A2' && state.diagnosticPassCount >= 3) {
      return index;
    }
    if (candidate.difficultyLevel === 'B1' && LEVEL_ORDER.get(state.diagnosticHighestLevel) >= LEVEL_ORDER.get('A2')) {
      return index;
    }
  }
  return blueprint.activities.length;
}

function advanceDiagnosticState(blueprint, current, activity, result) {
  const attemptCount = current.attemptCount + 1;
  const passed = result.understood
    && result.taskCompleted
    && result.taskScore >= activity.exitCriteria.requiredScore;
  const diagnosticPassCount = current.diagnosticPassCount + (passed ? 1 : 0);
  const diagnosticStruggleCount = current.diagnosticStruggleCount + (passed ? 0 : 1);
  const diagnosticHighestLevel = passed
    && LEVEL_ORDER.get(activity.difficultyLevel) > LEVEL_ORDER.get(current.diagnosticHighestLevel)
    ? activity.difficultyLevel
    : current.diagnosticHighestLevel;
  const shouldAdvance = (passed && attemptCount >= activity.exitCriteria.minAttempts)
    || attemptCount >= activity.exitCriteria.maxAttempts;
  let nextIndex = current.activityIndex;
  if (shouldAdvance) {
    nextIndex = nextDiagnosticActivityIndex(blueprint, current.activityIndex + 1, {
      diagnosticPassCount,
      diagnosticHighestLevel
    });
  }
  const isComplete = nextIndex >= blueprint.activities.length;
  const boundedIndex = Math.min(nextIndex, blueprint.activities.length - 1);
  return normalizeActivityState({
    ...current,
    activityIndex: boundedIndex,
    attemptCount: nextIndex === current.activityIndex ? attemptCount : 0,
    completedActivityIds: nextIndex !== current.activityIndex
      ? Array.from(new Set([...current.completedActivityIds, activity.id]))
      : current.completedActivityIds,
    repairRequired: false,
    pendingCorrection: '',
    lastAssessmentId: result.id,
    diagnosticPassCount,
    diagnosticStruggleCount,
    diagnosticHighestLevel,
    status: isComplete ? 'completed' : 'active',
    updatedAt: Date.now()
  }, blueprint);
}

export function advanceLessonState({ blueprint, state, assessment }) {
  const normalizedBlueprint = normalizeLessonBlueprint(blueprint);
  if (!normalizedBlueprint) {
    return normalizeActivityState({ ...state, status: 'error' });
  }
  const current = normalizeActivityState(state, normalizedBlueprint);
  const result = normalizeTurnAssessment(assessment);
  const activity = normalizedBlueprint.activities[current.activityIndex];
  if (!activity || current.status !== 'active') {
    return current;
  }
  if (isDiagnosticBlueprint(normalizedBlueprint)) {
    return advanceDiagnosticState(normalizedBlueprint, current, activity, result);
  }
  const attemptCount = current.attemptCount + 1;
  let nextIndex = current.activityIndex;
  let repairRequired = current.repairRequired;
  let pendingCorrection = current.pendingCorrection;

  if (result.correction.required && result.correction.requiresRepair && result.correction.confidence >= 0.75) {
    const nextRepairIndex = findActivityIndexByPhase(normalizedBlueprint, 'repair', current.activityIndex);
    const repairIndex = nextRepairIndex !== -1
      ? nextRepairIndex
      : normalizedBlueprint.activities.findIndex((entry) => entry.phase === 'repair');
    if (repairIndex !== -1) {
      nextIndex = repairIndex;
      repairRequired = true;
      pendingCorrection = result.correction.corrected;
    }
  } else if (activity.phase === 'repair') {
    if (result.repairSuccessful || attemptCount >= activity.exitCriteria.maxAttempts) {
      repairRequired = false;
      pendingCorrection = '';
      nextIndex += 1;
    }
  } else {
    const passed = result.taskCompleted && result.taskScore >= activity.exitCriteria.requiredScore;
    if ((passed && attemptCount >= activity.exitCriteria.minAttempts) || attemptCount >= activity.exitCriteria.maxAttempts) {
      nextIndex += 1;
    }
  }

  const completedActivityIds = nextIndex !== current.activityIndex
    ? Array.from(new Set([...current.completedActivityIds, activity.id]))
    : current.completedActivityIds;
  const isComplete = nextIndex >= normalizedBlueprint.activities.length;
  const boundedIndex = Math.min(nextIndex, normalizedBlueprint.activities.length - 1);
  return normalizeActivityState({
    ...current,
    activityIndex: boundedIndex,
    attemptCount: nextIndex === current.activityIndex ? attemptCount : 0,
    completedActivityIds,
    repairRequired,
    pendingCorrection,
    lastAssessmentId: result.id,
    status: isComplete ? 'completed' : 'active',
    updatedAt: Date.now()
  }, normalizedBlueprint);
}

function reviewIntervalDays(score, repetitions) {
  if (score >= 0.9) {
    return Math.min(30, Math.max(7, 7 * Math.max(1, repetitions)));
  }
  if (score >= 0.75) {
    return Math.min(14, Math.max(3, 3 * Math.max(1, repetitions)));
  }
  return 1;
}

export function applyAssessmentToMastery({ mastery = {}, reviewItems = [], assessment, now = Date.now() } = {}) {
  const normalizedMastery = normalizeMasteryMap(mastery);
  const normalizedReviews = normalizeReviewItems(reviewItems);
  const result = normalizeTurnAssessment(assessment);
  const targetSkillIds = result.targetSkillIds.length ? result.targetSkillIds : [];
  targetSkillIds.forEach((skillId) => {
    const previous = normalizedMastery[skillId] || normalizeMasteryRecord({}, skillId);
    const dimensionScores = Object.values(result.dimensions);
    const dimensionAverage = dimensionScores.reduce((sum, score) => sum + score, 0) / Math.max(1, dimensionScores.length);
    const evidenceScore = cleanNumber((result.taskScore * 0.6) + (dimensionAverage * 0.4));
    const evidenceConfidence = Math.max(0.35, result.transcriptConfidence, result.correction.confidence);
    const weight = 0.15 + (0.35 * evidenceConfidence);
    const repairedBoost = result.repairSuccessful ? 0.04 : 0;
    normalizedMastery[skillId] = normalizeMasteryRecord({
      ...previous,
      mastery: previous.mastery + (weight * (evidenceScore - previous.mastery)) + repairedBoost,
      confidence: previous.confidence + (0.2 * (evidenceConfidence - previous.confidence)),
      evidenceCount: previous.evidenceCount + 1,
      successfulRepairs: previous.successfulRepairs + (result.repairSuccessful ? 1 : 0),
      lastPracticedAt: now,
      nextReviewAt: now + (reviewIntervalDays(evidenceScore, previous.evidenceCount + 1) * DAY_MS),
      updatedAt: now
    }, skillId);

    const existingIndex = normalizedReviews.findIndex((item) => item.skillId === skillId);
    const existing = existingIndex === -1 ? null : normalizedReviews[existingIndex];
    const repetitions = (existing?.repetitions || 0) + 1;
    const intervalDays = reviewIntervalDays(evidenceScore, repetitions);
    const next = normalizeReviewItem({
      id: existing?.id || `review_${skillId.replace(/[^a-z0-9]+/gi, '_')}`,
      skillId,
      prompt: result.correction.corrected || SKILL_BY_ID.get(skillId)?.objective || '',
      dueAt: now + (intervalDays * DAY_MS),
      intervalDays,
      repetitions,
      lastScore: evidenceScore,
      sourceTurnId: result.turnId,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    if (existingIndex === -1) {
      normalizedReviews.push(next);
    } else {
      normalizedReviews[existingIndex] = next;
    }
  });
  return {
    mastery: normalizedMastery,
    reviewItems: normalizeReviewItems(normalizedReviews)
  };
}

export function deriveSpeakingProfile(profile = {}, mastery = {}) {
  const normalized = normalizeSpeakingProfile(profile);
  const records = Object.values(normalizeMasteryMap(mastery));
  if (!records.length) {
    return normalized;
  }
  const dimensions = { ...normalized.dimensions };
  TUTOR_SPEAKING_DIMENSIONS.forEach((dimension) => {
    const relevant = records.filter((record) => SKILL_BY_ID.get(record.skillId)?.tags.includes(dimension)
      || SKILL_BY_ID.get(record.skillId)?.type === dimension);
    if (!relevant.length) {
      return;
    }
    const weighted = relevant.reduce((sum, record) => sum + (record.mastery * Math.max(0.25, record.confidence)), 0);
    const weight = relevant.reduce((sum, record) => sum + Math.max(0.25, record.confidence), 0);
    const score = weighted / weight;
    const strongestLevel = relevant
      .filter((record) => record.mastery >= 0.7)
      .map((record) => SKILL_BY_ID.get(record.skillId)?.level)
      .filter(Boolean)
      .sort((a, b) => (LEVEL_ORDER.get(b) || 0) - (LEVEL_ORDER.get(a) || 0))[0] || dimensions[dimension].level;
    dimensions[dimension] = {
      level: strongestLevel,
      score,
      confidence: Math.min(1, relevant.reduce((sum, record) => sum + record.confidence, 0) / 4),
      evidenceCount: relevant.reduce((sum, record) => sum + record.evidenceCount, 0)
    };
  });
  const overallCandidates = Object.values(dimensions).filter((entry) => entry.evidenceCount > 0);
  const overallLevel = overallCandidates.length
    ? overallCandidates.map((entry) => entry.level).sort((a, b) => (LEVEL_ORDER.get(a) || 0) - (LEVEL_ORDER.get(b) || 0))[Math.floor((overallCandidates.length - 1) / 2)]
    : normalized.overallLevel;
  const prioritySkills = records
    .slice()
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6)
    .map((record) => record.skillId);
  return normalizeSpeakingProfile({
    ...normalized,
    overallLevel,
    dimensions,
    prioritySkills,
    updatedAt: Date.now()
  });
}

export function getCurrentActivity(blueprint, state) {
  const normalizedBlueprint = normalizeLessonBlueprint(blueprint);
  if (!normalizedBlueprint) {
    return null;
  }
  const normalizedState = normalizeActivityState(state, normalizedBlueprint);
  return normalizedBlueprint.activities[normalizedState.activityIndex] || null;
}

export function buildTutorV2RealtimeInstructions({ profile = {}, blueprint, state, preferences = {} } = {}) {
  const normalizedProfile = normalizeSpeakingProfile(profile);
  const normalizedBlueprint = normalizeLessonBlueprint(blueprint);
  const normalizedState = normalizeActivityState(state, normalizedBlueprint);
  const activity = getCurrentActivity(normalizedBlueprint, normalizedState);
  const isDiagnostic = isDiagnosticBlueprint(normalizedBlueprint);
  const targetSkills = (activity?.targetSkillIds || [])
    .map((id) => SKILL_BY_ID.get(id))
    .filter(Boolean)
    .map((entry) => `${entry.title}: ${entry.objective}`);
  const pendingRepair = normalizedState.repairRequired && normalizedState.pendingCorrection
    ? `The learner must retry this correction before advancing: ${normalizedState.pendingCorrection}`
    : 'No repair is currently pending.';
  return [
    '# Role and objective',
    'You are a focused Japanese speaking coach. Maximize useful learner speech and help the learner complete the current communicative task.',
    '',
    '# Current activity',
    `Phase: ${activity?.phase || 'briefing'}`,
    `Goal: ${activity?.goal || normalizedBlueprint?.mission.objective || 'Sustain a short exchange.'}`,
    `Instructions: ${activity?.instructions || 'Ask one short Japanese question.'}`,
    `Difficulty: ${activity?.difficultyLevel || normalizedBlueprint?.mission.level || 'A1'}`,
    `Exit criteria: ${JSON.stringify(activity?.exitCriteria || {})}`,
    `Targets: ${targetSkills.join(' | ') || 'general speaking practice'}`,
    pendingRepair,
    '',
    '# Learner',
    `Speaking profile: ${JSON.stringify(normalizedProfile)}`,
    `Vocabulary ceiling: ${normalizedProfile.contentCeiling}`,
    ...(isDiagnostic ? [
      '',
      '# Diagnostic pacing',
      'This baseline always starts with very simple A1/N5 Japanese, regardless of the saved profile.',
      'Use only the current activity difficulty. Never jump to a harder task on your own; the lesson director controls progression.',
      normalizedState.attemptCount > 0
        ? 'The learner has not yet cleared this activity. Repeat it with shorter vocabulary, slower delivery, and one concrete example.'
        : 'Give only the current prompt. Do not preview later or harder tasks.',
      'Collect a sample without correcting or requiring a retry during the diagnostic.'
    ] : []),
    '',
    '# Language',
    'This product practices spoken Japanese only. Japanese is the practice language for every learner response.',
    'Never ask the learner to speak English, translate into English, repeat an English phrase, introduce themselves in English, or choose an English-practice scenario.',
    'English is explanation-only: if the learner explicitly asks for an explanation in English, give at most one brief English sentence, then immediately ask for a short Japanese response.',
    'English input is never permission to begin English practice. Do not praise or score English production as completion of the Japanese speaking target.',
    'Treat 日本語で話したい and equivalent requests as instructions to continue practicing Japanese, never as a topic about English.',
    'Do not switch language because of accent, filler sounds, names, or one borrowed word. If audio is unclear, ask one short clarification instead of guessing.',
    '',
    '# Turn behavior',
    'Use one instructional move and exactly one question per turn. Use at most two short sentences unless the learner explicitly asks for an explanation.',
    'Do not lecture, list multiple corrections, complete the task for the learner, or praise vaguely.',
    'Correct at most one issue, and only when it blocks meaning, misses the target, or is backed by high-confidence evidence.',
    'When repair is pending, ask for the retry directly and do not introduce a new topic.',
    '',
    '# Delivery',
    `Preferred speech rate: ${cleanNumber(preferences.speechRate, 1, 0.25, 1.5).toFixed(2)}x.`,
    'Keep articulation natural and clear. Avoid background sounds, singing, or sound effects.'
  ].join('\n');
}

export function migrateLegacyTutorData({ profile = {}, sessions = [] } = {}) {
  const speakingProfile = normalizeSpeakingProfile({}, profile);
  const legacySessions = Array.isArray(sessions) ? sessions.map((session) => ({
    ...session,
    schemaVersion: 1,
    legacy: true
  })) : [];
  return {
    schemaVersion: TUTOR_V2_SCHEMA_VERSION,
    speakingProfile,
    mastery: {},
    reviewItems: [],
    legacySessions
  };
}

export const TUTOR_TURN_ASSESSMENT_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'languageSpans', 'understood', 'taskCompleted', 'taskScore', 'dimensions',
    'targetSkillIds', 'grammarFindings', 'vocabularyFindings', 'fillers',
    'correction', 'repairSuccessful', 'notes'
  ],
  properties: {
    languageSpans: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['language', 'text', 'confidence'],
        properties: {
          language: { type: 'string', enum: ['ja', 'en'] },
          text: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    },
    understood: { type: 'boolean' },
    taskCompleted: { type: 'boolean' },
    taskScore: { type: 'number', minimum: 0, maximum: 1 },
    dimensions: {
      type: 'object',
      additionalProperties: false,
      required: TUTOR_SPEAKING_DIMENSIONS,
      properties: Object.fromEntries(TUTOR_SPEAKING_DIMENSIONS.map((dimension) => [dimension, {
        type: 'number', minimum: 0, maximum: 1
      }]))
    },
    targetSkillIds: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    grammarFindings: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    vocabularyFindings: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    fillers: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    correction: {
      type: 'object',
      additionalProperties: false,
      required: ['required', 'confidence', 'category', 'original', 'corrected', 'explanation', 'requiresRepair'],
      properties: {
        required: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        category: { type: 'string' },
        original: { type: 'string' },
        corrected: { type: 'string' },
        explanation: { type: 'string' },
        requiresRepair: { type: 'boolean' }
      }
    },
    repairSuccessful: { type: 'boolean' },
    notes: { type: 'array', items: { type: 'string' }, maxItems: 8 }
  }
});

export const TUTOR_SESSION_OUTCOME_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'wins', 'priorityWeakness', 'nextMission', 'dimensionSignals'],
  properties: {
    overview: { type: 'string' },
    wins: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    priorityWeakness: { type: 'string' },
    nextMission: { type: 'string' },
    dimensionSignals: {
      type: 'object',
      additionalProperties: false,
      required: TUTOR_SPEAKING_DIMENSIONS,
      properties: Object.fromEntries(TUTOR_SPEAKING_DIMENSIONS.map((dimension) => [dimension, {
        type: 'number', minimum: 0, maximum: 1
      }]))
    }
  }
});
