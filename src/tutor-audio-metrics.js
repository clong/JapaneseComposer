const JAPANESE_CHARACTER_REGEX = /[\u3005\u3040-\u30ff\u3400-\u9fff\uff66-\uff9d]/g;
const SMALL_KANA_REGEX = /[ゃゅょぁぃぅぇぉャュョァィゥェォ]/g;
const ENGLISH_WORD_REGEX = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

export function estimateTutorSpeechUnits(transcript = '') {
  const text = typeof transcript === 'string' ? transcript : '';
  const japaneseCount = (text.match(JAPANESE_CHARACTER_REGEX) || []).length;
  const smallKanaCount = (text.match(SMALL_KANA_REGEX) || []).length;
  const englishCount = (text.match(ENGLISH_WORD_REGEX) || []).length;
  return Math.max(0, japaneseCount - smallKanaCount) + englishCount;
}

export function calculateTutorAudioMetrics({ samples, sampleRate, durationMs, transcript = '' } = {}) {
  const values = samples instanceof Float32Array ? samples : new Float32Array();
  const safeSampleRate = Math.max(1, Number(sampleRate) || 48000);
  const measuredDurationMs = values.length
    ? Math.round((values.length / safeSampleRate) * 1000)
    : Math.max(0, Math.trunc(Number(durationMs) || 0));
  const windowSize = Math.max(1, Math.round(safeSampleRate * 0.02));
  const levels = [];
  for (let offset = 0; offset < values.length; offset += windowSize) {
    const end = Math.min(values.length, offset + windowSize);
    let sumSquares = 0;
    for (let index = offset; index < end; index += 1) {
      sumSquares += values[index] * values[index];
    }
    levels.push(Math.sqrt(sumSquares / Math.max(1, end - offset)));
  }
  const sorted = levels.slice().sort((a, b) => a - b);
  const noiseFloor = sorted.length ? sorted[Math.floor(sorted.length * 0.2)] : 0;
  const threshold = Math.max(0.008, noiseFloor * 2.8);
  const activeIndexes = levels
    .map((level, index) => level >= threshold ? index : -1)
    .filter((index) => index >= 0);
  let pauseRatio = 0;
  if (activeIndexes.length > 1) {
    const first = activeIndexes[0];
    const last = activeIndexes[activeIndexes.length - 1];
    const span = levels.slice(first, last + 1);
    const silent = span.filter((level) => level < threshold).length;
    pauseRatio = silent / Math.max(1, span.length);
  }
  const units = estimateTutorSpeechUnits(transcript);
  const speechRate = measuredDurationMs > 0
    ? units / (measuredDurationMs / 60000)
    : 0;
  return {
    durationMs: measuredDurationMs,
    speechRate: Number.isFinite(speechRate) ? Math.round(speechRate * 10) / 10 : 0,
    pauseRatio: Math.round(Math.max(0, Math.min(1, pauseRatio)) * 1000) / 1000,
    speechUnits: units,
    source: values.length ? 'browser_audio' : 'duration_only'
  };
}

export async function analyzeTutorAudioBlob(blob, transcript = '', fallbackDurationMs = 0) {
  if (!(blob instanceof Blob) || typeof AudioContext === 'undefined') {
    return calculateTutorAudioMetrics({ durationMs: fallbackDurationMs, transcript });
  }
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = buffer.numberOfChannels > 0
      ? buffer.getChannelData(0)
      : new Float32Array();
    return calculateTutorAudioMetrics({
      samples,
      sampleRate: buffer.sampleRate,
      durationMs: fallbackDurationMs,
      transcript
    });
  } catch (error) {
    return calculateTutorAudioMetrics({ durationMs: fallbackDurationMs, transcript });
  } finally {
    await context.close().catch(() => {});
  }
}

