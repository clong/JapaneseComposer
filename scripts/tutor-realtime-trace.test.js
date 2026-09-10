import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTutorRealtimeTraceState,
  reduceTutorRealtimeTrace,
  tutorTraceMetrics
} from '../src/tutor-realtime-trace.js';

function replay(events) {
  return events.reduce(
    (state, [at, event]) => reduceTutorRealtimeTrace(state, event, at),
    createTutorRealtimeTraceState()
  );
}

test('deterministic trace measures complete and interrupted tutor turns', () => {
  const trace = replay([
    [1000, { type: 'response.created' }],
    [1800, { type: 'output_audio_buffer.started' }],
    [2600, { type: 'output_audio_buffer.stopped' }],
    [3000, { type: 'response.done', response: { status: 'completed' } }],
    [3500, { type: 'response.created' }],
    [3900, { type: 'response.done', response: { status: 'incomplete' } }]
  ]);
  const metrics = tutorTraceMetrics(trace);
  assert.equal(metrics.assistantTurns, 2);
  assert.equal(metrics.completedAssistantTurns, 1);
  assert.equal(metrics.interruptedAssistantTurns, 1);
  assert.deepEqual(metrics.firstAudioLatenciesMs, [800]);
});

test('trace measures learner response latency and sideband reconnection', () => {
  const trace = replay([
    [1000, { type: 'sideband.open' }],
    [2000, { type: 'output_audio_buffer.stopped' }],
    [2750, { type: 'input_audio_buffer.speech_started' }],
    [3000, { type: 'sideband.close' }],
    [3500, { type: 'sideband.open' }]
  ]);
  const metrics = tutorTraceMetrics(trace);
  assert.equal(metrics.pendingLearnerResponseLatencyMs, 750);
  assert.equal(metrics.sidebandReconnects, 1);
});

