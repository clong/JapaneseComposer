// Real import/tokenizer/API integration; model and dictionary responses are fixtures. Google Chrome only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createReadingApi } from './reading-api.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const calls = [];
const api = createReadingApi({ dbPath: '', isDbReady: () => false, getUser: () => null, runSqlite: () => {},
  source: { list: async () => ({ articles: [], mode: 'today', date: '2026-09-27' }) },
  ai: {
    split: async passages => ({ passages: passages.map(p => ({ id: p.id, sentences: p.text.split(/(?=今日は)/) })) }),
    grade: async body => ({ results: body.answers.map(a => ({ id: a.id, verdict: 'correct', score: 100, explanation: 'Nice work!', improvement: '' })) }),
    reverse: async body => ({ english: { title: 'My reading', sentences: body.article.sentences.map(s => ({ id: s.id, text: 'I study Japanese.' })) } })
  }
});
const bundle = await build({ stdin: { contents: `
  import { createReadingPage } from './src/reading.js';
  import { requestReading } from './src/reading-sync.js';
  window.fixture = { calls: [], fail: false, hold: false, pending: [], released: 0 };
  let context = { active: true, language: 'en', owner: 'guest' };
  const controller = createReadingPage({ root: document.querySelector('#reading-root'),
    lookup: async () => ({ status: 'hit', entry: { word: '図書館', reading: 'としょかん', meaning: 'library' } }),
    request: async (route, options) => {
      fixture.calls.push(route);
      if (route === 'sessions') return { records: [] };
      if (route.startsWith('sessions/')) return { revision: 1 };
      if (route === 'articles/import' && fixture.fail) throw new Error('Temporary import failure');
      const result = await requestReading(route, route === 'articles/import' ? { ...options, signal: undefined } : options);
      if (route === 'articles/import' && fixture.hold) await new Promise(resolve => fixture.pending.push(() => { fixture.released++; resolve(); }));
      return result;
    }
  });
  fixture.update = changes => controller.update(context = { ...context, ...changes });
  controller.update(context);
`, resolveDir: root }, bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const css = await readFile(path.join(root, 'dist/assets/app.css'));
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/reading/')) { calls.push(req.url); await api(req, res, new URL(req.url, 'http://localhost')); return; }
  const js = req.url === '/fixture.js', style = req.url === '/app.css';
  res.setHeader('Content-Type', js ? 'text/javascript' : style ? 'text/css' : 'text/html');
  res.end(js ? bundle.outputFiles[0].contents : style ? css : '<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div class="radix-themes app"><main id="reading-root"></main></div><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const paste = () => page.getByRole('button', { name: 'Paste your own text', exact: true }).click();
  const submit = () => page.getByRole('button', { name: 'Start reading this text', exact: true }).click();
  const text = page.getByLabel('Japanese text', { exact: true });
  await paste();
  assert.equal(await page.getByRole('button', { name: 'Start reading this text', exact: true }).isDisabled(), true);
  await text.fill('あ'.repeat(12001));
  assert.equal((await text.inputValue()).length, 12001);
  assert.equal(await page.getByRole('button', { name: 'Start reading this text', exact: true }).isDisabled(), true);
  await page.getByLabel('Title (optional)', { exact: true }).fill('私の練習');
  await text.fill('昨日は図書館に行きました今日は家で勉強します');
  const screenshots = await mkdtemp(path.join(tmpdir(), 'jc-reading-import-'));
  await page.screenshot({ path: path.join(screenshots, 'paste-desktop.png'), fullPage: true });
  await submit(); await page.locator('.reading-article-title').waitFor();
  assert.equal(await page.locator('.reading-sentence-row').count(), 2);
  assert.equal(await page.locator('.reading-attribution').innerText(), 'Your pasted text');
  assert.equal(await page.locator('.reading-attribution a').count(), 0);
  assert.ok(await page.locator('.reading-source-text rt').count() > 0);
  await page.locator('.reading-sentence-source').first().click();
  await page.locator('.reading-answer').first().fill('I went to the library yesterday.');
  await page.getByRole('button', { name: 'Grade sentence', exact: true }).first().click();
  await page.getByText('Nice work!', { exact: true }).waitFor();
  await page.evaluate(() => {
    const node = [...document.querySelectorAll('.reading-source-text ruby')].find(ruby => ruby.firstChild.textContent === '図書館').firstChild;
    const range = document.createRange(); range.selectNodeContents(node);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('.reading-vocabulary-card').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'English → Japanese', exact: true }).click();
  await page.getByText('I study Japanese.', { exact: true }).first().waitFor();
  await page.reload();
  await page.getByText('I study Japanese.', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.reading-vocabulary-card').count(), 1);
  await page.locator('.reading-activity-option').filter({ hasText: 'Read aloud' }).click();
  await page.getByRole('button', { name: 'Read whole article', exact: true }).waitFor();
  assert.equal(await page.locator('[data-aloud-sentence]').count(), 2);
  assert.equal(await page.locator('.reading-reference').count(), 0);
  assert.equal(calls.some(route => route.includes('read-aloud/reference')), false);

  await paste(); await text.fill('今日は晴れです。');
  await page.evaluate(() => { fixture.fail = true; }); await submit();
  await page.getByRole('alert').filter({ hasText: 'Temporary import failure' }).waitFor();
  assert.equal(await text.inputValue(), '今日は晴れです。');
  await page.evaluate(() => { fixture.fail = false; }); await submit();
  await page.locator('.reading-article-title').waitFor();
  assert.equal(await page.locator('.reading-sentence-row').count(), 1);

  await paste(); await text.fill('これはキャンセルします。');
  await page.evaluate(() => { fixture.hold = true; }); await submit();
  await page.waitForFunction(() => fixture.pending.length === 1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => { fixture.pending.shift()(); });
  await page.waitForFunction(() => fixture.released === 1);
  assert.equal(await page.locator('.reading-session-card').count(), 2);

  await paste(); await submit(); await page.waitForFunction(() => fixture.pending.length === 1);
  await page.evaluate(() => { fixture.update({ owner: 'bob' }); fixture.pending.shift()(); });
  await page.waitForFunction(() => fixture.released === 2);
  assert.equal(await page.locator('.reading-session-card').count(), 0);
  await paste(); assert.equal(await text.inputValue(), '');
  await page.evaluate(() => { fixture.hold = false; });
  await page.getByLabel('Title (optional)', { exact: true }).fill('Literal markup');
  await text.fill('<img src=x onerror="window.xss=true">。'); await submit();
  await page.locator('.reading-article-title').waitFor();
  assert.equal(await page.locator('.reading-source-text img').count(), 0);
  assert.equal(await page.evaluate(() => window.xss), undefined);

  await page.setViewportSize({ width: 390, height: 844 }); await paste();
  await text.fill('今日は晴れです。');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(screenshots, 'paste-mobile.png'), fullPage: true });
  await page.evaluate(() => { fixture.update({ language: 'ja' }); });
  await page.getByRole('button', { name: 'この文章で練習する', exact: true }).waitFor();
  assert.equal(await page.getByLabel('日本語の文章', { exact: true }).inputValue(), '今日は晴れです。');
  assert.deepEqual(errors, []);
  console.log('Custom reading Chrome checks passed. Screenshots: ' + screenshots);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
