// Run against an isolated local dev database. Creates and deletes one empty baseline; no model or microphone calls.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

if (process.env.TUTOR_DIAGNOSTIC_BROWSER !== '1') throw new Error('Use an isolated local database and opt in with TUTOR_DIAGNOSTIC_BROWSER=1.');
const url = process.env.TUTOR_DIAGNOSTIC_URL || 'http://localhost:5174';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('This check must not modify production sessions.');
const output = '/tmp/jc-baseline-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ permissions: ['microphone'] });
let sessionId;
let lessonSessionId;
try {
  const created = await context.request.post(`${url}/api/tutor/v2/diagnostic`, { data: {} });
  assert.equal(created.status(), 201, await created.text());
  sessionId = (await created.json()).session.id;
  const ended = await context.request.post(`${url}/api/tutor/v2/sessions/${sessionId}/end`, { data: {} });
  assert.equal(ended.status(), 200, await ended.text());
  assert.equal((await ended.json()).session.status, 'paused');
  const planResponse = await context.request.post(`${url}/api/tutor/v2/learning-plan`, { data: {} });
  assert.equal(planResponse.status(), 200);
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await page.locator('#page-nav-tutor').click();
    await page.locator('#tutor-diagnostic').filter({ hasText: 'Resume baseline' }).waitFor();
    await page.locator('#tutor-learning-plan').waitFor();
    assert.equal(await page.locator('#tutor-learning-plan li').count(), 5);
    await page.screenshot({ path: `${output}/${name}-plan.png`, fullPage: true });
    await page.locator('#tutor-view-sessions').click();
    const entry = page.locator('.tutor-log-item').filter({ has: page.locator(`[data-session-id="${sessionId}"]`) });
    await entry.waitFor();
    assert.match(await entry.innerText(), /Baseline incomplete/);
    assert.equal(await entry.locator('.tutor-session-resume').count(), 1);
    await page.screenshot({ path: `${output}/${name}-sessions.png`, fullPage: true });
    await page.locator('#tutor-view-progress').click();
    await page.locator('#tutor-progress-dimensions .tutor-diagnostic-findings').waitFor();
    assert.match(await page.locator('#tutor-progress-dimensions').innerText(), /Not assessed/);
    assert.match(await page.locator('#tutor-progress-levels').innerText(), /Valid answers/);
    assert.doesNotMatch(await page.locator('#tutor-progress-levels').innerText(), /A1\s*\d+%/);
    await page.screenshot({ path: `${output}/${name}-progress.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${name} must not overflow horizontally`);
    const clipped = await page.locator('#tutor-benchmark').evaluate(button => {
      const rect = button.getBoundingClientRect();
      const parent = button.closest('#tutor-page').getBoundingClientRect();
      return rect.right > parent.right || rect.left < parent.left;
    });
    assert.equal(clipped, false, `${name} benchmark button must not be clipped`);
  }
  await page.locator('#tutor-view-practice').click();
  let receiveConnect;
  const connection = new Promise(resolve => { receiveConnect = resolve; });
  await page.route('**/api/tutor/v2/sessions/*/connect', route => receiveConnect(route));
  await page.locator('#tutor-diagnostic').click();
  await page.locator('#tutor-baseline-progress').waitFor();
  assert.equal(await page.locator('#tutor-learning-plan').isVisible(), false);
  assert.match(await page.locator('#tutor-baseline-progress').innerText(), /0 of 4 areas sampled/);
  assert.match(await page.locator('#tutor-baseline-progress').innerText(), /active/);
  await page.screenshot({ path: `${output}/mobile-active-baseline.png`, fullPage: true });
  const connectRoute = await connection;
  await connectRoute.fulfill({ status: 503, body: 'Intentional local connection failure' });
  await page.unroute('**/api/tutor/v2/sessions/*/connect');
  await page.reload(); await page.locator('#page-nav-tutor').click();
  const lessonRequest = page.waitForRequest(request => request.url().endsWith('/api/tutor/v2/sessions') && request.method() === 'POST');
  const lessonResponse = page.waitForResponse(response => response.url().endsWith('/api/tutor/v2/sessions') && response.request().method() === 'POST');
  await page.route('**/api/tutor/v2/sessions/*/connect', route => route.fulfill({ status: 503, body: 'Intentional local connection failure' }));
  await page.locator('#tutor-learning-plan button').filter({ hasText: 'Start lesson 1' }).click();
  assert.ok((await lessonRequest).postDataJSON().planLessonId);
  lessonSessionId = (await (await lessonResponse).json()).session.id;
  assert.deepEqual(errors, []);
  console.log(`Desktop/mobile baseline history and progress passed. Screenshots: ${output}`);
} finally {
  if (sessionId) await context.request.delete(`${url}/api/tutor/v2/sessions/${sessionId}`);
  if (lessonSessionId) await context.request.delete(`${url}/api/tutor/v2/sessions/${lessonSessionId}`);
  await browser.close();
}
