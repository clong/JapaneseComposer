// Run with `node scripts/reading-vocabulary-browser.js`; uses installed Google Chrome.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { parseReadingArticles } from './reading-source.js';
import { articleHtml, englishFor } from './reading-fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [article] = parseReadingArticles(articleHtml);
const bundle = await build({ stdin: { contents: `
  import { createReadingPage } from './src/reading.js';
  import { createReadingSession } from './src/reading-model.js';
  const article = ${JSON.stringify(article)};
  const first = createReadingSession(article, 'first');
  first.english = ${JSON.stringify(englishFor(article))};
  const second = createReadingSession({ ...article, title: '別の記事', titleSegments: [{ text: '別の記事', reading: '' }] }, 'second');
  const key = 'jc_reading_sessions:guest';
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ activeId: first.id, entries:
    Object.fromEntries([first, second].map(session => [session.id, { id: session.id, session, revision: 0, dirty: false }])) }));
  const library = { word: '図書館', reading: 'としょかん', meaning: 'library' };
  const book = { word: '本', reading: 'ほん', meaning: 'book; volume' };
  const choices = [book, { word: '書籍', reading: 'しょせき', meaning: 'book; publication' }];
  window.fixture = { delayed: false, calls: 0, translationCalls: [], translationFails: true,
    context: { active: true, language: 'en', owner: 'guest' } };
  const controller = createReadingPage({ root: document.querySelector('#reading-root'),
    request: async route => route === 'articles' ? { articles: [], fetchedAt: Date.now() }
      : route === 'read-aloud/reference' ? { timings: [], audioPath: null } : { records: [] },
    lookup: async query => {
      window.fixture.calls++;
      if (fixture.dictionaryThrows) throw new Error('Dictionary unavailable');
      const outcome = query === 'unmatched' ? { status: 'miss' } : query === 'failure' ? { status: 'error' }
        : { status: 'hit', entry: query.toLowerCase() === 'book' ? { ...book, choices } : library };
      if (window.fixture.delayed) await new Promise(resolve => { window.fixture.resolve = resolve; });
      return outcome;
    },
    translate: async (text, { targetLanguage }) => {
      fixture.translationCalls.push({ text, targetLanguage });
      if (fixture.translationDelayed) await new Promise(resolve => { fixture.resolveTranslation = resolve; });
      if (fixture.translationFails) throw new Error('Translation unavailable');
      if (fixture.translationEmpty) return ' ';
      return targetLanguage === 'ja' ? '対応する語' : 'unmatched term';
    }
  });
  window.fixture.update = next => { controller.update(window.fixture.context = { ...window.fixture.context, ...next }); };
  controller.update({ ...window.fixture.context });
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
  const page = await browser.newPage({ viewport: { width: 1536, height: 1100 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const bank = page.locator('.reading-vocabulary');
  const cards = bank.locator('.reading-vocabulary-card');
  const stored = id => page.evaluate(id => JSON.parse(localStorage.getItem('jc_reading_sessions:guest')).entries[id].session, id);
  const count = async expected => { await page.waitForFunction(n => document.querySelectorAll('.reading-vocabulary-card').length === n, expected); };
  const selectJapanese = async () => {
    await page.keyboard.press('Escape');
    await page.locator('.reading-source-text ruby').first().evaluate(node => {
      document.activeElement?.blur();
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
  };
  const selectAnswer = async word => {
    await page.keyboard.press('Escape');
    const answer = page.locator('.reading-answer').first();
    if (!await answer.isVisible()) {
      await page.evaluate(() => getSelection().removeAllRanges());
      await page.locator('.reading-sentence-source').first().press('Enter');
    }
    await answer.fill(word);
    await answer.evaluate(node => { node.focus(); node.setSelectionRange(0, node.value.length); document.dispatchEvent(new Event('selectionchange')); });
  };

  await bank.waitFor(); assert.match(await bank.innerText(), /No vocabulary yet/);
  await selectJapanese(); await count(1);
  assert.equal(await page.locator('.reading-dictionary-source').innerText(), 'Source: Dictionary');
  assert.equal(await page.evaluate(() => fixture.translationCalls.length), 0, 'Dictionary hits do not invoke Google Translate');
  assert.match(await bank.innerText(), /図書館[\s\S]*としょかん[\s\S]*library/);
  assert.equal((await stored('first')).vocabulary[0].query, '図書館');
  await selectJapanese(); await page.waitForFunction(() => fixture.calls >= 2); await count(1);
  await selectAnswer('book'); await count(2);
  assert.match(await cards.first().innerText(), /book[\s\S]*本[\s\S]*ほん[\s\S]*書籍[\s\S]*しょせき/);
  assert.equal(await page.locator('.reading-answer').first().inputValue(), 'book');
  await selectAnswer('unmatched'); await page.getByText('Could not look up or translate this selection. Please try again.', { exact: true }).waitFor(); await count(2);
  await selectAnswer('failure'); await page.getByText('Could not look up or translate this selection. Please try again.', { exact: true }).waitFor(); await count(2);
  await page.reload(); await count(2);
  console.log('Lookup results, deduplication, and reload passed.');
  await bank.getByRole('button', { name: 'Collapse', exact: true }).click();
  assert.equal(await bank.locator('.vocab-list').isVisible(), false);
  await bank.getByRole('button', { name: 'Expand', exact: true }).click();
  await page.getByRole('button', { name: 'English → Japanese', exact: true }).click(); await count(2);
  await page.locator('.reading-activity-option').filter({ hasText: 'Read aloud' }).click();
  assert.equal(await bank.count(), 0);
  await selectJapanese(); await page.locator('.reading-dictionary-result').getByText('library', { exact: true }).waitFor();
  assert.equal((await stored('first')).vocabulary.length, 2);
  await page.locator('.reading-activity-option').filter({ hasText: 'Translate' }).click(); await count(2);
  await page.getByRole('button', { name: 'Japanese → English', exact: true }).click();
  await page.getByRole('button', { name: 'New attempt', exact: true }).click(); await count(0);
  await page.locator('[data-reading-session="first"] .reading-session-open').click(); await count(2);
  console.log('Collapse, translation directions, read aloud, and new attempts passed.');

  // A delayed response belongs to the session in which it was requested.
  await page.evaluate(() => { fixture.delayed = true; });
  await selectAnswer('pending'); await page.waitForFunction(() => typeof fixture.resolve === 'function');
  await page.locator('[data-reading-session="second"] .reading-session-open').click();
  await page.evaluate(() => { fixture.resolve(); fixture.resolve = null; });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('jc_reading_sessions:guest')).entries.first.session.vocabulary.length === 3);
  await count(0);
  await page.locator('[data-reading-session="first"] .reading-session-open').click(); await count(3);
  await selectAnswer('cleared'); await page.waitForFunction(() => typeof fixture.resolve === 'function');
  await bank.getByRole('button', { name: 'Clear', exact: true }).click(); await count(0);
  await page.evaluate(() => { fixture.resolve(); fixture.resolve = null; fixture.delayed = false; });
  assert.equal((await stored('first')).vocabulary.length, 0);
  await page.reload(); await count(0);
  console.log('Late results and clearing passed.');

  await selectJapanese(); await count(1);
  await selectAnswer('book'); await count(2); await page.keyboard.press('Escape');
  const articleBox = await page.locator('.reading-content').boundingBox(), bankBox = await bank.boundingBox();
  assert.ok(bankBox.x >= articleBox.x + articleBox.width, 'Desktop bank is to the right of the article');
  assert.equal(await bank.evaluate(node => getComputedStyle(node).minHeight), '0px', 'Bank does not inherit the article panel minimum height');
  const screenshots = await mkdtemp(path.join(tmpdir(), 'jc-reading-vocabulary-'));
  await page.screenshot({ path: path.join(screenshots, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Saved sessions', exact: true }).click();
  const mobileArticle = await page.locator('.reading-content').boundingBox(), mobileBank = await bank.boundingBox();
  assert.ok(mobileBank.y >= mobileArticle.y + mobileArticle.height, 'Mobile bank follows the article');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout has no horizontal overflow');
  await page.screenshot({ path: path.join(screenshots, 'mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1536, height: 1100 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; fixture.update({ language: 'ja' }); });
  assert.match(await bank.innerText(), /語彙/);
  await page.screenshot({ path: path.join(screenshots, 'light-japanese.png'), fullPage: true });

  await page.evaluate(() => { fixture.delayed = true; });
  await selectAnswer('account'); await page.waitForFunction(() => typeof fixture.resolve === 'function');
  await page.evaluate(() => { fixture.update({ owner: 'other-account' }); fixture.resolve(); fixture.resolve = null; });
  assert.equal((await stored('first')).vocabulary.length, 2);
  assert.equal(await bank.count(), 0);

  // Exercise the Google Translate fallback in both languages and keep its attribution after reload.
  await page.evaluate(() => { fixture.delayed = false; fixture.translationFails = false; fixture.update({ owner: 'guest', language: 'en' }); });
  await count(2);
  await selectAnswer('unmatched'); await count(3);
  assert.equal(await page.locator('.reading-dictionary-source').innerText(), 'Source: Google Translate');
  assert.match(await cards.first().innerText(), /対応する語[\s\S]*Source: Google Translate/);
  await page.getByRole('button', { name: 'Copy word: 対応する語', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => fixture.translationCalls.at(-1)), { text: 'unmatched', targetLanguage: 'ja' });
  await selectAnswer('unmatched'); await count(3);
  await selectAnswer('failure'); await count(4);
  await page.evaluate(() => { fixture.dictionaryThrows = true; });
  await selectAnswer('不明語'); await count(5);
  assert.deepEqual(await page.evaluate(() => fixture.translationCalls.at(-1)), { text: '不明語', targetLanguage: 'en' });
  assert.match(await page.locator('.reading-dictionary-result').innerText(), /unmatched term/);
  assert.equal((await stored('first')).vocabulary[0].entries[0].reading, '');
  await selectAnswer('不明語');
  await page.locator('.reading-dictionary:not([hidden]) .reading-dictionary-source').waitFor();
  await page.locator('.reading-dictionary').screenshot({ path: path.join(screenshots, 'google-translate-dialog.png') });
  await page.reload(); await count(5);
  assert.match(await cards.first().innerText(), /Source: Google Translate/);

  // Read aloud does not invoke the translate-mode fallback.
  await page.evaluate(() => { fixture.dictionaryThrows = true; });
  await page.locator('.reading-activity-option').filter({ hasText: 'Read aloud' }).click();
  await selectJapanese(); await page.getByText('Dictionary lookup failed. Please try again.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => fixture.translationCalls.length), 0);
  await page.locator('.reading-activity-option').filter({ hasText: 'Translate' }).click(); await count(5);
  await page.evaluate(() => { fixture.translationFails = false; fixture.translationEmpty = true; });
  await selectAnswer('empty'); await page.getByText('Could not look up or translate this selection. Please try again.', { exact: true }).waitFor(); await count(5);

  // A delayed translation cannot restore a cleared bank or cross accounts.
  await page.evaluate(() => { fixture.translationEmpty = false; fixture.translationDelayed = true; });
  await selectAnswer('cleared fallback'); await page.waitForFunction(() => typeof fixture.resolveTranslation === 'function');
  await page.getByText('Dictionary unavailable. Trying Google Translate…', { exact: true }).waitFor();
  await bank.getByRole('button', { name: 'Clear', exact: true }).click(); await count(0);
  await page.evaluate(() => { fixture.resolveTranslation(); fixture.resolveTranslation = null; });
  assert.equal((await stored('first')).vocabulary.length, 0);
  await selectAnswer('account fallback'); await page.waitForFunction(() => typeof fixture.resolveTranslation === 'function');
  await page.evaluate(() => { fixture.update({ owner: 'other-account' }); fixture.resolveTranslation(); fixture.resolveTranslation = null; });
  assert.equal((await stored('first')).vocabulary.length, 0);
  console.log('Google Translate fallback, dialog source footer, and persisted attribution passed.');
  assert.deepEqual(errors, []);
  console.log(`Reading vocabulary Chrome checks passed. Screenshots: ${screenshots}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
