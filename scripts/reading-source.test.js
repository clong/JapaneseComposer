import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReadingArticles, createReadingSource } from './reading-source.js';
import { articleHtml } from './reading-fixtures.js';
import { validateArticle, readingId, splitJapaneseSentences } from '../src/reading-model.js';

test('article extraction preserves sentences, paragraphs and ruby without scripts or reading duplication', () => {
  const [article] = parseReadingArticles(articleHtml, 100);
  assert.equal(article.title, '図書館のニュース');
  assert.deepEqual(article.titleSegments, [{ text: '図書館', reading: 'としょかん' }, { text: 'のニュース', reading: '' }]);
  assert.deepEqual(validateArticle(JSON.parse(JSON.stringify(article))).titleSegments, article.titleSegments);
  assert.equal(article.sentences.length, 4);
  assert.equal(article.sentences[0].text, '図書館に本が三冊あります。');
  assert.equal(article.sentences[0].segments[0].reading, 'としょかん');
  assert.equal(article.sentences[2].text, '先生は「明日は休みですか？　いいえ。」と話しました。');
  assert.deepEqual(article.sentences.map((s) => s.paragraph), [0,0,1,1]);
  assert.ok(!JSON.stringify(article).includes('bad()'));
  assert.equal(article.providerUrl, 'https://nhkeasier.com/story/123/');
  assert.deepEqual(parseReadingArticles(articleHtml, 200)[0].sentences, article.sentences);
  assert.notEqual(parseReadingArticles(articleHtml.replace('三冊', '四冊'))[0].sentences[0].id, article.sentences[0].id);
});

test('sentence splitting preserves quotes, punctuation and trailing text', () => {
  assert.deepEqual(splitJapaneseSentences('「はい。」と答えた。次です！？終わり').map((s) => s.text), ['「はい。」と答えた。', '次です！？', '終わり']);
  assert.deepEqual(splitJapaneseSentences(''), []);
  assert.deepEqual(splitJapaneseSentences('「今日は休みです。」明日は開きます。').map((s) => s.text), ['「今日は休みです。」', '明日は開きます。']);
});

test('article source caches discovery, shares in-flight fetches and falls back with a stale timestamp', async () => {
  let clock = 100; let requests = 0; let fail = false;
  const source = createReadingSource({ now: () => clock, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://nhkeasier.com/'); assert.equal(options.redirect, 'error'); requests += 1;
    if (fail) throw new Error('offline');
    return new Response(articleHtml);
  } });
  const [a, b] = await Promise.all([source.list(), source.list()]);
  assert.deepEqual(a,b); assert.equal(requests,1);
  assert.equal(a.articles[0].titleSegments[0].reading, 'としょかん');
  await source.list(); assert.equal(requests,1);
  assert.equal((await source.article('nhkeasier-123')).id, 'nhkeasier-123');
  await assert.rejects(source.article('https://localhost/secret'), /Invalid article/);
  clock += 600001; fail = true;
  const stale = await source.list(); assert.equal(stale.stale,true); assert.equal(stale.fetchedAt,100);
  assert.equal((await source.article('nhkeasier-123')).id, 'nhkeasier-123');
});

test('unavailable, changed, oversized and redirecting sources report errors', async () => {
  for (const fetchImpl of [async () => new Response('login'), async () => new Response('', {status:401}), async () => new Response('a'.repeat(2000001)), async () => { throw new Error('redirect'); }]) {
    await assert.rejects(createReadingSource({ fetchImpl }).list());
  }
});

test('snapshot validation rejects unsafe URLs, duplicate IDs and mismatched annotations', () => {
  const [article] = parseReadingArticles(articleHtml);
  assert.throws(() => validateArticle({...article, sourceUrl:'javascript:alert(1)'}));
  assert.throws(() => validateArticle({...article, providerUrl:'https://nhkeasier.com.evil.com/story/123/'}));
  assert.throws(() => validateArticle({...article, sentences:[article.sentences[0],article.sentences[0]]}));
  assert.throws(() => validateArticle({...article, sentences:[{...article.sentences[0],segments:[{text:'changed'}]}]}));
  assert.throws(() => validateArticle({...article, titleSegments:[{text:'changed', reading:''}]}));
  assert.throws(() => readingId('__proto__'));
});

test('title annotations trim source whitespace, exclude unsafe markup, and accept older snapshots', () => {
  const [article] = parseReadingArticles(articleHtml.replace('<h3>', '<h3> \n<script>bad()</script>').replace('</h3>', ' \n</h3>'));
  assert.equal(article.title, '図書館のニュース');
  assert.equal(article.titleSegments.map((s) => s.text).join(''), article.title);
  assert.ok(!JSON.stringify(article.titleSegments).includes('bad()'));
  const { titleSegments, ...legacy } = article;
  assert.deepEqual(validateArticle(legacy).titleSegments, [{ text: article.title, reading: '' }]);
});
