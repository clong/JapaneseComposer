import { ReadingRecorder, submitAudioReview } from './read-aloud-recorder.js';
import { liveSentenceId, validateAloudReview } from './read-aloud-model.js';
import { newReadingId } from './reading-sync.js';

const texts = {
  en: {
    reference: 'Reference recording', listen: 'Listen', sentenceListen: 'Listen to this sentence', speed: 'Playback speed', whole: 'Read whole article', sentence: 'Read this sentence',
    disclosure: 'Your microphone audio is sent to OpenAI for transcription and feedback. Only transcripts and feedback are saved. Recordings are temporary and disappear when you leave this session.',
    stop: 'Stop and review', cancel: 'Cancel', recording: 'Recording', connecting: 'Connecting live transcript…', failedLive: 'Live transcription is unavailable. Your recording is still being captured for review.',
    transcript: 'Live transcript', provisional: 'Listening · transcript may change', final: 'Transcript', preparing: 'Preparing sentence playback…',
    retry: 'Retry', review: 'Review recording', reviewing: 'Listening to your recording…', warning: 'Recording will stop in {seconds} seconds.',
    start: 'Starting microphone…', level: 'Microphone activity', attempt: 'Your current recording', unavailable: 'Audio is no longer available for this saved review.',
    accuracy: 'Reading accuracy', pronunciation: 'Pronunciation', pacing: 'Pacing', clear: 'Clear', practice: 'Keep practicing', uncertain: 'Couldn’t assess',
    history: 'Saved reviews', empty: 'Read a sentence or the article to get feedback.', noReference: 'Reviewed without reference comparison.',
    delete: 'Delete review', replay: 'Replay your sentence', retrySentence: 'Try this sentence again', read: 'Read', skipped: 'Skipped', unfinished: 'Unfinished',
    duration: '{seconds} seconds', noTiming: 'Sentence timing is uncertain; use the full reference recording.', interruption: 'The microphone stopped. Reviewing the audio captured so far.',
    limit: 'Recording limit reached. Preparing your review.', temporary: 'Playback is available until you leave this session.', referenceError: 'Reference audio is unavailable. You can still record and get feedback.',
    microphoneError: 'Microphone access failed. Check your browser permissions and try again.'
  },
  ja: {
    reference: 'お手本の音声', listen: '聞く', sentenceListen: 'この文を聞く', speed: '再生速度', whole: '記事全体を音読', sentence: 'この文を音読',
    disclosure: '録音した音声は文字起こしとフィードバックのためにOpenAIに送信されます。保存されるのは文字起こしとフィードバックだけです。この練習を離れると録音は消去されます。',
    stop: '終了して確認', cancel: 'キャンセル', recording: '録音中', connecting: '文字起こしに接続中…', failedLive: 'リアルタイムの文字起こしは利用できません。採点用の録音は続いています。',
    transcript: 'リアルタイム文字起こし', provisional: '聞き取り中・文字起こしは変わることがあります', final: '文字起こし', preparing: '文ごとの再生を準備中…',
    retry: '再試行', review: '録音を確認', reviewing: '録音を確認しています…', warning: 'あと{seconds}秒で録音を終了します。',
    start: 'マイクを準備中…', level: 'マイクの音量', attempt: '今回の録音', unavailable: 'このレビューの録音は保存されていません。',
    accuracy: '読みの正確さ', pronunciation: '発音', pacing: '読むペース', clear: 'よく読めています', practice: '練習しましょう', uncertain: '判定できませんでした',
    history: '保存したレビュー', empty: '文や記事を音読してフィードバックを受けましょう。', noReference: 'お手本との比較なしで確認しました。',
    delete: 'レビューを削除', replay: '自分の音読を再生', retrySentence: 'この文をもう一度', read: '音読済み', skipped: '読み飛ばし', unfinished: '未完了',
    duration: '{seconds}秒', noTiming: '文の再生位置が不明です。お手本全体を再生してください。', interruption: 'マイクが停止しました。録音済みの音声を確認します。',
    limit: '録音時間の上限になりました。確認を始めます。', temporary: 'この練習を離れるまで録音を再生できます。', referenceError: 'お手本の音声を利用できません。録音とフィードバックは引き続き利用できます。',
    microphoneError: 'マイクを使用できません。ブラウザーの権限を確認してください。'
  }
};
const node = (tag, cls = '', text) => { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const control = (label, action, primary = false) => { const n = node('button', `reading-button ${primary ? 'primary' : 'ghost'}`, label); n.type = 'button'; n.addEventListener('click', action); return n; };
const format = (s, values) => s.replace(/\{(\w+)\}/g, (_, k) => values[k]);

export function createReadAloud({ request, getSession, save, recordFactory = (options) => new ReadingRecorder(options), submit = submitAudioReview }) {
  const root = node('section', 'reading-aloud');
  const referencePlayer = node('audio', 'reading-audio'); referencePlayer.controls = true; referencePlayer.preload = 'none';
  const learnerPlayer = node('audio', 'reading-audio'); learnerPlayer.controls = true;
  let key = '', sessionId = '', article, language = 'en', furigana, appendJapanese;
  let generation = 0, recorder, requestController, referenceController, reference, referenceBusy = false, referenceError = '', playbackError = '';
  let status = 'idle', error = '', notice = '', live = {}, currentSentence = '', currentAttempt, recordingBytes, recordingUrl, referenceEnd, learnerEnd;
  let limit = 300, speed = 1;
  const c = () => texts[language] || texts.en;
  const current = () => { const s = getSession(); return s?.id === sessionId ? s : null; };
  const busy = () => ['starting', 'recording', 'reviewing'].includes(status);
  referencePlayer.addEventListener('timeupdate', () => { if (referenceEnd != null && referencePlayer.currentTime >= referenceEnd) referencePlayer.pause(); });
  learnerPlayer.addEventListener('timeupdate', () => { if (learnerEnd != null && learnerPlayer.currentTime >= learnerEnd) learnerPlayer.pause(); });
  referencePlayer.addEventListener('error', () => { playbackError = c().referenceError; render(); });
  async function playReference(id) {
    if (busy()) return;
    const timing = id ? reference?.timings.find((t) => t.id === id) : null;
    if (id && !timing) return;
    learnerPlayer.pause(); referencePlayer.pause(); referenceEnd = timing?.end ?? null;
    try { referencePlayer.currentTime = timing?.start || 0; referencePlayer.playbackRate = speed; await referencePlayer.play(); }
    catch { playbackError = c().referenceError; render(); }
  }
  function playLearner(timing) {
    referencePlayer.pause(); learnerPlayer.pause(); learnerPlayer.currentTime = timing?.start || 0;
    learnerEnd = timing?.end ?? null; void learnerPlayer.play().catch(() => {});
  }
  function clearRecording() {
    learnerPlayer.pause(); learnerPlayer.removeAttribute('src');
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = null; recordingBytes = null;
  }
  function leave() {
    generation++; void recorder?.close(); recorder = null;
    requestController?.abort(); referenceController?.abort();
    referencePlayer.pause(); referencePlayer.removeAttribute('src'); clearRecording();
    key = ''; sessionId = ''; article = null; currentAttempt = null; status = 'idle'; reference = null; referenceBusy = false;
    referenceError = ''; playbackError = ''; error = ''; notice = ''; live = {}; currentSentence = ''; root.replaceChildren();
  }
  async function prepareReference() {
    if (!article || referenceBusy) return;
    const token = key; referenceBusy = true; referenceError = ''; render();
    referenceController?.abort(); referenceController = new AbortController();
    try {
      const data = await request('read-aloud/reference', { method: 'POST', body: { article }, signal: referenceController.signal });
      if (key !== token) return;
      reference = data;
      referenceError = data.warning || '';
      if (data.audioPath && current()) { const s = current(); s.article.audioPath = data.audioPath; save(s); }
      if (!referencePlayer.getAttribute('src')) referencePlayer.src = `/api/reading/articles/${encodeURIComponent(article.id)}/audio`;
    } catch (e) {
      if (key !== token) return;
      referenceError = e.message;
      if (e.status === 409) referencePlayer.removeAttribute('src');
    } finally { if (key === token) { referenceBusy = false; render(); } }
  }
  async function start(ids, scope = 'sentence') {
    if (busy() || !current()) return;
    generation++; const token = generation;
    clearRecording(); referencePlayer.pause(); referencePlayer.controls = false;
    currentAttempt = { id: newReadingId(), scope, sentenceIds: ids, article: structuredClone(article) };
    currentSentence = ids[0]; limit = scope === 'sentence' ? 90 : 300; live = {}; error = ''; notice = ''; status = 'starting'; render();
    recorder = recordFactory({ request, limit,
      onUpdate: (state) => { if (generation !== token) return; live = state; currentSentence = liveSentenceId(article.sentences.filter((s) => ids.includes(s.id)), state.transcript, currentSentence); updateLive(); },
      onLimit: () => { if (generation === token) { notice = c().limit; void stop(); } },
      onInterruption: () => { if (generation === token) { notice = c().interruption; void stop(); } }
    });
    try { await recorder.start(); if (generation === token && status === 'starting') { status = 'recording'; render(); root.querySelector('[data-aloud-stop]')?.focus({ preventScroll: true }); } }
    catch (e) { if (generation === token) { status = 'idle'; error = e.message || c().microphoneError; referencePlayer.controls = true; render(); } }
  }
  async function stop() {
    if (!['starting', 'recording'].includes(status) || !recorder) return;
    const token = generation; status = 'reviewing'; render();
    try {
      const bytes = await recorder.stop();
      if (generation !== token || !bytes) return;
      recorder = null; recordingBytes = bytes; recordingUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); learnerPlayer.src = recordingUrl;
      await review();
    } catch (e) { if (generation === token) { status = 'error'; error = e.message; render(); } }
  }
  async function review() {
    if (!recordingBytes || !currentAttempt || !current()) return;
    const token = generation; status = 'reviewing'; error = ''; render();
    requestController?.abort(); requestController = new AbortController();
    const timeout = setTimeout(() => requestController.abort(), 330000);
    try {
      const data = await submit(currentAttempt, recordingBytes, requestController.signal);
      if (generation !== token || !current()) return;
      const result = validateAloudReview(data.review, article);
      if (result.id !== currentAttempt.id || JSON.stringify(result.sentenceIds) !== JSON.stringify(currentAttempt.sentenceIds)) throw new Error('The review did not match this attempt. Please retry.');
      const s = current(); s.reviews = [result, ...(s.reviews || []).filter((r) => r.id !== result.id)].slice(0, 20); save(s);
      status = 'idle';
    } catch (e) { if (generation === token) { status = 'error'; error = e.name === 'AbortError' ? 'The review timed out. Your recording is still available; please retry.' : e.message; } }
    finally { clearTimeout(timeout); if (generation === token) { referencePlayer.controls = true; render(); } }
  }
  function cancel() {
    generation++; void recorder?.close(); recorder = null; requestController?.abort();
    status = 'idle'; error = ''; notice = ''; live = {}; currentSentence = ''; currentAttempt = null;
    clearRecording(); referencePlayer.controls = true; render();
  }
  function updateLive() {
    const timer = root.querySelector('[data-aloud-time]'); if (timer) timer.textContent = `${Math.floor(live.duration || 0)} / ${limit}s`;
    const meter = root.querySelector('meter'); if (meter) meter.value = live.level || 0;
    const transcript = root.querySelector('[data-aloud-transcript]'); if (transcript) transcript.textContent = live.transcript || '';
    const connection = root.querySelector('[data-aloud-connection]');
    if (connection) connection.textContent = live.live === 'failed' ? c().failedLive : live.live === 'connected' ? (live.provisional ? c().provisional : c().final) : c().connecting;
    const warning = root.querySelector('[data-aloud-warning]');
    if (warning) warning.textContent = limit - (live.duration || 0) <= 10 ? format(c().warning, { seconds: Math.max(0, Math.ceil(limit - live.duration)) }) : '';
    root.querySelectorAll('[data-aloud-sentence]').forEach((row) => { row.classList.toggle('is-reading', status === 'recording' && row.dataset.aloudSentence === currentSentence); });
  }
  function render() {
    if (!article || !current()) return;
    root.replaceChildren();
    const referenceBox = node('div', 'reading-reference');
    referenceBox.append(node('h4', '', c().reference));
    const controls = node('div', 'reading-actions');
    const listen = control(c().listen, () => { void playReference(); }); listen.disabled = busy() || !referencePlayer.getAttribute('src');
    const speedLabel = node('label', '', c().speed); const select = node('select'); select.setAttribute('aria-label', c().speed);
    for (const value of [.75, 1, 1.25]) { const option = node('option', '', `${value}×`); option.value = value; option.selected = value === speed; select.append(option); }
    select.addEventListener('change', () => { speed = Number(select.value); referencePlayer.playbackRate = speed; });
    speedLabel.append(select); controls.append(listen, speedLabel); referenceBox.append(controls, referencePlayer);
    if (referenceBusy) referenceBox.append(node('p', 'reading-muted', c().preparing));
    if (referenceError || playbackError) {
      referenceBox.append(node('p', 'reading-muted', playbackError || referenceError));
      const retry = control(c().retry, () => { playbackError = ''; referencePlayer.load(); void prepareReference(); }); retry.disabled = busy(); referenceBox.append(retry);
    }
    root.append(referenceBox, node('p', 'reading-notice', c().disclosure));
    const actions = node('div', 'reading-actions');
    const whole = control(c().whole, () => { void start(article.sentences.map((s) => s.id), 'article'); }, true); whole.disabled = busy(); actions.append(whole);
    if (busy()) {
      if (status !== 'reviewing') { const stopButton = control(c().stop, () => { void stop(); }, true); stopButton.dataset.aloudStop = ''; stopButton.disabled = status === 'starting'; actions.append(stopButton); }
      actions.append(control(c().cancel, cancel));
    }
    root.append(actions);
    if (notice) root.append(node('p', 'reading-notice', notice));
    if (error) { const message = node('p', 'reading-error', error); message.setAttribute('role', 'alert'); root.append(message); if (recordingBytes) root.append(control(c().retry, () => { void review(); }, true)); }
    if (['starting', 'recording', 'reviewing'].includes(status)) {
      const capture = node('div', 'reading-capture');
      const captureStatus = node('strong', '', status === 'starting' ? c().start : status === 'reviewing' ? c().reviewing : c().recording); captureStatus.setAttribute('role', 'status'); capture.append(captureStatus);
      const timer = node('span'); timer.dataset.aloudTime = ''; capture.append(timer);
      const meter = node('meter'); meter.min = 0; meter.max = 1; meter.setAttribute('aria-label', c().level); capture.append(meter);
      const warning = node('p', 'reading-notice'); warning.dataset.aloudWarning = ''; warning.setAttribute('role', 'status'); capture.append(warning);
      capture.append(node('h4', '', c().transcript));
      const connection = node('p', 'reading-muted'); connection.dataset.aloudConnection = ''; capture.append(connection);
      const transcript = node('p', 'reading-live-transcript'); transcript.lang = 'ja'; transcript.dataset.aloudTranscript = ''; capture.append(transcript);
      root.append(capture);
    }
    if (recordingUrl) { root.append(node('h4', '', c().attempt), learnerPlayer, node('p', 'reading-muted', c().temporary)); }
    const articleNode = node('div', `reading-article ${furigana ? '' : 'reading-no-furigana'}`);
    let paragraph = -1, group;
    article.sentences.forEach((sentence, index) => {
      if (paragraph !== sentence.paragraph) { paragraph = sentence.paragraph; group = node('div', 'reading-paragraph'); articleNode.append(group); }
      const row = node('div', 'reading-aloud-sentence'); row.dataset.aloudSentence = sentence.id;
      const text = node('div', 'reading-source-text'); text.lang = 'ja'; appendJapanese(text, sentence);
      const label = node('span', 'reading-sentence-number', String(index + 1)); label.setAttribute('aria-hidden', 'true'); row.append(label, text);
      const tools = node('div', 'reading-actions');
      const record = control(c().sentence, () => { void start([sentence.id]); }); record.disabled = busy();
      record.setAttribute('aria-label', `${c().sentence} · ${index + 1}`);
      const listen = control(c().sentenceListen, () => { void playReference(sentence.id); }); listen.disabled = busy() || !reference?.timings.some((t) => t.id === sentence.id);
      if (!reference?.timings.some((t) => t.id === sentence.id)) listen.title = c().noTiming;
      tools.append(record, listen); row.append(tools); group.append(row);
    });
    root.append(articleNode, node('h4', '', c().history));
    const reviews = current().reviews || [];
    if (!reviews.length) root.append(node('p', 'reading-muted', c().empty));
    for (const result of reviews) {
      const card = node('div', 'reading-aloud-review'); card.append(node('p', 'reading-muted', `${new Date(result.createdAt).toLocaleString(language)} · ${format(c().duration, { seconds: Math.round(result.duration) })}`));
      const ratings = node('div', 'reading-aloud-ratings');
      for (const category of ['accuracy', 'pronunciation', 'pacing']) { const rating = node('div'); rating.dataset.rating = result.ratings[category]; rating.append(node('span', 'reading-muted', c()[category]), node('strong', '', c()[result.ratings[category]])); ratings.append(rating); }
      card.append(ratings, node('p', '', result.summary));
      if (!result.referenceUsed) card.append(node('p', 'reading-muted', c().noReference));
      for (const tip of result.tips) card.append(node('p', 'reading-aloud-tip', `${c()[tip.category]}${tip.sentenceId ? ` · ${article.sentences.findIndex((s) => s.id === tip.sentenceId) + 1}` : ''}: ${tip.text}`));
      const details = node('details'); details.append(node('summary', '', c().final), node('p', 'reading-live-transcript', result.transcript)); card.append(details);
      const playable = currentAttempt?.id === result.id && recordingUrl;
      if (!playable) card.append(node('p', 'reading-muted', c().unavailable));
      for (const entry of result.sentences) {
        const observation = node('div', 'reading-aloud-observation');
        observation.append(node('strong', '', `${article.sentences.findIndex((s) => s.id === entry.id) + 1} · ${c()[entry.status]}`));
        if (entry.observation) observation.append(node('p', '', entry.observation));
        const controls = node('div', 'reading-actions');
        const retry = control(c().retrySentence, () => { void start([entry.id]); }); retry.disabled = busy(); controls.append(retry);
        const listen = control(c().sentenceListen, () => { void playReference(entry.id); });
        listen.disabled = busy() || !reference?.timings.some((t) => t.id === entry.id); controls.append(listen);
        if (playable && entry.start != null) { const replay = control(c().replay, () => playLearner(entry)); replay.disabled = busy(); controls.append(replay); }
        observation.append(controls); card.append(observation);
      }
      const remove = control(c().delete, () => { const s = current(); s.reviews = s.reviews.filter((r) => r.id !== result.id); save(s); if (currentAttempt?.id === result.id) clearRecording(); render(); }); remove.disabled = busy(); card.append(remove);
      root.append(card);
    }
    updateLive();
  }
  window.addEventListener('pagehide', leave);
  return {
    leave,
    mount(panel, session, options) {
      const nextKey = `${options.owner}:${session.id}:${JSON.stringify(session.article.sentences.map((s) => [s.id, s.text]))}`;
      if (key !== nextKey) {
        leave(); key = nextKey; sessionId = session.id; article = session.article;
        if (article.audioPath) referencePlayer.src = `/api/reading/articles/${encodeURIComponent(article.id)}/audio`;
        queueMicrotask(() => { if (key === nextKey) void prepareReference(); });
      }
      language = options.language; furigana = options.furigana; appendJapanese = options.appendJapanese;
      panel.append(root); render();
    }
  };
}
