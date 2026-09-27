import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createTutorDiagnosticDirector } from './tutor-diagnostic-director.js';
import { createTutorLiveGreeting } from './tutor-live-server.js';
import { createTutorLiveSessionConfig, tutorLiveActivityContext } from '../src/tutor-live.js';
import { buildDiagnosticBlueprint, createInitialActivityState } from '../src/tutor-v2.js';
import { DIAGNOSTIC_ASSESSMENT_SCHEMA, DIAGNOSTIC_ASSESSMENT_INSTRUCTIONS, recordDiagnosticResult,
  diagnosticReply, validateDiagnosticDecision } from '../src/tutor-diagnostic.js';

// Opt-in billable test with synthetic Japanese speech, not a microphone or personal recordings.
if (process.env.TUTOR_DIAGNOSTIC_LIVE !== '1') throw new Error('Set TUTOR_DIAGNOSTIC_LIVE=1 to run the billable speech test.');
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('Load data/local.env through the runtime.');
const directory = await mkdtemp(path.join(tmpdir(), 'baseline-speech-'));
const safe = value => String(value).replaceAll(apiKey, '[redacted]');
const blueprint = buildDiagnosticBlueprint({});
const activityState = createInitialActivityState(blueprint);
const options = { blueprint, activityState };
const config = createTutorLiveSessionConfig(options);
config.audio.format = { type: 'audio/pcm', rate: 24000 };
const clips = [];
for (const [index, text] of ['クリスです。', 'カリフォルニアに住んでいます。',
  'すみません。もう一度、ゆっくりお願いします。', 'お名前は何ですか？', 'すしが好きです。'].entries()) {
  const file = path.join(directory, `${index}.wav`);
  execFileSync('/usr/bin/say', ['-v', 'Kyoko', '-r', '140', '-o', file, '--file-format=WAVE', '--data-format=LEI16@24000', text], { stdio: 'ignore' });
  const wav = await readFile(file);
  let offset = 12;
  while (wav.toString('ascii', offset, offset + 4) !== 'data') offset += 8 + wav.readUInt32LE(offset + 4) + (wav.readUInt32LE(offset + 4) % 2);
  clips.push(wav.subarray(offset + 8, offset + 8 + wav.readUInt32LE(offset + 4)));
}
const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${apiKey}` } });
let activeClip = null; let clipOffset = 0; let audioTimer; let started = false; let closed = false;
let lastQuestionAt = 0;
let assistantAt = 0; let assistantCaptionCount = 0; let spokenSamples = 0; let failure = '';
const assessments = []; const traces = [];
let step = 0;
const send = event => { if (ws.readyState !== 1) return false; ws.send(JSON.stringify(event)); return true; };
const director = createTutorDiagnosticDirector({ send,
  question: () => activityState.diagnostic.pendingQuestion, context: () => tutorLiveActivityContext(options),
  persistRow: async () => {}, persistFragment: async () => {}, status() {}, usage() {},
  trace: event => traces.push(event), logError: error => { failure = safe(error.message); },
  onQuestion: (transcript, rowId) => {
    if (/[?？]|ですか|ますか|ください|してみて|質問|どうぞ/.test(transcript)) {
      lastQuestionAt = Date.now();
      const q = activityState.diagnostic.pendingQuestion;
      if (!q.spokenText || q.spokenRowId === rowId) { q.spokenText = transcript; q.spokenRowId = rowId; }
    }
  },
  assess: async turn => {
    const question = { ...activityState.diagnostic.pendingQuestion };
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_TUTOR_REASONING_MODEL || 'gpt-5.6', reasoning: { effort: 'low' },
        max_output_tokens: 500, instructions: DIAGNOSTIC_ASSESSMENT_INSTRUCTIONS,
        input: JSON.stringify({ question, transcript: turn.transcript }),
        text: { format: { type: 'json_schema', name: 'diagnostic', strict: true, schema: DIAGNOSTIC_ASSESSMENT_SCHEMA } } }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(safe(payload.error?.message || 'Assessment failed'));
    const result = validateDiagnosticDecision(JSON.parse(payload.output.flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('')));
    if (!turn.isCurrent()) return null;
    activityState.diagnostic = recordDiagnosticResult(activityState.diagnostic, result, turn);
    assessments.push({ transcript: turn.transcript, intent: result.intent, evidence: activityState.diagnostic.evidence.length });
    return { ...result, speak: diagnosticReply(activityState.diagnostic, result, question) };
  }
});
const greeting = createTutorLiveGreeting(send, 'diagnostic_smoke_greeting');
ws.on('open', () => send({ type: 'session.start', session: config }));
ws.on('message', message => {
  const event = JSON.parse(String(message));
  director.handle(event); greeting.handle(event);
  if (event.type === 'session.started') {
    started = true; greeting.start();
    audioTimer = setInterval(() => {
      const pcm = activeClip ? activeClip.subarray(clipOffset, clipOffset + 960) : Buffer.alloc(960);
      if (activeClip) { clipOffset += 960; if (clipOffset >= activeClip.length) activeClip = null; }
      const input = { type: 'session.input_audio.append', audio: pcm.toString('base64') };
      send(input); director.handle(input);
    }, 20);
  }
  if (event.type === 'session.output_transcript.delta') { assistantAt = Date.now(); assistantCaptionCount += 1; }
  if (event.type === 'session.output_audio.delta') {
    const bytes = Buffer.from(event.delta, 'base64');
    for (let i = 0; i + 1 < bytes.length; i += 2) if (Math.abs(bytes.readInt16LE(i)) > 700) spokenSamples += 1;
  }
  if (event.type === 'error') failure = safe(event.error?.message);
  if (event.type === 'session.closed') { closed = true; clearInterval(audioTimer); ws.close(); }
});
ws.on('error', error => { failure = safe(error.message); });
const waitFor = async (predicate, timeout = 25000) => {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (failure) throw new Error(failure);
    if (Date.now() > until) throw new Error('Timed out waiting for the next spoken turn.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
try {
  await waitFor(() => started && assistantCaptionCount > 0 && Date.now() - assistantAt > 1600);
  for (const clip of clips) {
    step += 1;
    const prior = assessments.length; const startedAt = Date.now();
    activeClip = clip; clipOffset = 0;
    await waitFor(() => !activeClip && assessments.length > prior && Date.now() - assistantAt > 1800
      && assistantAt > startedAt + clip.length / 48
      && lastQuestionAt > startedAt + clip.length / 48);
  }
  assert.equal(assessments.length, 5, 'Each completed learner utterance is assessed exactly once.');
  assert.equal(activityState.diagnostic.evidence.length, 4, 'The repeat request must not become mastery evidence.');
  assert.ok(spokenSamples > 2400);
  const assistant = director.transcript.rows.filter(r => r.role === 'assistant').map(r => r.transcript).join('\n');
  assert.doesNotMatch(assistant, /確認します|チェックします|答えを評価|checking your answer/i);
  assert.doesNotMatch(assistant, /私はクリス|私の名前はクリス|いいですね|よくできました/);
  const rows = director.transcript.rows;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].role !== 'user') continue;
    const replies = [];
    for (let j = i + 1; j < rows.length && rows[j].role === 'assistant'; j += 1) replies.push(rows[j].transcript);
    assert.ok(replies.filter(reply => /[?？]|ですか|ますか|ください|してみて|質問|どうぞ/.test(reply)).length <= 1, 'Only one practice question may follow an answer.');
  }
  console.log(JSON.stringify({ assessments, transcript: director.transcript.rows.map(r => ({ role: r.role, text: r.transcript })),
    latenciesMs: traces.filter(t => t.type === 'director.first_audio').map(t => Number(t.detail)), spokenSamples }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ step, error: safe(error.message), assessments,
    transcript: director.transcript.rows.map(r => ({ role: r.role, text: r.transcript })), traces: traces.slice(-30) }, null, 2));
  throw error;
} finally {
  await director.close(8000); clearInterval(audioTimer); director.cancel(); ws.terminate();
  await rm(directory, { recursive: true, force: true });
}
assert.equal(closed, true, 'Session must finalize usage.');
