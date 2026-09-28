import { cleanTutorCaption, learnerIntentOverride, validateSpokenProbe } from '../src/tutor-probes.js';
import { diagnosticReport } from '../src/tutor-diagnostic.js';

const canonical = text => cleanTutorCaption(text).replace(/\s/g, '');
export function reconstructExchanges(turns) {
  const exchanges = []; let prompt = '';
  for (const turn of turns) {
    const text = cleanTutorCaption(turn.transcript);
    if (!text) continue;
    if (turn.role === 'assistant') { prompt = exchanges.at(-1)?.sealed === false ? text : `${prompt}${text}`; if (exchanges.length) exchanges.at(-1).sealed = true; continue; }
    let current = exchanges.at(-1);
    if (!current || current.sealed) {
      current = { prompt, answer: '', rowIds: [], turnId: `reassess_${turn.turnId || turn.id}`, createdAt: turn.startedAt, sealed: false };
      exchanges.push(current); prompt = '';
    }
    current.answer += text; current.rowIds.push(turn.turnId || turn.id);
  }
  return exchanges;
}

export async function reassessDiagnostic({ diagnostic, turns, assess, sessionId, onProgress = () => {} }) {
  const exchanges = reconstructExchanges(turns);
  const ended = diagnostic.status === 'completed' || diagnostic.elapsedMs >= 600000;
  const revised = { ...structuredClone(diagnostic), version: 2, evidence: [], exchanges: [], supportNeeds: [],
    status: ended ? 'completed' : 'paused', resumedAt: null,
    completionReason: ended ? 'time_limit_partial' : 'stopped_early' };
  const decisions = [];
  const assistanceByQuestion = new Map();
  for (const [index, exchange] of exchanges.entries()) {
    const old = diagnostic.evidence.find(e => canonical(e.prompt) === canonical(exchange.prompt))
      || diagnostic.evidence.find(e => canonical(e.answer) === canonical(exchange.answer));
    const result = await assess({ question: { domain: old?.domain || '', skillId: old?.skillId || '',
      contract: old?.contract || null, spokenText: exchange.prompt, task: 'Audit the actual spoken prompt; do not invent missing facts.' },
      transcript: exchange.answer, recentTurns: exchanges.slice(Math.max(0, index - 4), index), retrospective: true });
    const intent = learnerIntentOverride(exchange.answer, exchange.prompt) || result.intent;
    const contractCheck = old?.contract ? validateSpokenProbe({ id: old.questionId, contract: old.contract }, exchange.prompt) : null;
    const validity = result.probeValid === false || contractCheck?.validity === 'invalid' ? 'invalid'
      : old && result.confidence >= 0.8 ? 'valid' : 'uncertain';
    const entry = { ...exchange, intent, validity, invalidReason: contractCheck?.reason || result.invalidReason || '', answerRevision: 1,
      questionId: old?.questionId || `audit_q${index}`, domain: old?.domain || '', skillId: old?.skillId || '', band: old?.band || 0 };
    entry.contract = old?.contract || null;
    revised.exchanges.push(entry);
    if (intent === 'clarification' && validity !== 'invalid') {
      assistanceByQuestion.set(entry.questionId, result.assistanceSubject);
      revised.supportNeeds.push({ subject: result.assistanceSubject,
        phrase: result.supportPhrase || exchange.answer, skillId: result.assistanceSubject === 'vocabulary' ? 'a1.core-vocabulary' : old?.skillId,
        questionId: entry.questionId, turnId: exchange.turnId, createdAt: exchange.createdAt });
    }
    if (validity === 'valid' && intent === 'answer' && result.complete && result.confidence >= 0.8) {
      const assisted = (result.assistance || (old.assistance && old.assistance !== 'none'))
        && ((result.assistanceSubject !== 'vocabulary' && assistanceByQuestion.get(entry.questionId) !== 'vocabulary') || old.domain === 'vocabulary');
      revised.evidence.push({ ...old, version: 2, id: `${sessionId}:${exchange.turnId}`, sessionId,
        turnId: exchange.turnId, answerRevision: 1, prompt: exchange.prompt, answer: exchange.answer, validity,
        outcome: result.success ? assisted ? 'supported' : 'independent' : 'not_yet_demonstrated',
        observations: result.observation, confidence: result.confidence, createdAt: exchange.createdAt });
    }
    decisions.push({ turnId: exchange.turnId, intent, validity, reason: entry.invalidReason || result.observation });
    await onProgress(index + 1, exchanges.length);
  }
  const report = diagnosticReport(revised);
  if (report.coverage === 1 && revised.elapsedMs >= 480000) {
    revised.status = 'completed'; revised.completionReason = 'sufficient_coverage';
  }
  return { diagnostic: revised, decisions };
}
