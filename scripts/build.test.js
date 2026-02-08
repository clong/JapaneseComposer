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

  const html = await fs.readFile(buildPath('dist/index.html'), 'utf8');
  assert.ok(!html.includes('@@BUILD_TIMESTAMP@@'));
});
