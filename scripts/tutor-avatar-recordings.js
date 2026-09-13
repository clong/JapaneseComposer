// Explicit, billable authoring operation. Ordinary builds/tests never import this file.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { TUTOR_VOICES } from '../src/tutor-utils.js';

if (!process.argv.includes('--generate')) throw new Error('Pass --generate to create speech assets using the paid speech API.');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY must be supplied through the environment.');
const directory = process.argv.includes('--corpus') ? 'scripts/fixtures/tutor-avatar' : 'src/assets/tutor';
await mkdir(directory, { recursive: true });
const model = 'gpt-4o-mini-tts-2025-12-15';
const preview = 'こんにちは。一緒に日本語を練習しましょう。ゆっくりで大丈夫です。';
const jobs = process.argv.includes('--corpus') ? TUTOR_VOICES.flatMap((voice) => [
  { name: `${voice}-calibration`, voice, input: 'あーー。\n\nいーー。\n\nうーー。\n\nえーー。\n\nおーー。\n\nまーー。', instructions: 'Speak only these six Japanese sounds, in order, each sustained for one second, with one second of complete silence between sounds. No introduction or background sound.' },
  { name: `${voice}-evaluation`, voice, input: 'あ、い、う、え、お。パパもママも、パンを食べます。東京の高校へ行きます。Please repeat the word slowly. Take your time.', instructions: 'Speak like a friendly Japanese language tutor. Separate the initial five Japanese vowels with clear pauses. Speak the Japanese naturally, then the English slowly. No music.' }
]) : [{ name: 'preview-ja', voice: 'marin', input: preview, instructions: 'Speak warm, clear, natural Japanese as a patient adult language tutor. Gentle and unhurried. No music or other sounds.' }];
for (const job of jobs) {
  const filename = `${directory}/${job.name}.wav`;
  try { await access(filename); console.log(`Keeping ${job.name}`); continue; } catch { /* Generate missing assets only. */ }
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, voice: job.voice, input: job.input, instructions: job.instructions, response_format: 'wav' }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error(`Speech generation failed (${response.status}) for ${job.name}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(filename, bytes);
  await writeFile(`${directory}/${job.name}.json`, JSON.stringify({ ...job, model, generated: new Date().toISOString(), synthetic: true }, null, 2));
  console.log(`Created ${job.name}: ${bytes.length} bytes`);
}
