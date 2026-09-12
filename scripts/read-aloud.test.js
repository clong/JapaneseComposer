import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseReadingArticles } from './reading-source.js';
import { articleHtml } from './reading-fixtures.js';
import { createReadingSession, validateSession, validateArticle } from '../src/reading-model.js';
import { alignSpeech, normalizeSpeech, LiveTranscript, liveSentenceId, validateAloudReview } from '../src/read-aloud-model.js';
import { encodeWav, inspectWav } from '../src/read-aloud-wav.js';
import { createReadAloudService, createSpeechNormalizer, ALOUD_PROMPT } from './read-aloud-service.js';
import kuromoji from 'kuromoji';
import { audioRange, readAudioBody } from './read-aloud-api.js';
import { createReadingApi } from './reading-api.js';
import { ReadingRecorder } from '../src/read-aloud-recorder.js';

const [article] = parseReadingArticles(articleHtml.replace('<h3>', '<audio src="/media/mp3/test.mp3"></audio><h3>'));
const ids = article.sentences.map((s) => s.id);
const waveform = (seconds = 2, amplitude = .1) => encodeWav([Float32Array.from({ length: 48000 * seconds }, (_, i) => amplitude * Math.sin(i / 10))], 48000);
const example = () => ({ id: 'attempt-1', sentenceIds: [ids[0]], duration: 2, transcript: article.sentences[0].text, summary: 'Nice work!',
  ratings: { accuracy: 'clear', pronunciation: 'clear', pacing: 'clear' }, tips: [], sentences: [{ id: ids[0], status: 'read', observation: '', start: .1, end: 1.8 }], referenceUsed: true, createdAt: 123 });
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const mp3 = () => new Response(Buffer.from('ID3synthetic-test-audio'), { headers: { 'Content-Type': 'audio/mpeg' } });

test('audio import stores only validated source paths and keeps legacy snapshots compatible', () => {
  assert.equal(article.audioPath, '/media/mp3/test.mp3');
  const { audioPath, ...legacy } = article; assert.equal(validateArticle(legacy).audioPath, null);
  for (const audioPath of ['https://evil.test/file.mp3', '/media/mp3/../secret.mp3', '/media/mp3/test.mp3?url=x', '//evil.test/a.mp3']) assert.throws(() => validateArticle({ ...article, audioPath }));
  assert.equal(createReadingSession(legacy, 'session').activity, 'translate');
});

test('recording encoding resamples to mono PCM and measures duration, activity and pauses', () => {
  const wav = waveform(); const metrics = inspectWav(wav);
  assert.equal(metrics.duration, 2); assert.ok(metrics.rms > .05); assert.equal(metrics.pauses.length, 0);
  const silence = inspectWav(waveform(2, 0)); assert.equal(silence.rms, 0); assert.deepEqual(silence.pauses, [{ start: 0, end: 2 }]);
  assert.throws(() => inspectWav(new Uint8Array(20)));
  const bad = wav.slice(); new DataView(bad.buffer).setUint32(24, 48000, true); assert.throws(() => inspectWav(bad));
});

test('alignment tolerates introductions, skips and repeats without assigning uncertain sentence times', () => {
  const sentences = [{ id: 'a', text: 'としょかんにはほんがあります。' }, { id: 'b', text: 'あしたはやすみです。' }, { id: 'c', text: 'こどももきました。' }];
  const words = [{ word: 'ニュースです。', start: 0, end: 1 }, { word: 'トショカンニハホンガアリマス', start: 1, end: 3 },
    { word: 'としょかんにはほんがあります', start: 3, end: 5 }, { word: 'こどももきました', start: 6, end: 8 }];
  assert.deepEqual(alignSpeech(sentences, words), [{ id: 'a', start: 1, end: 3 }, { id: 'c', start: 6, end: 8 }]);
  assert.deepEqual(alignSpeech(sentences, [{ word: 'ぜんぜんちがうことば', start: 0, end: 2 }]), []);
  assert.equal(normalizeSpeech('トショカン、１２。'), 'としょかん12');
  assert.equal(liveSentenceId(sentences, 'まったくわかりません', 'a'), 'a');
  assert.equal(liveSentenceId(sentences, 'としょかんにはほんがあります。あしたはやすみです。', 'a'), 'b');
});

