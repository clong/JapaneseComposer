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
  assert.match(source, /const LOOKUP_START_INTERVAL_MS = 250;/);
  assert.match(source, /const LOOKUP_REQUEST_TIMEOUT_MS = 10000;/);
  assert.match(source, /const LOOKUP_VISIBLE_ROOT_MARGIN = '600px 0px';/);
  assert.match(source, /const LOOKUP_INTERSECTION_FALLBACK_LIMIT = 12;/);
  assert.match(source, /const LOOKUP_SYNTHETIC_AUTO_LIMIT = 16;/);
  assert.match(source, /const LOOKUP_MISS_TTL_MS = 10 \* 60 \* 1000;/);
  assert.match(source, /const LOOKUP_ERROR_TTL_MS = 60 \* 1000;/);
  assert.match(source, /const lookupCooldownCache = new Map\(\);/);
  assert.match(source, /function processLookupQueue\(\)/);
  assert.match(source, /activeLookupCount < LOOKUP_CONCURRENCY_LIMIT/);
  assert.match(source, /lastLookupStartAt \+ LOOKUP_START_INTERVAL_MS/);
  assert.match(source, /function observePreviewLookupElement/);
  assert.match(source, /resetPreviewLookupObserver\(\);\s+preview\.replaceChildren\(\);/);
  assert.match(source, /observePreviewLookupElement\(tokenElement, lookupWord\);/);
  assert.doesNotMatch(
    source,
    /function renderPreview\(\)[\s\S]*ensureLookup\(lookupWord\)[\s\S]*function getActiveGalleryImage/
  );
  assert.match(source, /function cacheLookupCooldown/);
  assert.doesNotMatch(source, /lookupCache\.delete\(/);
});

