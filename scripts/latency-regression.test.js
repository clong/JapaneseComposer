import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function readSource(relativePath) {
  return await fs.readFile(path.join(root, relativePath), 'utf8');
}

test('client dictionary lookups use cooldowns and a concurrency cap', async () => {
  const source = await readSource('src/app.js');

  assert.match(source, /const LOOKUP_CONCURRENCY_LIMIT = 4;/);
  assert.match(source, /const LOOKUP_MISS_TTL_MS = 10 \* 60 \* 1000;/);
  assert.match(source, /const LOOKUP_ERROR_TTL_MS = 60 \* 1000;/);
  assert.match(source, /const lookupCooldownCache = new Map\(\);/);
  assert.match(source, /function processLookupQueue\(\)/);
  assert.match(source, /activeLookupCount < LOOKUP_CONCURRENCY_LIMIT/);
  assert.match(source, /function cacheLookupCooldown/);
  assert.doesNotMatch(source, /lookupCache\.delete\(/);
});

test('server lookup and translation requests are cached and bounded', async () => {
  const source = await readSource('scripts/dev.js');

  assert.match(source, /const lookupResponseCache = new Map\(\);/);
  assert.match(source, /const translationResponseCache = new Map\(\);/);
  assert.match(source, /const JISHO_LOOKUP_TIMEOUT_MS = 5000;/);
  assert.match(source, /const TRANSLATION_TIMEOUT_MS = 10000;/);
  assert.match(source, /fetchWithTimeout\(/);
  assert.match(source, /lookupStatus: 'error'/);
  assert.match(source, /JAPANESE_TEXT_REGEX\.test\(text\)/);
  assert.doesNotMatch(source, /translate\/v2\/detect/);
});

test('workspace sync has focused document and image storage paths', async () => {
  const appSource = await readSource('src/app.js');
  const serverSource = await readSource('scripts/dev.js');

  assert.match(appSource, /const WORKSPACE_POLL_INTERVAL_MS = 30000;/);
  assert.match(appSource, /const WORKSPACE_DOCUMENT_ENDPOINT = '\/api\/workspace\/document';/);
  assert.match(appSource, /requestWorkspaceDocumentUpdate/);
  assert.match(appSource, /requestWorkspaceDocumentDelete/);

  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS user_workspace_images/);
  assert.match(serverSource, /WORKSPACE_IMAGE_PATH_PREFIX = '\/api\/workspace-image\/';/);
  assert.match(serverSource, /requestUrl\.pathname === '\/api\/workspace\/document'/);
  assert.match(serverSource, /requestUrl\.pathname\.startsWith\('\/api\/workspace\/document\/'\)/);
  assert.match(serverSource, /requestUrl\.pathname\.startsWith\(WORKSPACE_IMAGE_PATH_PREFIX\)/);
});