test('Japanese timestamp fragments retain compound readings, zero-duration kanji, and percentage alignment', async () => {
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolve(value)));
  const sentences = ['将来、結婚します。', '男性の割合は80％、女性は75.1％です。'].map((text, i) => ({ id: `fragment-${i}`, text, segments: [{ text, reading: '' }] }));
  const normalizer = createSpeechNormalizer({ sentences }, tokenizer);
  const words = [...sentences.map((s) => s.text.replaceAll('％', '')).join('')].map((word, i) => ({ word, start: i / 10, end: (i + 1) / 10 }));
  const zeroDuration = words.find((word) => word.word === '婚'); zeroDuration.end = zeroDuration.start;
  const matched = alignSpeech(sentences, words, normalizer);
  assert.deepEqual(matched.map((entry) => entry.id), sentences.map((s) => s.id));
  assert.equal(matched[0].start, words[0].start);
  assert.ok(matched[0].end <= matched[1].start);
  assert.equal(normalizer.normalize('80％'), normalizer.normalize('80%'));
  assert.deepEqual(alignSpeech(sentences, [{ word: 'まったくちがうことば', start: 0, end: 4 }], normalizer), []);
  const kana = [{ word: 'しょうらい、けっこんします。', start: 0, end: 3 }];
  assert.equal(alignSpeech(sentences.slice(0, 1), kana, normalizer)[0]?.id, sentences[0].id);
});

test('live events reconcile final transcripts, duplicate events and out-of-order completion', () => {
  const live = new LiveTranscript();
  live.receive({ type: 'input_audio_buffer.committed', item_id: 'two', previous_item_id: 'one' });
  live.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'two', transcript: '二。' });
  live.receive({ type: 'input_audio_buffer.committed', item_id: 'one' });
  live.receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'い' });
  assert.deepEqual(live.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: '一。' }), { text: '一。二。', provisional: false });
  assert.equal(live.receive({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'duplicate' }).text, '一。二。');
});

test('saved reviews strip recordings, preserve feedback, limit history and validate IDs and timing', () => {
  const session = createReadingSession(article, 'session'); session.activity = 'aloud'; session.audio = 'do not persist';
  session.reviews = Array.from({ length: 24 }, (_, i) => ({ ...example(), id: `attempt-${i}`, recording: 'do not persist', audioBytes: [1, 2, 3] }));
  const saved = validateSession(session); assert.equal(saved.activity, 'aloud'); assert.equal(saved.reviews.length, 20);
  assert.equal(JSON.stringify(saved).includes('do not persist'), false); assert.equal(JSON.stringify(saved).includes('audioBytes'), false);
  assert.equal(validateSession(JSON.parse(JSON.stringify(saved))).reviews[0].summary, 'Nice work!');
  assert.throws(() => validateAloudReview({ ...example(), ratings: { accuracy: 99 } }, article));
  assert.throws(() => validateAloudReview({ ...example(), sentences: [] }, article));
  assert.throws(() => validateAloudReview({ ...example(), sentences: [{ ...example().sentences[0], end: 20 }] }, article));
  assert.throws(() => validateAloudReview({ ...example(), tips: [{ category: 'pacing', sentenceId: 'other', text: 'tip' }] }, article));
});