test('server lookup and translation requests are cached and bounded', async () => {
  const source = await readSource('scripts/dev.js');

  assert.match(source, /const lookupResponseCache = new Map\(\);/);
  assert.match(source, /const translationResponseCache = new Map\(\);/);
  assert.match(source, /const JISHO_LOOKUP_TIMEOUT_MS = 2500;/);
  assert.match(source, /const JISHO_LOOKUP_CONCURRENCY_LIMIT = 2;/);
  assert.match(source, /const JISHO_UPSTREAM_COOLDOWN_MS = 15000;/);
  assert.match(source, /const TRANSLATION_TIMEOUT_MS = 10000;/);
  assert.match(source, /activeJishoLookupCount >= JISHO_LOOKUP_CONCURRENCY_LIMIT/);
  assert.match(source, /fetchWithTimeout\(/);
  assert.match(source, /lookupStatus: 'error'/);
  assert.match(source, /JAPANESE_TEXT_REGEX\.test\(text\)/);
  assert.match(source, /requestedTargetLanguage = \['ja', 'en'\]\.includes\(body\?\.targetLanguage\)/);
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

test('tutor realtime and persistence use server-owned tokens and audio tables', async () => {
  const appSource = await readSource('src/app.js');
  const serverSource = await readSource('scripts/dev.js');
  const v2ServerSource = await readSource('scripts/tutor-v2-server.js');
  const transportSource = await readSource('src/tutor-v2-transport.js');

  assert.match(appSource, /const TUTOR_REALTIME_TOKEN_ENDPOINT = '\/api\/tutor\/realtime-token';/);
  assert.match(appSource, /fetch\('https:\/\/api\.openai\.com\/v1\/realtime\/calls'/);
  assert.match(appSource, /type: 'session\.update'/);
  assert.match(appSource, /speed: speechRate/);
  assert.match(appSource, /voice: tutorState\.voice/);
  assert.match(appSource, /normalizeTutorVoice/);
  assert.match(appSource, /TUTOR_VOICES/);
  assert.match(appSource, /isTutorVoiceLocked/);
  assert.match(appSource, /transcriptionLanguage: tutorState\.transcriptionLanguage/);
  assert.match(appSource, /language/);
  assert.match(appSource, /vocabularyLevel: tutorState\.vocabularyLevel/);
  assert.match(appSource, /TUTOR_RESPONSE_WATCHDOG_MS = 7000/);
  assert.match(appSource, /scheduleTutorResponseWatchdog/);
  assert.match(appSource, /transcriptShouldAutoScroll/);
  assert.match(appSource, /scrollTutorTranscriptToBottom/);
  assert.match(appSource, /assistantTurnIdsByResponseId/);
  assert.match(appSource, /mappedAssistantItemTurnId/);
  assert.match(appSource, /!itemId \? mappedAssistantResponseTurnId : ''/);
  assert.match(appSource, /normalizeTutorTranscriptText/);
  assert.match(appSource, /normalizeTutorTranscriptDelta/);
  assert.match(appSource, /isLikelyTutorPlaybackEcho/);
  assert.match(appSource, /tutorAudioOutputActive/);
  assert.doesNotMatch(appSource, /model: 'gpt-realtime-whisper',\s*prompt:/);
  assert.match(appSource, /ignoredUserTranscriptionItemIds/);
  assert.match(appSource, /removeTutorTurnByItemId/);
  assert.match(appSource, /output_audio_buffer\.cleared/);
  assert.match(appSource, /normalizeTutorResponseStatus/);
  assert.match(appSource, /return 'interrupted'/);
  assert.match(appSource, /tutorResponseIncomplete/);
  assert.match(appSource, /type: 'realtime'/);
  assert.match(appSource, /type === 'response\.created'/);
  assert.match(appSource, /tutor-turn-thinking/);
  assert.match(appSource, /function appendTutorTranscriptText/);
  assert.match(appSource, /buildTokenElement\(/);
  assert.match(appSource, /className = 'tutor-turn-translate'/);
  assert.match(appSource, /requestTranslation\(source, \{ targetLanguage: 'en' \}\)/);
  assert.match(appSource, /listTutorV2Sessions\(\)/);
  assert.match(appSource, /deleteTutorSpeakingSession/);
  assert.doesNotMatch(appSource, /OPENAI_API_KEY/);
  assert.match(appSource, /connectTutorV2WebRtc/);
  assert.match(appSource, /getTutorV2Session/);
  assert.match(appSource, /directorStatus === 'assessing'/);
  assert.match(appSource, /sidebandConnected/);
  assert.match(appSource, /requestTutorResponse\('assessment_completed'\)/);
  assert.match(appSource, /event\.item\?\.type === 'function_call'/);
  assert.match(appSource, /Current lesson instruction:/);
  assert.match(appSource, /itemType: event\.item\.type/);
  assert.match(transportSource, /connectTutorV2Sdp/);
  assert.doesNotMatch(transportSource, /Authorization/);

  assert.match(serverSource, /requestUrl\.pathname === '\/api\/tutor\/realtime-token'/);
  assert.match(serverSource, /https:\/\/api\.openai\.com\/v1\/realtime\/client_secrets/);
  assert.match(serverSource, /max_output_tokens: 900/);
  assert.match(serverSource, /interrupt_response: false/);
  assert.match(serverSource, /normalizeTutorVoice/);
  assert.match(serverSource, /voice,/);
  assert.match(serverSource, /normalizeTutorTranscriptionLanguage/);
  assert.match(serverSource, /language: transcriptionLanguage/);
  assert.match(serverSource, /speed: speechRate/);
  assert.match(serverSource, /Vocabulary baseline:/);
  assert.match(serverSource, /describeTutorVocabularyLevel/);
  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS user_tutor_sessions/);
  assert.match(serverSource, /CREATE TABLE IF NOT EXISTS user_tutor_audio/);
  assert.match(serverSource, /TUTOR_AUDIO_PATH_PREFIX = '\/api\/tutor-audio\/';/);
  assert.match(serverSource, /requestUrl\.pathname\.startsWith\(TUTOR_AUDIO_PATH_PREFIX\)/);
  assert.match(serverSource, /createTutorV2Service/);
  assert.match(v2ServerSource, /https:\/\/api\.openai\.com\/v1\/realtime\/calls/);
  assert.doesNotMatch(v2ServerSource, /https:\/\/api\.openai\.com\/v1\/realtime\/client_secrets/);
  assert.match(v2ServerSource, /formData\.set\('session'/);
  assert.match(v2ServerSource, /wss:\/\/api\.openai\.com\/v1\/realtime\?call_id=/);
  assert.match(v2ServerSource, /create_response: false/);
  assert.match(v2ServerSource, /conversation\.item\.input_audio_transcription\.completed/);
  assert.match(v2ServerSource, /tutor\.playback_echo_suppressed/);
  assert.match(v2ServerSource, /type: 'conversation\.item\.delete'/);
  assert.match(v2ServerSource, /resolveTutorAssistantTurnId/);
  assert.match(v2ServerSource, /user_tutor_mastery_evidence/);
  assert.match(v2ServerSource, /user_tutor_audio_analysis_v2/);
});
