import assert from 'node:assert/strict';
import { DIAGNOSTIC_ASSESSMENT_SCHEMA, DIAGNOSTIC_ASSESSMENT_INSTRUCTIONS, validateDiagnosticDecision } from '../src/tutor-diagnostic.js';

// Opt-in, billable rubric/latency comparison. Never logs credentials or environment values.
if (process.env.TUTOR_DIAGNOSTIC_LIVE !== '1' || !process.env.OPENAI_API_KEY) throw new Error('Load data/local.env and opt in with TUTOR_DIAGNOSTIC_LIVE=1.');
const cases = [
  { task: 'Ask the learner their name. Accept a name alone.', transcript: 'クリスです', intent: 'answer', success: true },
  { task: 'Ask where the learner lives.', transcript: 'なんで少しだけ確認しましたか', intent: 'off_topic' },
  { task: 'Ask where the learner is from.', transcript: 'クリスと申します。出身は', intent: 'incomplete' },
  { task: 'Ask where the learner is from.', transcript: 'クリスと申します。出身はカリフォルニアです', intent: 'answer', success: true },
  { task: 'Ask the learner to ask you one simple question.', transcript: 'お名前は何ですか', intent: 'answer', success: true },
  { task: 'Ask for a favorite food.', transcript: 'すみません。もう一度お願いします', intent: 'clarification' }
];
let failed = false;
for (const model of ['gpt-5.6', 'gpt-6-luna']) {
  const results = [];
  for (const example of cases) {
    const start = Date.now();
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, reasoning: { effort: 'low' }, max_output_tokens: 500,
        instructions: DIAGNOSTIC_ASSESSMENT_INSTRUCTIONS,
        input: JSON.stringify({ question: { task: example.task, assistance: 'none' }, transcript: example.transcript }),
        text: { format: { type: 'json_schema', name: 'diagnostic', strict: true, schema: DIAGNOSTIC_ASSESSMENT_SCHEMA } } }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(String(payload.error?.message || response.status).replaceAll(process.env.OPENAI_API_KEY, '[redacted]'));
    const result = validateDiagnosticDecision(JSON.parse(payload.output.flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('')));
    const correct = result.intent === example.intent || (example.intent === 'incomplete' && !result.complete);
    results.push({ ms: Date.now() - start, ...result, correct: correct && (example.success === undefined || example.success === result.success) });
  }
  console.log(JSON.stringify({ model, results }));
  failed ||= !results.every(r => r.correct);
}
assert.equal(failed, false, 'One or more models failed the small regression corpus.');