test('binary upload is bounded and audio range seeking handles full, partial and invalid ranges', async () => {
  const body = { article, id: 'attempt', sentenceIds: [ids[0]] }, metadata = Buffer.from(JSON.stringify(body)), wav = waveform();
  const packet = Buffer.alloc(4 + metadata.length + wav.length); packet.writeUInt32LE(metadata.length); metadata.copy(packet, 4); packet.set(wav, 4 + metadata.length);
  const parsed = await readAudioBody(Readable.from([packet.subarray(0, 3), packet.subarray(3)]));
  assert.deepEqual(parsed.body, body); assert.equal(inspectWav(parsed.bytes).duration, 2);
  await assert.rejects(readAudioBody(Readable.from([Buffer.alloc(16_000_001)])), (e) => e.status === 413);
  await assert.rejects(readAudioBody(Readable.from([Buffer.from('bad')])));
  assert.deepEqual(audioRange(undefined, 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(audioRange('bytes=20-29', 100), { start: 20, end: 29, partial: true });
  assert.deepEqual(audioRange('bytes=-10', 100), { start: 90, end: 99, partial: true });
  assert.deepEqual(audioRange('bytes=95-', 100), { start: 95, end: 99, partial: true });
  for (const range of ['bytes=100-', 'bytes=20-10', 'bytes=-0', 'bytes=0-1,4-5']) assert.throws(() => audioRange(range, 100));
});

function makeService(fetchImpl, overrides = {}) {
  return createReadAloudService({ source: { article: async () => article }, apiKey: () => 'test', fetchImpl, normalizeFactory: async () => normalizeSpeech, ...overrides });
}
test('reference audio uses source-discovered paths, caches bytes and rejects unavailable or unsafe responses', async () => {
  let calls = 0;
  const service = makeService(async (url, options) => { calls++; assert.equal(url, 'https://nhkeasier.com/media/mp3/test.mp3'); assert.equal(options.redirect, 'error'); return mp3(); });
  assert.ok((await service.audio(article.id)).version); await service.audio(article.id); assert.equal(calls, 1);
  for (const response of [new Response('', { status: 404 }), new Response('<html/>', { headers: { 'Content-Type': 'audio/mpeg' } }), new Response('x', { headers: { 'Content-Type': 'text/html' } })]) await assert.rejects(makeService(async () => response).audio(article.id));
});

test('reference timing preparation matches snapshots, reuses stored metadata and excludes learner audio', async () => {
  let stored, transcriptions = 0;
  const service = makeService(async (url) => {
    if (url.startsWith('https://nhkeasier.com')) return mp3();
    transcriptions++; return json({ text: article.sentences[0].text, words: [{ word: article.sentences[0].text, start: 1, end: 2 }] });
  }, { isDbReady: () => true, runSqlite: async (_, sql) => {
    if (sql.startsWith('SELECT')) return JSON.stringify(stored ? [{ payload: stored }] : []);
    assert.ok(!sql.includes('ID3')); stored = JSON.stringify({ timings: [{ id: ids[0], start: 1, end: 2 }], version: 'v' });
  } });
  const data = await service.reference({ article }); assert.equal(data.timings[0].id, ids[0]);
  await service.reference({ article }); assert.equal(transcriptions, 1);
  await service.reference({ article, retry: true }); assert.equal(transcriptions, 2);
  const changed = structuredClone(article); changed.sentences[0].text = '変わりました。'; changed.sentences[0].segments = [{ text: '変わりました。', reading: '' }];
  await assert.rejects(service.reference({ article: changed }), (e) => e.status === 409);
});

test('empty reference alignments can be retried instead of remaining in the timing cache', async () => {
  let transcriptions = 0, writes = 0;
  const service = makeService(async (url) => {
    if (url.startsWith('https://nhkeasier.com')) return mp3();
    transcriptions++; return json({ text: 'unrelated speech', words: [{ word: 'unrelated speech', start: 0, end: 1 }] });
  }, { isDbReady: () => true, runSqlite: async (_, sql) => {
    if (sql.startsWith('SELECT')) return JSON.stringify([{ payload: JSON.stringify({ timings: [], version: 'old' }) }]);
    writes++; return '';
  } });
  assert.deepEqual((await service.reference({ article })).timings, []);
  assert.deepEqual((await service.reference({ article })).timings, []);
  assert.equal(transcriptions, 2); assert.equal(writes, 0);
});

test('legacy article reference playback is available even when timing preparation lacks an API key', async () => {
  const service = makeService(async () => mp3(), { apiKey: () => '' });
  const { audioPath, ...legacy } = article;
  const result = await service.reference({ article: legacy });
  assert.equal(result.audioPath, '/media/mp3/test.mp3'); assert.deepEqual(result.timings, []);
  assert.match(result.warning, /full recording/);
});

test('audio review listens to distinct learner/reference recordings then formats grounded feedback', async () => {
  const calls = [];
  const service = makeService(async (url, options) => {
    calls.push(url);
    if (url.startsWith('https://nhkeasier.com')) return mp3();
    if (url.endsWith('transcriptions')) { assert.equal(options.body.get('model'), 'whisper-1'); return json({ text: article.sentences[0].text, words: [{ word: article.sentences[0].text, start: .1, end: 1.8 }] }); }
    const body = JSON.parse(options.body); assert.equal(body.store, false);
    if (url.endsWith('chat/completions')) {
      assert.equal(body.model, 'gpt-audio-1.5'); assert.deepEqual(body.modalities, ['text']);
      const content = body.messages[1].content; assert.equal(content.filter((c) => c.type === 'input_audio').length, 2);
      assert.equal(Buffer.from(content[1].input_audio.data, 'base64').subarray(0, 4).toString(), 'RIFF');
      assert.ok(!content[0].text.includes('としょかん')); // Ruby readings never pollute source text.
      return json({ choices: [{ finish_reason: 'stop', message: { content: 'Nice work! Speech is clear.' } }] });
    }
    assert.equal(body.text.format.strict, true);
    return json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(example()) }] }] });
  });
  const result = await service.review({ id: 'attempt-1', article, sentenceIds: [ids[0]] }, Buffer.from(waveform()));
  assert.equal(result.review.ratings.pronunciation, 'clear'); assert.equal(result.review.referenceUsed, true);
  assert.equal(result.review.sentences[0].start, .1); assert.equal(calls.length, 4);
  assert.match(ALOUD_PROMPT, /A correct transcript does not prove correct pronunciation/);
  assert.match(ALOUD_PROMPT, /unfinished trailing passages/);
});

