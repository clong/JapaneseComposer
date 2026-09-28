import { TUTOR_SKILL_GRAPH } from './tutor-v2.js';

const DAY = 86400000;
const answerKey = e => `${e.sessionId}:${e.turnId}:${e.answerRevision || 0}`;
const key = e => `${answerKey(e)}:${e.skillId}`;
export const validLearningEvidence = evidence => [...new Map(evidence.filter(e => e.validity === 'valid'
  && ['independent', 'supported', 'not_yet_demonstrated'].includes(e.outcome)).map(e => [key(e), e])).values()];

export function learningMetrics({ evidence = [], sessions = [], reviews = [], now = Date.now() } = {}) {
  const valid = [...new Map(evidence.filter(e => e.validity === 'valid'
    && (['independent', 'supported', 'not_yet_demonstrated'].includes(e.outcome) || (e.outcome === 'uncertain' && e.scorable)))
    .map(e => [key(e), e])).values()];
  const summarize = rows => {
    const answers = [...new Set(rows.map(answerKey))].map(id => rows.filter(e => answerKey(e) === id));
    const independent = answers.filter(group => group.every(e => e.outcome === 'independent')).length;
    return { attempts: answers.length, independent, supported: answers.filter(group => group.some(e => e.outcome === 'supported')).length,
      independentRate: answers.length ? independent / answers.length : null };
  };
  const level = e => typeof e.band === 'number' ? ['A1', 'A2', 'B1', 'B2'][e.band] : e.band;
  const comparable = [...new Set(valid.map(e => `${e.skillId}:${level(e)}`))].map(id => {
    const rows = valid.filter(e => `${e.skillId}:${level(e)}` === id);
    return { skillId: rows[0].skillId, band: level(rows[0]), ...summarize(rows),
      recent: summarize(rows.filter(e => e.createdAt >= now - 7 * DAY)),
      previous: summarize(rows.filter(e => e.createdAt >= now - 14 * DAY && e.createdAt < now - 7 * DAY)) };
  });
  const retrieval = reviews.filter(r => r.scheduled && r.independent && r.learnedAt != null
    && r.attemptedAt - r.learnedAt >= 7 * DAY);
  const weekly = Array.from({ length: 8 }, (_, index) => {
    const start = now - (8 - index) * 7 * DAY; const end = start + 7 * DAY;
    const rows = valid.filter(e => e.createdAt >= start && e.createdAt < end);
    return { startedAt: start, endedAt: end, ...summarize(rows),
      activeMinutes: sessions.filter(s => s.startedAt >= start && s.startedAt < end).reduce((n, s) => n + (s.activeMs || 0), 0) / 60000 };
  });
  return { ...summarize(valid), activeMinutes: sessions.reduce((n, s) => n + (s.activeMs || 0), 0) / 60000,
    skillsDemonstrated: new Set(valid.filter(e => e.outcome === 'independent').map(e => e.skillId)).size,
    skillsNeedingPractice: new Set(valid.filter(e => ['supported', 'not_yet_demonstrated'].includes(e.outcome)).map(e => e.skillId)).size,
    completedReviews: reviews.filter(r => r.scheduled).length,
    sevenDayRetention: { attempts: retrieval.length, successes: retrieval.filter(r => r.success).length,
      rate: retrieval.length >= 3 ? retrieval.filter(r => r.success).length / retrieval.length : null }, comparable, weekly };
}

