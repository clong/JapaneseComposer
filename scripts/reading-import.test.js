import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadingImporter } from './reading-import.js';
import { createReadingAi, READING_SPLIT_PROMPT } from './reading-ai.js';
import { createReadingSession, validateArticle, validateSession, MAX_CUSTOM_READING_TEXT } from '../src/reading-model.js';
import { ReadingSync } from '../src/reading-sync.js';

const response = output => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }));
const noAi = { split: () => { throw new Error('Punctuated text needs no model request'); } };

test('pasted text preserves Japanese punctuation, quotes and paragraphs with real furigana', async () => {
  const importText = createReadingImporter({ ai: noAi, uuid: () => 'fixture', now: () => 123 });
  const { article } = await importText({ title: '図書館', text: ' 図書館に本があります。今日は休みです！\r\n\r\n先生は「明日ですか？ はい。」と言いました。 ' });
  assert.equal(article.sourceType, 'custom'); assert.equal(article.id, 'custom-fixture'); assert.equal(article.fetchedAt, 123);
  assert.deepEqual(article.sentences.map(s => [s.text, s.paragraph]), [
    ['図書館に本があります。', 0], ['今日は休みです！', 0], ['先生は「明日ですか？ はい。」と言いました。', 1]
  ]);
  assert.deepEqual(article.titleSegments, [{ text: '図書館', reading: 'としょかん' }]);
  assert.ok(article.sentences[0].segments.some(s => s.text === '図書館' && s.reading === 'としょかん'));
  assert.equal(article.sourceUrl, null); assert.equal(article.providerUrl, null); assert.equal(article.audioPath, null);
  assert.deepEqual(validateSession(createReadingSession(article, 'session')).article, article);
  const plain = await importText({ text: '😀 日本語 <script>alert(1)</script>。' });
  assert.equal(plain.article.sentences[0].segments.map(s => s.text).join(''), '😀 日本語 <script>alert(1)</script>。');
  assert.equal(plain.article.title, plain.article.sentences[0].text);
});

test('missing punctuation uses semantic splits without modifying or losing original text', async () => {
  const first = '昨日は図書館に行きました 今日は家で勉強します';
  let calls = 0;
  const ai = createReadingAi({ apiKey: () => 'test', fetchImpl: async (_, options) => {
    calls++;
    const body = JSON.parse(options.body), input = JSON.parse(body.input);
    assert.equal(body.store, false); assert.equal(body.instructions, READING_SPLIT_PROMPT);
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(input.passages, [{ id: '0', text: first }, { id: '2', text: '私の予定' }]);
    return response({ passages: [{ id: '2', sentences: ['私の予定'] }, { id: '0', sentences: ['昨日は図書館に行きました', '今日は家で勉強します'] }] });
  } });
  const { article } = await createReadingImporter({ ai })({ text: `${first}\n明日は休みです。\n私の予定` });
  assert.equal(calls, 1);
  assert.deepEqual(article.sentences.map(s => s.text), ['昨日は図書館に行きました', '今日は家で勉強します', '明日は休みです。', '私の予定']);
  assert.deepEqual(article.sentences.map(s => s.paragraph), [0, 0, 1, 2]);
  assert.equal(new Set(article.sentences.map(s => s.id)).size, 4);
});

test('invalid inputs and mismatched model splits cannot create a changed or incomplete document', async () => {
  const importText = createReadingImporter({ ai: noAi });
  for (const body of [{}, { text: ' ' }, { text: 42 }, { text: 'あ'.repeat(MAX_CUSTOM_READING_TEXT + 1) },
    { text: 'はい。', title: 'x'.repeat(201) }, { text: 'はい。'.repeat(201) }, { text: 'はい。\n'.repeat(201) }]) {
    await assert.rejects(importText(body), error => error.status === 400);
  }
  for (const passages of [[], [{ id: 'wrong', sentences: ['今日は晴れ明日は雨'] }],
    [{ id: '0', sentences: ['今日は晴れ。', '明日は雨。'] }], [{ id: '0', sentences: ['今日は晴れ'] }],
    [{ id: '0', sentences: ['明日は雨', '今日は晴れ'] }], [{ id: '0', sentences: ['', '今日は晴れ明日は雨'] }],
    [{ id: '0', sentences: ['今日は晴れ', '今日は晴れ', '明日は雨'] }]]) {
    await assert.rejects(createReadingImporter({ ai: { split: async () => ({ passages }) } })({ text: '今日は晴れ明日は雨' }), error => error.status === 502);
  }
  const missingKey = createReadingImporter({ ai: createReadingAi({ apiKey: () => '' }) });
  await assert.rejects(missingKey({ text: '今日は晴れ明日は雨' }), error => error.status === 501);
  assert.equal((await missingKey({ text: '今日は晴れ。' })).article.sentences.length, 1);
});

test('custom documents keep their identity across local reloads and strip publisher metadata', async t => {
  const { article } = await createReadingImporter({ ai: noAi })({ text: '今日は晴れです。' });
  const clean = validateArticle({ ...article, audioPath: '/media/mp3/test.mp3', sourceUrl: 'https://evil.test/', providerUrl: 'https://evil.test/', imageUrl: 'https://evil.test/', publishedAt: 'yesterday' });
  assert.equal(clean.audioPath, null); assert.equal(clean.sourceUrl, null); assert.equal(clean.imageUrl, null); assert.equal(clean.publishedAt, '');
  assert.throws(() => validateArticle({ ...article, id: 'nhkeasier-123' }));
  assert.throws(() => validateArticle({ ...article, sourceType: 'unknown' }));
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const first = new ReadingSync({ storage }), second = new ReadingSync({ storage });
  t.after(() => { first.dispose(); second.dispose(); });
  first.setOwner('guest'); const session = createReadingSession(article, 'pasted'); first.save(session); first.activate(session.id);
  second.setOwner('guest'); assert.deepEqual(second.sessions[0], session); assert.equal(second.activeId, session.id);
});