test('silence produces uncertainty without paid model requests; durations and missing keys are checked', async () => {
  const service = makeService(() => { throw new Error('Must not call upstream'); });
  const result = await service.review({ id: 'silent', article, sentenceIds: [ids[0]] }, Buffer.from(waveform(2, 0)));
  assert.equal(result.review.ratings.pronunciation, 'uncertain'); assert.equal(result.review.transcript, '');
  await assert.rejects(service.review({ id: 'long', article, sentenceIds: [ids[0]] }, Buffer.from(waveform(91))), (e) => e.status === 400);
  await assert.rejects(makeService(() => {}, { apiKey: () => '' }).transcriptionSession(), (e) => e.status === 501);
});

test('incomplete model feedback never becomes a successful review; missing references allow honest feedback', async () => {
  for (const invalid of [true, false]) {
    const service = makeService(async (url) => {
      if (url.startsWith('https://nhkeasier.com')) return new Response('', { status: 404 });
      if (url.endsWith('transcriptions')) return json({ text: '図書館', words: [] });
      if (url.endsWith('chat/completions')) return json({ choices: [{ finish_reason: 'stop', message: { content: 'The recording needs practice.' } }] });
      return json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(invalid ? { ...example(), sentences: [] } : example()) }] }] });
    });
    const run = service.review({ id: 'test', article, sentenceIds: [ids[0]] }, Buffer.from(waveform()));
    if (invalid) await assert.rejects(run, (e) => e.status === 502);
    else { const result = await run; assert.equal(result.review.referenceUsed, false); assert.equal(result.review.sentences[0].start, null); }
  }
});

test('transcription credentials are short-lived and scoped to Japanese transcription', async () => {
  const service = makeService(async (url, options) => {
    const body = JSON.parse(options.body); assert.ok(url.endsWith('/realtime/client_secrets'));
    assert.equal(body.expires_after.seconds, 600); assert.equal(body.session.type, 'transcription');
    assert.deepEqual(body.session.audio.input.transcription.languages, ['ja']);
    assert.equal(body.session.audio.input.turn_detection, null);
    return json({ value: 'short-lived-secret', expires_at: 123 });
  });
  assert.deepEqual(await service.transcriptionSession(), { value: 'short-lived-secret', expiresAt: 123 });
});

test('live transcription commits captured turns without sending empty buffers', () => {
  const recorder = new ReadingRecorder({ limit: 90, onUpdate: () => {} });
  const sent = [];
  recorder.audioContext = { sampleRate: 24000 };
  recorder.channel = { readyState: 'open', send: (payload) => sent.push(JSON.parse(payload)) };
  recorder.samples = 2400; recorder.commitTranscription(); assert.equal(sent.length, 0);
  recorder.samples = 24000; recorder.commitTranscription(); assert.deepEqual(sent, [{ type: 'input_audio_buffer.commit' }]);
  recorder.commitTranscription(); assert.equal(sent.length, 1);
  recorder.channel.readyState = 'closed'; recorder.samples = 48000; recorder.commitTranscription(); assert.equal(sent.length, 1);
});

test('read aloud API supports range playback and rejects cross-origin paid requests', async () => {
  const api = createReadingApi({ source: {}, isDbReady: () => false, runSqlite: () => {}, getUser: () => {},
    aloud: { audio: async () => ({ bytes: Buffer.from('ID3test'), version: 'version' }), transcriptionSession: () => { throw new Error('Cross-origin requests must not reach OpenAI'); } } });
  const res = () => ({ headersSent: false, writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }, end(data) { this.data = data; } });
  const request = Readable.from([]); request.method = 'GET'; request.headers = { range: 'bytes=0-2' };
  const response = res(); await api(request, response, new URL(`http://localhost/api/reading/articles/${article.id}/audio`));
  assert.equal(response.status, 206); assert.equal(response.data.toString(), 'ID3');
  const bad = Readable.from([]); bad.method = 'POST'; bad.headers = { origin: 'https://evil.test', host: 'localhost' };
  const rejected = res(); await api(bad, rejected, new URL('http://localhost/api/reading/read-aloud/transcription-session')); assert.equal(rejected.status, 403);
});