export function buildLearningPlan({ evidence = [], supportNeeds = [], mastery = {}, preferences = {}, previous = null,
  sourceSessionId = '', now = Date.now() } = {}) {
  const valid = validLearningEvidence(evidence);
  const demonstrated = new Set(valid.filter(e => e.outcome === 'independent').map(e => e.skillId));
  const performances = lesson => valid.filter(e => e.skillId === lesson.primarySkillId && e.outcome === 'independent'
    && (lesson.performanceEvidenceIds || []).includes(e.id));
  const promptKey = e => String(e.prompt || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const completed = (previous?.lessons || []).filter(l => l.status === 'completed'
    && new Set(performances(l).map(promptKey).filter(Boolean)).size >= 2);
  const inProgress = new Set((previous?.lessons || []).filter(l => !completed.includes(l) && performances(l).length)
    .map(l => l.primarySkillId));
  // Only the validated ledger can establish readiness; legacy model scores are not evidence.
  const ready = skill => skill.prerequisites.every(id => demonstrated.has(id));
  const needs = new Set([...valid.filter(e => e.outcome !== 'independent').map(e => e.skillId), ...supportNeeds.map(s => s.skillId)]);
  const candidates = TUTOR_SKILL_GRAPH.filter(s => s.type !== 'pronunciation' && !s.tags.includes('fluency')
    && !completed.some(l => l.primarySkillId === s.id))
    .sort((a, b) => Number(needs.has(b.id)) - Number(needs.has(a.id))
      || Number(inProgress.has(b.id)) - Number(inProgress.has(a.id))
      || Number(demonstrated.has(a.id)) - Number(demonstrated.has(b.id)) || a.level.localeCompare(b.level));
  const selected = []; const planned = new Set(demonstrated);
  while (selected.length < 5) {
    const next = candidates.find(s => !selected.includes(s) && s.prerequisites.every(id => planned.has(id)));
    if (!next) break;
    selected.push(next); planned.add(next.id);
  }
  const lessons = selected.map(skill => {
    const prior = previous?.lessons?.find(l => l.primarySkillId === skill.id && !completed.includes(l));
    const references = valid.filter(e => e.skillId === skill.id).map(e => e.id);
    const support = supportNeeds.filter(s => s.skillId === skill.id);
    return { id: prior?.id || `lesson_${skill.id}_${now}`, primarySkillId: skill.id, supportingSkillIds: skill.prerequisites,
      title: skill.title, objective: skill.objective, level: skill.level,
      scenario: skill.type === 'listening' ? 'Listen to a short message about a meal or meeting, then identify its details.'
        : skill.tags.includes('grammar') || skill.type === 'grammar' ? 'Describe meals, places, and recent everyday activities.'
          : 'Talk about yourself and arrange a meal with a Japanese-speaking partner.',
      reason: needs.has(skill.id) ? support.length ? `You asked for help with ${support.map(s => s.phrase).slice(-2).join('; ')}.` : 'You needed support on this target.'
        : demonstrated.has(skill.id) ? 'You demonstrated this target; practice it in a different situation.' : 'This target has not been assessed reliably yet.',
      evidenceIds: references, supportReferences: support.map(s => ({ sessionId: s.sessionId || sourceSessionId, turnId: s.turnId })),
      status: ready(skill) ? 'ready' : 'locked', prerequisites: skill.prerequisites,
      durationMinutes: preferences.durationMinutes || 12,
      criteria: { independentDistinctAttempts: 2 }, independentProbeKeys: prior ? [...new Set(performances(prior).map(promptKey).filter(Boolean))] : [],
      performanceEvidenceIds: prior ? performances(prior).map(e => e.id) : [],
      sourceSessionId };
  });
  return { version: 1, id: previous?.id || `plan_${now}`, revision: (previous?.revision || 0) + 1,
    status: 'ready', sourceSessionId, lessons: [...completed, ...lessons], updatedAt: now };
}

export function recordLessonPerformance(plan, lessonId, evidence) {
  if (!Array.isArray(plan?.lessons) || evidence.validity !== 'valid' || evidence.outcome !== 'independent') return plan;
  return { ...plan, lessons: plan.lessons.map(lesson => {
    if (lesson.id !== lessonId || lesson.primarySkillId !== evidence.skillId) return lesson;
    const probeKey = String(evidence.prompt || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const keys = [...new Set([...lesson.independentProbeKeys, probeKey].filter(Boolean))];
    return { ...lesson, independentProbeKeys: keys, evidenceIds: [...new Set([...lesson.evidenceIds, evidence.id])],
      performanceEvidenceIds: [...new Set([...(lesson.performanceEvidenceIds || []), evidence.id])],
      status: keys.length >= 2 ? 'completed' : 'ready' };
  }) };
}

export function createReviewAttempt({ evidence, reviewItems, learnedAt }) {
  const review = reviewItems.find(r => r.skillId === evidence.skillId && r.dueAt <= evidence.createdAt);
  if (!review) return null;
  return { id: `retrieval_${evidence.id}`, sessionId: evidence.sessionId, turnId: evidence.turnId,
    skillId: evidence.skillId, scheduled: true, dueAt: review.dueAt, learnedAt: learnedAt ?? null,
    attemptedAt: evidence.createdAt, independent: evidence.outcome !== 'supported', success: evidence.outcome === 'independent' };
}
