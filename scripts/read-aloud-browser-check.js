// Browser-only integration checks. Bundle with esbuild and serve alongside the app CSS.
import { createReadAloud } from '../src/read-aloud.js';
import { createReadingSession } from '../src/reading-model.js';
import { encodeWav, inspectWav } from '../src/read-aloud-wav.js';
import { ReadingRecorder } from '../src/read-aloud-recorder.js';
const article = { id: 'nhkeasier-123', title: '図書館のニュース', titleSegments: [{ text: '図書館', reading: 'としょかん' }, { text: 'のニュース', reading: '' }],
  sourceUrl: 'https://www3.nhk.or.jp/news/easy/test/test.html', providerUrl: 'https://nhkeasier.com/story/123/', sentences: [
    { id: 'one', text: '図書館に本があります。', paragraph: 0 }, { id: 'two', text: '今日は休みです。', paragraph: 1 }
  ] };
let session = createReadingSession(article, 'browser-test'), options, recorderClosed = 0, failure = false, pendingResolve, playbackReady = false;
const panel = document.querySelector('#fixture'), report = document.querySelector('#results');
const bytes = encodeWav([new Float32Array(48000)], 24000);
const makeReview = (body) => ({ review: { id: body.id, sentenceIds: body.sentenceIds, transcript: '図書館に本があります。', duration: 2, summary: 'Nice work! Try a short pause between the two sentences.',
  ratings: { accuracy: 'clear', pronunciation: 'clear', pacing: 'practice' }, tips: [{ category: 'pacing', sentenceId: body.sentenceIds[0], text: 'Give the sentence ending a little breathing room.' }],
  sentences: body.sentenceIds.map((id) => ({ id, status: id === 'two' ? 'unfinished' : 'read', observation: id === 'two' ? 'You stopped before this sentence.' : 'The words were clear.', start: id === 'two' ? null : .1, end: id === 'two' ? null : 1.8 })), referenceUsed: false, createdAt: Date.now() } });
