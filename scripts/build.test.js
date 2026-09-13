import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function buildPath(...parts) {
  return path.join(root, ...parts);
}

test('build completes and outputs artifacts', async () => {
  await execFileAsync(process.execPath, [buildPath('scripts/build.js')]);

  const distDir = buildPath('dist');
  await fs.access(buildPath('dist/index.html'));
  await fs.access(buildPath('dist/assets/app.js'));
  await fs.access(buildPath('dist/assets/app.css'));
  await fs.access(buildPath('dist/THIRD_PARTY_NOTICES.md'));
  for (const id of ['pikachu']) {
    await fs.access(buildPath(`dist/assets/tutor/${id}.glb`));
    await fs.access(buildPath(`dist/assets/tutor/${id}.webp`));
    await fs.access(buildPath(`dist/assets/tutor/${id}-thumb.webp`));
  }
  await fs.access(buildPath('dist/assets/tutor/preview-ja.wav'));
  await fs.access(buildPath('dist/assets/vendor/headaudio/headworklet.mjs'));
  await fs.access(buildPath('dist/assets/vendor/headaudio/model-ja-en.bin'));

  const html = await fs.readFile(buildPath('dist/index.html'), 'utf8');
  assert.ok(!html.includes('@@BUILD_TIMESTAMP@@'));
  assert.ok(html.includes('id="image-gallery-grid"'));
  assert.ok(html.includes('id="image-lightbox"'));
  for (const page of ['compose', 'vocabulary', 'reading', 'tutor']) {
    assert.equal(html.split(`id="page-nav-${page}"`).length - 1, 1);
    assert.equal(html.split(`id="${page}-page"`).length - 1, 1);
  }
  assert.ok(html.includes('id="text-size-controls"'));
  assert.ok(html.includes('id="page-nav-tutor"'));
  assert.ok(html.includes('id="tutor-page"'));
  assert.ok(html.includes('id="tutor-avatar"'));
  assert.ok(html.includes('Pikachu'));
  assert.ok(!html.includes('data-avatar-id='), 'The retired four-character picker is absent.');
  assert.ok(html.includes('id="tutor-stage-activity"'));
  assert.ok(html.includes('id="tutor-voice"'));
  assert.ok(html.includes('id="tutor-speech-rate"'));
  assert.ok(html.includes('id="tutor-transcription-language"'));
  assert.ok(html.includes('id="tutor-vocab-level"'));
  assert.ok(html.includes('id="tutor-log-list"'));
  assert.ok(html.includes('id="tutor-view-sessions"'));
  assert.ok(html.includes('id="tutor-sessions-view"'));
  assert.ok(html.includes('id="tutor-v2-today"'));
  assert.ok(html.includes('id="tutor-mission-title"'));
  assert.ok(html.includes('id="tutor-current-goal"'));
  assert.ok(html.includes('id="tutor-repeat"'));
  assert.ok(html.includes('id="tutor-try-again"'));
  assert.ok(html.includes('id="tutor-progress-view"'));
  assert.ok(html.includes('id="tutor-progress-dimensions"'));
  assert.ok(html.includes('id="tutor-external-speech-consent"'));

  const appJs = await fs.readFile(buildPath('dist/assets/app.js'), 'utf8');
  assert.ok(!appJs.includes('./tutor-utils.js'));
  assert.ok(!appJs.includes('./tutor-v2-api.js'));
  assert.ok(!appJs.includes('./tutor-v2-transport.js'));
  assert.ok(!appJs.includes('./tutor-live.js'));
});
