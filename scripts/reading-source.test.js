import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReadingArticles, createReadingSource } from './reading-source.js';
import { articleHtml } from './reading-fixtures.js';
import { validateArticle, readingId, readingImageUrl, splitJapaneseSentences } from '../src/reading-model.js';

const fixtureNow = Date.parse('2026-09-10T12:00:00Z');
const articleOn = (day, id = day.replaceAll('-', '')) => articleHtml.replaceAll('/story/123/', `/story/${id}/`).replace('2026-09-10T08:00:00Z', `${day}T08:00:00Z`);

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

test('article thumbnails use the first publisher image and survive discovery and snapshot validation', async () => {
  const illustrated = articleHtml.replace('<p>', '<img src="/static/dict.png"><img src="/media/jpg/library.jpg" onerror="bad()"><img src="/media/jpg/second.jpg"><p>');
  const [article] = parseReadingArticles(illustrated, 100);
  assert.equal(article.imageUrl, 'https://nhkeasier.com/media/jpg/library.jpg');
  assert.deepEqual(article.sentences, parseReadingArticles(articleHtml, 100)[0].sentences);
  assert.equal(validateArticle(JSON.parse(JSON.stringify(article))).imageUrl, article.imageUrl);
  const source = createReadingSource({ now: () => fixtureNow, fetchImpl: async () => new Response(illustrated) });
  assert.equal((await source.list()).articles[0].imageUrl, article.imageUrl);
  assert.equal((await source.article(article.id)).imageUrl, article.imageUrl);
  const { imageUrl, ...legacy } = article;
  assert.equal(validateArticle(legacy).imageUrl, null);
});

test('unsafe or missing thumbnails do not prevent articles from loading', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,bad', 'https://nhkeasier.com.evil.test/media/jpg/a.jpg',
    'https://user:secret@nhkeasier.com/media/jpg/a.jpg', 'http://nhkeasier.com/media/jpg/a.jpg',
    '/media/jpg/a.svg', '/media/jpg/a.jpg?redirect=elsewhere', '/static/dict.png', '/media/jpg/../../admin.jpg']) {
    assert.throws(() => readingImageUrl(value));
    assert.equal(parseReadingArticles(articleHtml.replace('<p>', `<img src="${value}"><p>`))[0].imageUrl, null);
  }
  assert.equal(readingImageUrl('/media/jpg/library.jpg'), 'https://nhkeasier.com/media/jpg/library.jpg');
  assert.equal(parseReadingArticles(articleHtml)[0].imageUrl, null);
});

test('article source caches discovery, shares in-flight fetches and falls back with a stale timestamp', async () => {
  let clock = fixtureNow; let requests = 0; let fail = false;
  const source = createReadingSource({ now: () => clock, fetchImpl: async (url, options) => {
    assert.ok(['https://nhkeasier.com/2026/09/10/', 'https://nhkeasier.com/story/123/'].includes(url)); assert.equal(options.redirect, 'error'); requests += 1;
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
  const stale = await source.list(); assert.equal(stale.stale,true); assert.equal(stale.fetchedAt,fixtureNow);
  assert.equal((await source.article('nhkeasier-123')).id, 'nhkeasier-123');
});

test('today uses Japan time, filters other publication dates, and refresh bypasses the daily cache', async () => {
  const clock = Date.parse('2026-09-10T16:00:00Z'); // September 11 in Japan.
  let requests = 0;
  const source = createReadingSource({ now: () => clock, fetchImpl: async url => {
    requests++;
    assert.equal(url, 'https://nhkeasier.com/2026/09/11/');
    return new Response(articleHtml + articleHtml.replaceAll('/story/123/', '/story/456/').replace('2026-09-10T08:00:00Z', '2026-09-10T15:30:00Z'));
  } });
  const today = await source.list();
  assert.equal(today.date, '2026-09-11'); assert.equal(today.mode, 'today');
  assert.deepEqual(today.articles.map(article => article.id), ['nhkeasier-456']);
  await source.list(); assert.equal(requests, 1);
  await source.list({ refresh: true }); assert.equal(requests, 2);
});

test('unpublished days are empty and a new day never falls back to yesterday’s cached articles', async () => {
  let clock = fixtureNow, status = 200;
  const source = createReadingSource({ now: () => clock, fetchImpl: async () => new Response(status === 200 ? articleHtml : '', { status }) });
  assert.equal((await source.list()).articles.length, 1);
  clock += 86400000; status = 503;
  await assert.rejects(source.list(), /unavailable/);
  status = 404;
  const empty = await source.list();
  assert.deepEqual(empty.articles, []); assert.equal(empty.date, '2026-09-11'); assert.equal(empty.stale, false);
});

test('random discovery returns exactly four different dates in the past year and keeps today separate', async () => {
  let requests = 0, archiveRequests = 0;
  const requested = [];
  const source = createReadingSource({ now: () => fixtureNow, random: () => 0, fetchImpl: async url => {
    requests++;
    const day = new URL(url).pathname.slice(1, -1).replaceAll('/', '-');
    requested.push(day);
    if (day === '2026-09-10') return new Response(articleOn(day));
    archiveRequests++;
    // Skip two unpublished dates and a duplicate article supplied on another date.
    if (archiveRequests <= 2) return new Response('', { status: 404 });
    const id = archiveRequests === 4 ? 'shared' : archiveRequests === 3 ? 'shared' : day.replaceAll('-', '');
    return new Response(articleOn(day, id === 'shared' ? '99' : id));
  } });
  const today = await source.list();
  const [a, b] = await Promise.all([source.random(), source.random()]);
  assert.deepEqual(a, b);
  assert.equal(a.mode, 'random'); assert.equal(a.articles.length, 4);
  assert.equal(new Set(a.articles.map(article => article.id)).size, 4);
  assert.equal(new Set(a.articles.map(article => article.publishedAt.slice(0, 10))).size, 4);
  assert.ok(a.articles.every(article => article.publishedAt >= '2025-09-10' && article.publishedAt < '2026-09-10'));
  assert.ok(requested.slice(1).every(day => day >= '2025-09-10' && day < '2026-09-10'));
  const before = requests;
  assert.deepEqual(await source.list(), today); assert.equal(requests, before);
  await source.list({ refresh: true }); assert.equal(requests, before + 1);
  assert.equal((await source.article(a.articles[0].id)).id, a.articles[0].id);
});

test('random discovery samples again on every call and handles leap-year date bounds', async () => {
  let seed = 1;
  const source = createReadingSource({ now: () => Date.parse('2024-02-29T12:00:00Z'),
    random: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
    fetchImpl: async url => {
      const day = new URL(url).pathname.slice(1, -1).replaceAll('/', '-');
      assert.ok(day >= '2023-02-28' && day < '2024-02-29');
      return new Response(articleOn(day) + articleOn(day, `${day.replaceAll('-', '')}1`));
    }
  });
  const a = await source.random(), b = await source.random();
  assert.notDeepEqual(a.articles.map(article => article.id), b.articles.map(article => article.id));
  assert.equal(a.articles.length, 4); assert.equal(b.articles.length, 4);
});

test('random discovery bounds empty-date retries and reports errors instead of partial or stale results', async () => {
  let requests = 0;
  const source = createReadingSource({ now: () => fixtureNow, random: () => 0, fetchImpl: async () => {
    requests++; return new Response('', { status: 404 });
  } });
  await assert.rejects(source.random(), /four articles/); assert.equal(requests, 24);
  const unavailable = createReadingSource({ fetchImpl: async () => new Response('', { status: 503 }) });
  await assert.rejects(unavailable.random(), /unavailable/);
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