const controller = createReadAloud({ request: async (_, options) => {
    if (options.body.retry) playbackReady = true;
    return { timings: playbackReady ? [{ id: 'one', start: 0, end: 1 }, { id: 'two', start: 1, end: 2 }] : [], audioPath: '/media/mp3/fixture.mp3' };
  }, getSession: () => session,
  save: (s) => { session = JSON.parse(JSON.stringify(s)); },
  recordFactory: (o) => { options = o; return { start: async () => {}, stop: async () => bytes, close: async () => { recorderClosed++; } }; },
  submit: async (body) => { if (failure) throw new Error('Controlled temporary failure'); if (pendingResolve) return new Promise((resolve) => { pendingResolve = () => resolve(makeReview(body)); }); return makeReview(body); }
});
const mount = (owner = 'guest') => controller.mount(panel, session, { owner, language: 'en', furigana: true,
  appendJapanese: (n, s) => { n.textContent = s.text; } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const click = (label) => { const b = [...panel.querySelectorAll('button')].find((b) => b.textContent === label); if (!b || b.disabled) throw new Error(`Unavailable control: ${label}`); b.click(); };
const assert = (condition, text) => { if (!condition) throw new Error(text); const line = document.createElement('p'); line.textContent = `PASS: ${text}`; report.append(line); };
async function run() {
  mount(); await tick();
  assert(panel.querySelector('#reading-reference-status').textContent.includes('start/end times'), 'Missing sentence timing has a visible explanation');
  assert([...panel.querySelectorAll('button')].filter((b) => b.textContent === 'Listen to the reference audio for this sentence').every((b) => b.disabled), 'Sentence playback stays disabled without reliable timings');
  click('Retry sentence playback'); await tick();
  assert([...panel.querySelectorAll('button')].filter((b) => b.textContent === 'Listen to the reference audio for this sentence').every((b) => !b.disabled), 'Retry enables sentence playback when reliable timings become available');
  click('Read this sentence'); await tick();
  options.onUpdate({ duration: 4, level: .5, transcript: '図書館に本があります。', provisional: true, live: 'failed' });
  assert(panel.querySelector('[data-aloud-transcript]').textContent.includes('図書館'), 'Live transcript appears during recording');
  assert(panel.textContent.includes('Your recording is still being captured'), 'Transcription failure preserves recording');
  assert(panel.querySelector('[data-aloud-sentence="one"]').classList.contains('is-reading'), 'Current sentence is highlighted');
  click('Stop and review'); await tick();
  assert(session.reviews.length === 1, 'Sentence review is saved');
  assert(panel.querySelectorAll('.reading-aloud-ratings strong').length === 3, 'Three friendly ratings are visible');
  const firstRow = panel.querySelector('[data-aloud-sentence="one"]');
  assert(firstRow.querySelector('.reading-aloud-feedback')?.textContent.includes('Nice work!'), 'Sentence feedback appears under its source sentence');
  assert(firstRow.querySelector('.reading-aloud-feedback')?.textContent.includes('The words were clear.'), 'Single-sentence feedback preserves the sentence observation alongside the summary');
  assert(firstRow.querySelectorAll('.reading-feedback-points li').length >= 3, 'Reading feedback uses bullet points');
  assert(!panel.querySelector('[data-aloud-sentence="two"] .reading-aloud-feedback'), 'Unpracticed sentences have no unrelated feedback');
  assert(Boolean(panel.querySelector('audio[src^="blob:"]')), 'Current attempt can be replayed');
  assert(!JSON.stringify(session).includes('blob:'), 'Recording URLs are excluded from saved sessions');
  failure = true; click('Read whole article'); await tick(); click('Stop and review'); await tick();
  assert(panel.textContent.includes('Controlled temporary failure'), 'Failed reviews retain a retry action');
  failure = false; click('Retry'); await tick();
  assert(session.reviews.length === 2 && session.reviews[0].sentenceIds.length === 2, 'Whole-article retry preserves and reviews both sentences');
  assert(panel.querySelector('[data-aloud-sentence="one"] > .reading-aloud-feedback li').textContent.includes('words were clear'), 'Whole-article observations appear below the matching sentence');
  assert(panel.querySelector('[data-aloud-sentence="two"] > .reading-aloud-feedback').textContent.includes('Unfinished'), 'Unfinished passages are identified beneath the sentence');
  assert(Boolean(panel.querySelector('[data-aloud-sentence="one"] .reading-earlier-feedback')), 'Earlier sentence attempts remain accessible');
  assert(!panel.querySelector('.reading-aloud-review').textContent.includes('Give the sentence ending'), 'Sentence-specific tips are shown inline instead of duplicated in the article review');
  click('Read this sentence'); await tick(); click('Cancel'); await tick();
  assert(recorderClosed > 0 && !panel.querySelector('audio[src^="blob:"]'), 'Cancel releases recorder and temporary playback');
  click('Read this sentence'); await tick();
  assert(!panel.querySelector('.reading-reference audio').controls, 'Reference controls are hidden while the microphone is active');
  controller.leave(); mount(); await tick();
  assert(panel.querySelector('.reading-reference audio').controls, 'Leaving a recording restores reference controls when the article reopens');
  click('Read whole article'); await tick(); options.onLimit(); await tick();
  assert(session.reviews.length === 3, 'Recording limit automatically stops and reviews');
  pendingResolve = true; click('Read whole article'); await tick(); click('Stop and review'); await tick();
  controller.leave(); session = createReadingSession(article, 'different-account-session'); mount('another-account'); await tick();
  pendingResolve(); await tick(); pendingResolve = null;
  assert(session.reviews.length === 0, 'Late results cannot cross session or account changes');
  click('Read this sentence'); await tick(); click('Stop and review'); await tick();
  const snapshot = JSON.stringify(session); controller.leave(); session = JSON.parse(snapshot); mount(); await tick();
  assert(panel.textContent.includes('Audio is no longer available'), 'Reopening keeps feedback and explains missing temporary audio');
  click('Delete review'); await tick(); assert(session.reviews.length === 0, 'Saved reviews can be deleted');
  click('Read whole article'); await tick(); click('Stop and review'); await tick();
  const captureButton = document.createElement('button'); captureButton.textContent = 'Check audio capture'; captureButton.className = 'reading-button primary';
  report.prepend(captureButton);
  captureButton.addEventListener('click', () => { captureButton.disabled = true; void checkCapture().catch((e) => { report.dataset.status = 'failed'; report.textContent += `FAIL: ${e.message}`; }); });
}
async function checkCapture() {
  const reference = panel.querySelector('.reading-reference audio');
  reference.load();
  const sentenceListen = panel.querySelector('[data-aloud-sentence="two"] .reading-actions button:last-child');
  sentenceListen.click();
  for (let attempt = 0; attempt < 50 && reference.currentTime < 1; attempt++) await tick();
  assert(reference.currentTime >= 1 && !reference.error, 'First sentence playback seeks correctly after loading audio metadata');
  reference.pause();
  await tick();
  assert(!panel.querySelector('#reading-reference-status').textContent.includes('unavailable'), 'Pausing during playback startup does not mark the reference unavailable');
  const audioContext = new AudioContext();
  await audioContext.resume();
  const oscillator = audioContext.createOscillator(), destination = audioContext.createMediaStreamDestination();
  oscillator.connect(destination); oscillator.start();
  const capture = new ReadingRecorder({ getStream: async () => destination.stream, request: async () => { throw new Error('No live API in browser checks'); },
    limit: 3, onUpdate: () => {}, onLimit: () => {}, onInterruption: () => {} });
  await capture.start(); await new Promise((resolve) => setTimeout(resolve, 350));
  const captured = await capture.stop();
  oscillator.stop(); await audioContext.close();
  assert(inspectWav(captured).duration > .1, 'Real AudioWorklet captures a synthetic stream as valid WAV');
  assert(destination.stream.getTracks().every((track) => track.readyState === 'ended'), 'Recorder closes media tracks after stopping');
  report.dataset.status = 'passed'; report.prepend(Object.assign(document.createElement('strong'), { textContent: 'All Read aloud browser checks passed.' }));
}
run().catch((error) => { report.dataset.status = 'failed'; report.textContent += `FAIL: ${error.message}`; });
