import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createTutorLiveSessionConfig } from '../src/tutor-live.js';
import { createTutorLiveGreeting } from './tutor-live-server.js';
import { buildDiagnosticBlueprint, createInitialActivityState } from '../src/tutor-v2.js';

// Opt-in, billable smoke test. Credentials come only from the process environment.
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('Load the server environment before running this test.');
const blueprint = buildDiagnosticBlueprint({});
const session = createTutorLiveSessionConfig({ blueprint, activityState: createInitialActivityState(blueprint) });
session.audio.format = { type: 'audio/pcm', rate: 24000 };
const ws = new WebSocket('wss://api.openai.com/v1/live/sessions', {
  headers: { Authorization: `Bearer ${apiKey}` }
});
let audioBytes = 0;
let speechSamples = 0;
const events = {};
let transcript = '';
let started = false;
let closing = false;
let finalized = false;
let failure = '';
let audioTimer;
let closeTimer;
let startedAt;
const safeMessage = (message) => String(message || 'Unknown API error').replaceAll(apiKey, '[redacted]');
const send = (event) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(event));
const greeting = createTutorLiveGreeting(send, 'smoke_greeting');
function close() {
  if (closing) return;
  closing = true;
  clearInterval(audioTimer);
  if (started) send({ type: 'session.close' });
  else ws.terminate();
  closeTimer = setTimeout(() => ws.terminate(), 8000);
}
const timeout = setTimeout(() => { failure = 'Timed out waiting for a Japanese greeting'; close(); }, 35000);
ws.on('open', () => send({ type: 'session.start', session }));
ws.on('message', (message) => {
  const event = JSON.parse(String(message));
  events[event.type] = (events[event.type] || 0) + 1;
  greeting.handle(event);
  if (event.type === 'session.started') {
    started = true;
    startedAt = Date.now();
    console.log('GPT-Live session started with the tutor configuration.');
    greeting.start();
    audioTimer = setInterval(() => {
      send({ type: 'session.input_audio.append', audio: Buffer.alloc(960).toString('base64') });
      if (Date.now() - startedAt > 12000 && audioBytes > 48000 && /[\u3040-\u30ff\u4e00-\u9fff]/.test(transcript)) close();
    }, 20);
  }
  if (event.type === 'session.output_audio.delta') {
    const pcm = Buffer.from(event.delta, 'base64');
    audioBytes += pcm.length;
    for (let index = 0; index + 1 < pcm.length; index += 2) {
      if (Math.abs(pcm.readInt16LE(index)) > 500) speechSamples += 1;
    }
  }
  if (event.type === 'session.output_transcript.delta') transcript += event.delta;
  if (event.type === 'session.closed') {
    finalized = true;
    clearTimeout(closeTimer);
    console.log(JSON.stringify({ audioBytes, speechSamples, transcript, finalized, usageSeconds: event.usage?.seconds, events }));
    ws.close();
  }
  if (event.type === 'error') { failure = safeMessage(event.error?.message); close(); }
});
ws.on('error', (error) => { failure = safeMessage(error.message); });
await new Promise((resolve) => ws.on('close', resolve));
clearTimeout(timeout);
clearTimeout(closeTimer);
clearInterval(audioTimer);
assert.equal(failure, '', failure);
assert.equal(started, true, 'Session did not start');
assert.equal(finalized, true, 'Final usage was not confirmed');
assert.ok(audioBytes > 48000, 'No substantial audio output');
assert.ok(speechSamples > 2400, 'Output was silence, not audible speech');
assert.match(transcript, /[\u3040-\u30ff\u4e00-\u9fff]/, 'No Japanese greeting transcript');
