import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTutorAudioMetrics,
  estimateTutorSpeechUnits
} from '../src/tutor-audio-metrics.js';

test('speech units recognize Japanese mora-like characters and English words', () => {
  assert.equal(estimateTutorSpeechUnits('きょうは coffee を飲みます'), 9);
  assert.equal(estimateTutorSpeechUnits('I like green tea'), 4);
});

test('audio metrics measure internal pauses and speech rate deterministically', () => {
  const sampleRate = 1000;
  const samples = new Float32Array(3000);
  for (let index = 0; index < 1000; index += 1) samples[index] = 0.2;
  for (let index = 2000; index < 3000; index += 1) samples[index] = 0.2;
  const metrics = calculateTutorAudioMetrics({
    samples,
    sampleRate,
    transcript: 'one two three four five six'
  });
  assert.equal(metrics.durationMs, 3000);
  assert.ok(metrics.pauseRatio > 0.3 && metrics.pauseRatio < 0.36);
  assert.equal(metrics.speechRate, 120);
  assert.equal(metrics.source, 'browser_audio');
});

test('duration-only metrics remain available when audio decoding is unsupported', () => {
  const metrics = calculateTutorAudioMetrics({
    durationMs: 2000,
    transcript: '日本語'
  });
  assert.equal(metrics.durationMs, 2000);
  assert.equal(metrics.pauseRatio, 0);
  assert.equal(metrics.speechRate, 90);
  assert.equal(metrics.source, 'duration_only');
});
