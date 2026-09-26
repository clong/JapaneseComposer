// Run after npm run build. All article responses are fixtures; browser is Google Chrome.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { parseReadingArticles } from './reading-source.js';
import { articleHtml } from './reading-fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [article] = parseReadingArticles(articleHtml);
const bundle = await build({ stdin: { contents: `
  import { createReadingPage } from './src/reading.js';
  const article = ${JSON.stringify(article)};
  const makeArticle = (id, title, day) => ({ ...article, id, title, titleSegments: [{ text: title, reading: '' }], publishedAt: day + 'T08:00:00Z', sentenceCount: article.sentences.length });
  const today = [makeArticle('nhkeasier-1', '今日の記事', '2026-09-10')];
  const random = ['2025-10-24', '2026-01-15', '2026-05-18', '2026-08-26'].map((day, index) => makeArticle('nhkeasier-' + (index + 2), '過去の記事 ' + (index + 1), day));
  window.fixture = { calls: [], pending: [], delay: false, fail: false, empty: false };
  let context = { active: true, language: 'en', owner: 'guest' };
  const controller = createReadingPage({ root: document.querySelector('#reading-root'), lookup: async () => ({ status: 'miss' }),
    request: async route => {
      fixture.calls.push(route);
      if (route.startsWith('articles/nhkeasier-')) return { article: [...today, ...random].find(article => article.id === route.slice(9)) };
      if (fixture.delay) await new Promise(resolve => fixture.pending.push(resolve));
      if (fixture.fail) throw new Error('Temporary archive failure');
      const mode = route === 'articles/random' ? 'random' : 'today';
      return { articles: mode === 'random' ? random : fixture.empty ? [] : today, mode, date: '2026-09-10', fetchedAt: Date.now(), stale: false };
    }
  });
  fixture.language = language => controller.update(context = { ...context, language });
  controller.update(context);
`, resolveDir: root }, bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const css = await readFile(path.join(root, 'dist/assets/app.css'));
const server = http.createServer((req, res) => {
  const js = req.url === '/fixture.js', style = req.url === '/app.css';
  res.setHeader('Content-Type', js ? 'text/javascript' : style ? 'text/css' : 'text/html');
  res.end(js ? bundle.outputFiles[0].contents : style ? css : '<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div class="radix-themes app"><main id="reading-root"></main></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const today = page.getByRole('button', { name: 'Today’s articles', exact: true });
  const random = page.getByRole('button', { name: 'Random articles', exact: true });
  const count = n => page.waitForFunction(n => document.querySelectorAll('.reading-article-card').length === n, n);
  await count(1);
  const todayBox = await today.boundingBox(), randomBox = await random.boundingBox();
  assert.ok(randomBox.y >= todayBox.y + todayBox.height, 'Random articles is below Today’s articles');
  assert.equal(await page.getByRole('button', { name: 'Refresh articles', exact: true }).count(), 0);
  assert.match(await page.locator('.reading-library-caption').innerText(), /Japan time/);
  await random.click(); await count(4);
  assert.match(await page.locator('.reading-library-caption').innerText(), /past year/);
  assert.equal(await random.getAttribute('aria-pressed'), 'true');
  const screenshots = await mkdtemp(path.join(tmpdir(), 'jc-reading-library-'));
  await page.screenshot({ path: path.join(screenshots, 'random-desktop.png'), fullPage: true });
  await page.locator('.reading-article-card button').first().click();
  await page.locator('.reading-article-title').waitFor();
  await page.getByRole('button', { name: '← Browse articles', exact: true }).click(); await count(4);
  await today.click(); await count(1);
  assert.match(await page.locator('.reading-article-card').innerText(), /今日の記事/);
  await random.click(); await count(4);
  await random.click(); await count(4);
  assert.equal(await page.evaluate(() => fixture.calls.filter(route => route === 'articles/random').length), 3);
  assert.ok(await page.evaluate(() => fixture.calls.includes('articles?refresh=1')));

  // The latest clicked mode owns the list even if an older request finishes last.
  await page.evaluate(() => { fixture.delay = true; });
  await random.click(); await page.waitForFunction(() => fixture.pending.length === 1);
  await today.click(); await page.waitForFunction(() => fixture.pending.length === 2);
  await page.evaluate(() => { fixture.pending[1](); }); await count(1);
  await page.evaluate(() => { fixture.pending[0](); fixture.pending = []; fixture.delay = false; });
  assert.equal(await page.locator('.reading-article-card').count(), 1);
  assert.equal(await today.getAttribute('aria-pressed'), 'true');

  await page.evaluate(() => { fixture.empty = true; });
  await today.click(); await page.getByText('No articles have been published for today (Japan time). Try Random articles or check again later.', { exact: true }).waitFor();
  await count(0);
  await page.evaluate(() => { fixture.fail = true; });
  await random.click(); await page.getByText('Temporary archive failure', { exact: false }).waitFor();
  assert.equal(await page.locator('.reading-article-card').count(), 0);
  await page.evaluate(() => { fixture.fail = false; });
  await page.getByRole('button', { name: 'Retry', exact: true }).click(); await count(4);
  assert.equal(await page.evaluate(() => fixture.calls.at(-1)), 'articles/random');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow on mobile');
  const mobileToday = await today.boundingBox(), mobileRandom = await random.boundingBox();
  assert.ok(mobileRandom.y >= mobileToday.y + mobileToday.height);
  await page.screenshot({ path: path.join(screenshots, 'random-mobile.png'), fullPage: true });
  await page.evaluate(() => { fixture.language('ja'); });
  await page.getByRole('button', { name: '今日の記事', exact: true }).waitFor();
  await page.getByRole('button', { name: 'ランダムな記事', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Reading library Chrome checks passed. Screenshots: ' + screenshots);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
