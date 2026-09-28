import { buildLearningPlan, learningMetrics, recordLessonPerformance, createReviewAttempt } from '../src/tutor-learning-plan.js';

export function createTutorLearningStore({ query, execute, quote }) {
  const json = value => quote(JSON.stringify(value));
  const parse = row => JSON.parse(row.payload);
  function schema() {
    return `
      CREATE TABLE IF NOT EXISTS user_tutor_learning_evidence (
        user_id TEXT NOT NULL, session_id TEXT NOT NULL, evidence_id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(user_id, session_id, evidence_id));
      CREATE TABLE IF NOT EXISTS user_tutor_review_attempts (
        user_id TEXT NOT NULL, session_id TEXT NOT NULL, attempt_id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(user_id, attempt_id));
      CREATE TABLE IF NOT EXISTS user_tutor_learning_plans (
        user_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_tutor_reassessments (
        user_id TEXT NOT NULL, session_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(user_id, session_id, revision));
      INSERT OR IGNORE INTO schema_migrations VALUES ('tutor_v2_006_learning_plan', ${Date.now()});`;
  }
  const evidenceSql = (userId, evidence) => `INSERT OR REPLACE INTO user_tutor_learning_evidence VALUES
    (${quote(userId)},${quote(evidence.sessionId)},${quote(evidence.id)},${json(evidence)});`;
  const planSql = (userId, plan) => `INSERT OR REPLACE INTO user_tutor_learning_plans VALUES (${quote(userId)},${json(plan)});`;
  const auditSql = (userId, sessionId, audit) => `INSERT OR REPLACE INTO user_tutor_reassessments VALUES
    (${quote(userId)},${quote(sessionId)},${audit.revision},${json(audit)});`;
  async function read(userId) {
    const evidence = (await query(`SELECT payload FROM user_tutor_learning_evidence WHERE user_id=${quote(userId)};`)).map(parse);
    const reviews = (await query(`SELECT payload FROM user_tutor_review_attempts WHERE user_id=${quote(userId)};`)).map(parse);
    const plans = await query(`SELECT payload FROM user_tutor_learning_plans WHERE user_id=${quote(userId)};`);
    const supportNeeds = [];
    const sessions = (await query(`SELECT session_id,started_at,ended_at,activity_state FROM user_tutor_sessions_v2 WHERE user_id=${quote(userId)};`))
      .map(row => { const diagnostic = JSON.parse(row.activity_state).diagnostic;
        supportNeeds.push(...(diagnostic?.supportNeeds || []).map(s => ({ ...s, sessionId: row.session_id })));
        return { id: row.session_id, startedAt: row.started_at,
          activeMs: diagnostic ? diagnostic.elapsedMs || 0 : row.ended_at ? Math.max(0, row.ended_at - row.started_at) : 0 }; });
    return { evidence, reviews, sessions, supportNeeds, plan: plans.length ? parse(plans[0]) : null,
      metrics: learningMetrics({ evidence, reviews, sessions }) };
  }
  async function record(userId, evidence, { reviewItems = [], lessonId = '' } = {}) {
    if (evidence.validity !== 'valid') return;
    const data = await read(userId);
    if (data.evidence.some(e => e.id === evidence.id && e.sessionId === evidence.sessionId)) return;
    const learnedAt = data.evidence.filter(e => e.skillId === evidence.skillId && e.outcome === 'independent')
      .reduce((oldest, e) => Math.min(oldest, e.createdAt), Infinity);
    const review = createReviewAttempt({ evidence, reviewItems, learnedAt: Number.isFinite(learnedAt) ? learnedAt : null });
    const plan = recordLessonPerformance(data.plan, lessonId, evidence);
    await execute(`BEGIN;${evidenceSql(userId, evidence)}${review ? `INSERT OR IGNORE INTO user_tutor_review_attempts VALUES
      (${quote(userId)},${quote(evidence.sessionId)},${quote(review.id)},${json(review)});` : ''}
      ${plan ? planSql(userId, plan) : ''}COMMIT;`);
  }
  async function refresh(userId, options) {
    const data = await read(userId);
    const plan = buildLearningPlan({ ...options, supportNeeds: data.supportNeeds, previous: data.plan, evidence: data.evidence });
    try { await execute(planSql(userId, plan)); }
    catch (error) { error.previousPlan = data.plan; throw error; }
    return plan;
  }
  async function audit(userId, sessionId) {
    const rows = await query(`SELECT payload FROM user_tutor_reassessments WHERE user_id=${quote(userId)}
      AND session_id=${quote(sessionId)} ORDER BY revision DESC LIMIT 1;`);
    return rows.length ? parse(rows[0]) : null;
  }
  function deleteSql(userId, sessionId = null) {
    return ['user_tutor_learning_evidence', 'user_tutor_review_attempts', 'user_tutor_reassessments']
      .map(table => `DELETE FROM ${table} WHERE user_id=${quote(userId)}${sessionId ? ` AND session_id=${quote(sessionId)}` : ''};`).join('\n')
      + (sessionId ? '' : `DELETE FROM user_tutor_learning_plans WHERE user_id=${quote(userId)};`);
  }
  return { schema, read, record, refresh, audit, evidenceSql, planSql, auditSql, deleteSql };
}
