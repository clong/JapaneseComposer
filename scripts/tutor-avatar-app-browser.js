// Point at an isolated local dev server; this changes its anonymous preferences.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!process.env.TUTOR_AVATAR_APP_URL) throw new Error('Set TUTOR_AVATAR_APP_URL to an isolated local dev server.');
const url = new URL(process.env.TUTOR_AVATAR_APP_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Use a local test server.');
const output = resolve(process.env.TUTOR_AVATAR_QA_DIR || '/tmp/jc-avatar-app');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 },
  recordVideo: { dir: output, size: { width: 1440, height: 1100 } } });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(url.href);
  // A returning user can still have one of the retired appearances stored locally.
  await page.evaluate(() => localStorage.setItem('jc_tutor_avatar', 'mika'));
  await page.reload();
  await page.locator('#page-nav-tutor').click();
  await page.locator('[data-avatar-motion]').selectOption('auto');
  await page.waitForFunction(() => document.querySelector('.tutor-avatar-canvas:not(.is-loading) canvas') && !document.querySelector('.tutor-avatar-canvas.is-loading'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.tutor-avatar-canvas')).opacity === '1');
  assert.equal(await page.locator('[data-avatar-name]').textContent(), 'Pikachu');
  assert.equal(await page.locator('[data-avatar-id]').count(), 0);
  assert.equal(await page.locator('.tutor-avatar-canvas').count(), 1);
  checks.push('the application shows Pikachu and removes the retired character picker');
  await page.locator('#tutor-avatar').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/app-desktop.png` });
  await page.locator('[data-avatar-preview]').click();
  await page.waitForFunction(() => document.querySelector('[data-avatar-preview]').textContent === 'Stop preview');
  await page.locator('[data-avatar-motion]').selectOption('reduced');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-avatar-preview]').textContent(), 'Stop preview');
  checks.push('the prerecorded Japanese preview keeps playing when reduced motion is selected');
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('jc_tutor_avatar'), localStorage.getItem('jc_tutor_avatar_motion')]), ['pikachu', 'reduced']);
  await page.reload(); await page.locator('#page-nav-tutor').click();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('[data-avatar-name]').textContent(), 'Pikachu');
  assert.equal(await page.locator('[data-avatar-motion]').inputValue(), 'reduced');
  checks.push('legacy appearance normalizes to Pikachu and motion preference survives an application reload');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#tutor-avatar').evaluate(e => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#tutor-avatar').screenshot({ path: `${output}/app-mobile.png` });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const avatar = await page.locator('#tutor-avatar').boundingBox();
  const transcript = await page.locator('#tutor-transcript').boundingBox();
  assert.ok(transcript.y >= avatar.y + avatar.height, 'Mobile conversation follows the character.');
  checks.push('390 px layout has no horizontal overflow and stacks the character before the conversation');
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await page.video().saveAs(`${output}/app-pikachu-preview.webm`);
  await writeFile(`${output}/app-results.json`, JSON.stringify({ checks, errors, browser: browser.version() }, null, 2));
  await browser.close();
}
console.log(checks);
