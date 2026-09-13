import { readFile, writeFile } from 'node:fs/promises';
import { Processor } from '../src/vendor/headaudio/processor.mjs';
import { Training } from '../src/vendor/headaudio/training.mjs';
import { Classifier } from '../src/vendor/headaudio/classifier.mjs';
import { TUTOR_VOICES } from '../src/tutor-utils.js';
import { RECORD_OFFSET, RECORD_LEN } from '../src/vendor/headaudio/parameters.mjs';

export function decodeWav(bytes) {
  let rate, channels, bits, pcm;
  for (let at = 12; at + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    if (tag === 'fmt ') { channels = bytes.readUInt16LE(at + 10); rate = bytes.readUInt32LE(at + 12); bits = bytes.readUInt16LE(at + 22); }
    if (tag === 'data') { pcm = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size)); break; }
    at += 8 + size + size % 2;
  }
  if (!pcm || channels !== 1 || bits !== 16) throw new Error('Expected mono PCM16 WAV.');
  const samples = Float32Array.from({ length: Math.floor(pcm.length / 2) }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
  return { rate, samples };
}

export function speechWindows({ samples, rate }, gap = .18) {
  const windows = []; let start = null, last = 0;
  const hop = Math.round(rate * .01);
  for (let i = 0; i < samples.length; i += hop) {
    const frame = samples.subarray(i, i + hop);
    const rms = Math.sqrt(frame.reduce((s, x) => s + x * x, 0) / frame.length);
    if (rms > .015) { if (start === null) start = i / rate; last = (i + frame.length) / rate; }
    else if (start !== null && i / rate - last > gap) { windows.push({ start, end: last }); start = null; }
  }
  if (start !== null) windows.push({ start, end: last });
  return windows.filter((w) => w.end - w.start > .08);
}

export function features(wav) {
  const frames = [];
  const processor = new Processor({ sampleRate: wav.rate, processorOptions: { featureEventsEnabled: true }, parameterData: { silMode: 0 } },
    { port: { postMessage(event) { if (event.event === 'feature') frames.push({ t: event.t, v: event.vector.slice() }); } } });
  for (let at = 0; at < wav.samples.length; at += 128) processor.process(wav.samples.subarray(at, at + 128));
  return frames;
}

const directory = 'scripts/fixtures/tutor-avatar';
const trainer = new Training();
const stockBytes = await readFile('src/vendor/headaudio/model-en-mixed.bin');
const stock = [];
const stockArray = new Uint8Array(stockBytes).buffer;
for (let at = 0; at + RECORD_OFFSET <= stockArray.byteLength; at += RECORD_OFFSET) stock.push(trainer.decodeBinaryRecord(new Float32Array(stockArray, at, RECORD_LEN)));
const prototypes = [], bins = [], report = [];
const pooled = Array.from({length:5},()=>[]);
for (const [index, voice] of TUTOR_VOICES.entries()) {
  const wav = decodeWav(await readFile(`${directory}/${voice}-calibration.wav`));
  const windows = speechWindows(wav), frames = features(wav);
  console.log(voice, 'calibration windows', windows.map((w) => [w.start.toFixed(2), w.end.toFixed(2)]));
  if (windows.length !== 6) throw new Error(`${voice}: expected six calibration segments; manually inspect the recording before training.`);
  const labels = [0, 2, 4, 1, 3];
  for (let k = 0; k < labels.length; k++) {
    const w = windows[k], margin = Math.min(.12, (w.end - w.start) * .2);
    const vs = frames.filter((f) => f.t > w.start + margin && f.t < w.end - margin).map((f) => f.v);
    if (vs.length < 12) throw new Error(`${voice}: vowel ${k + 1} has fewer than twelve interior feature frames.`);
    pooled[k].push(...vs);
    const { mu, sigmaInvLower, bin } = trainer.computePrototype(['a', 'i', 'ɯ', 'e', 'o'][k], 64 + index, labels[k], vs);
    prototypes.push({ phoneme: ['a', 'i', 'ɯ', 'e', 'o'][k], group: 64 + index, viseme: labels[k], mu, sigmaInvLower });
    bins.push(Buffer.from(bin));
  }
  report.push({ voice, calibration: 'five vowel prototypes', windows });
}
for (let k=0;k<5;k++) {
  const phoneme=['a','i','ɯ','e','o'][k], viseme=[0,2,4,1,3][k];
  const {mu,sigmaInvLower,bin}=trainer.computePrototype(phoneme, 80, viseme, pooled[k]);
  prototypes.push({phoneme,group:80,viseme,mu,sigmaInvLower});bins.push(Buffer.from(bin));
}
if (process.argv.includes('--write')) {
  await writeFile('src/vendor/headaudio/model-ja-en.bin', Buffer.concat([stockBytes, ...bins]));
}
for (const row of report) {
  const wav = decodeWav(await readFile(`${directory}/${row.voice}-evaluation.wav`));
  const windows = speechWindows(wav, .09), frames = features(wav);
  const results = [];
  for (const [label, model] of [['stock', stock], ['calibrated', [...stock, ...prototypes]]]) {
    const classifier = new Classifier(); classifier.import({ model });
    const predicted = frames.map((f) => ({ t: f.t, viseme: classifier.predict(f.v).viseme }));
    const first = windows.slice(0, 5);
    const vowels = first.map((w, k) => {
      const target = [0, 2, 4, 1, 3][k], subset = predicted.filter((f) => f.t >= w.start + .04 && f.t < w.end);
      return { target, frames: subset.length, correct: subset.filter((f) => f.viseme === target).length };
    });
    results.push({ model: label, vowels });
  }
  row.evaluation = { windows: windows.slice(0, 6), results };
}
await writeFile(`${directory}/calibration-report.json`, JSON.stringify({ methodology: 'Energy-based alignment of scripted isolated vowels; separate recordings used for evaluation. These scores do not establish phoneme accuracy in connected Japanese speech.', voices: report }, null, 2));
console.log('Japanese prototype count:', prototypes.length);
