import { createReadingSession, readingProgress, updateReadingAnswer, applyReadingGrade, MAX_READING_ANSWER, MAX_READING_BATCH } from './reading-model.js';
import { ReadingSync, requestReading, newReadingId } from './reading-sync.js';
import { createReadAloud } from './read-aloud.js';
import { dictionarySelectionLanguage, dictionaryClipboardText } from './dictionary-query.js';

const copy = {
  en: {
    title: 'Reading', subtitle: 'Translate real news, one sentence at a time.', articles: 'Choose an article',
    source: 'NHK Easy via NHK Easier', browse: 'Browse articles', savedSessions: 'Saved sessions',
    empty: 'Your reading sessions will appear here when you start an article.', start: 'Start reading', resume: 'Resume',
    refresh: 'Refresh articles', loading: 'Loading articles…', retry: 'Retry', close: 'Close',
    originalLink: 'Original NHK article', mirrorLink: 'Read on NHK Easier',
    jaEn: 'Japanese → English', enJa: 'English → Japanese', newAttempt: 'New attempt', translate: 'Translate', readAloud: 'Read aloud', activity: 'Practice mode',
    furiganaOn: 'Furigana: On', furiganaOff: 'Furigana: Off',
    hint: 'Click a sentence to translate it. Select a Japanese or English word to look it up.',
    reverseHint: 'Translate the English sentences into Japanese. Select a word in either language to look it up. Each original appears after you grade that sentence.',
    sentence: 'Sentence', answerEn: 'Your English translation', answerJa: 'Your Japanese translation',
    placeholderEn: 'What does this sentence mean in English?', placeholderJa: 'Write the meaning in Japanese…',
    grade: 'Grade sentence', gradeAll: 'Grade filled sentences', grading: 'Grading…',
    unanswered: 'Unanswered', ungraded: 'Ungraded', correct: 'Correct', needs_revision: 'Needs revision',
    improvement: 'Suggested wording', original: 'Original Japanese', generating: 'Preparing English prompts…',
    preparingHint: 'English prompts are generated once and saved with this session.',
    progress: '{attempted} of {total} attempted · {correct} correct', sentences: '{count} sentences',
    aloudProgress: '{attempted} of {total} read aloud · {reviews} reviews',
    saving: 'Saving…', saved: 'Saved', local: 'Saved on this device', error: 'Could not sync — retry',
    storageError: 'Browser storage is full or unavailable. Keep this page open until server saving succeeds.',
    delete: 'Delete session', deleteConfirm: 'Delete this reading session and its answers?',
    recovered: 'Recovered copy', conflict: 'This session changed on another device. Any local answers were kept in a recovered copy.',
    dictionary: 'Dictionary', looking: 'Looking up…', missing: 'No dictionary entry found for this selection.',
    dictionaryError: 'Dictionary lookup failed. Please try again.', dictionaryForm: 'Dictionary form',
    dictionaryCopy: 'Copy to clipboard', copyWord: 'Copy word', copied: 'Copied!', copyFailed: 'Could not copy. Please try again.',
    stale: 'Showing cached articles. Last fetched {date}. Refresh to try again.', fetched: 'Updated {date}',
    fileOnly: 'Article import and grading require the app server. Previously saved sessions are available here.',
    requestError: 'The request failed. Your answers are saved; please retry.',
    noArticles: 'No articles are available. Try refreshing.', gradeError: 'Some sentences could not be graded. Retry those sentences below.'
  },
  ja: {
    title: '読解', subtitle: 'ニュースを一文ずつ翻訳して練習しましょう。', articles: '記事を選ぶ',
    source: 'NHKやさしいことばニュース（NHK Easier経由）', browse: '記事一覧', savedSessions: '保存した練習',
    empty: '記事を開くと、練習がここに保存されます。', start: '練習を始める', resume: '再開',
    refresh: '記事を更新', loading: '記事を読み込み中…', retry: '再試行', close: '閉じる',
    originalLink: 'NHKの元記事', mirrorLink: 'NHK Easierで読む',
    jaEn: '日本語 → 英語', enJa: '英語 → 日本語', newAttempt: '新しく練習する', translate: '翻訳', readAloud: '音読', activity: '練習モード',
    furiganaOn: 'ふりがな：オン', furiganaOff: 'ふりがな：オフ',
    hint: '文をクリックして翻訳しましょう。日本語や英語の単語を選択すると辞書を開けます。',
    reverseHint: '英文を日本語に翻訳しましょう。日本語や英語の単語を選択すると辞書を開けます。採点すると、その文の元の日本語が表示されます。',
    sentence: '文', answerEn: 'あなたの英訳', answerJa: 'あなたの日本語訳',
    placeholderEn: 'この文を英語に訳してみましょう。', placeholderJa: 'この文を日本語に訳してみましょう。',
    grade: 'この文を採点', gradeAll: '入力済みの文を採点', grading: '採点中…',
    unanswered: '未入力', ungraded: '未採点', correct: '正解', needs_revision: '見直しましょう',
    improvement: '表現の提案', original: '元の日本語', generating: '英語の問題を準備中…',
    preparingHint: '英語の問題は一度生成され、この練習と一緒に保存されます。',
    progress: '{total}文中{attempted}文を入力・{correct}文正解', sentences: '{count}文',
    aloudProgress: '{total}文中{attempted}文を音読・レビュー{reviews}件',
    saving: '保存中…', saved: '保存済み', local: 'この端末に保存済み', error: '同期できませんでした — 再試行',
    storageError: 'ブラウザーに保存できません。サーバーへの保存が完了するまで、このページを開いておいてください。',
    delete: '練習を削除', deleteConfirm: 'この練習と回答を削除しますか？',
    recovered: '復元したコピー', conflict: '別の端末で練習が変更されました。この端末の回答は別のコピーに保存しました。',
    dictionary: '辞書', looking: '検索中…', missing: '選択した語句の辞書項目が見つかりませんでした。',
    dictionaryError: '辞書の検索に失敗しました。もう一度お試しください。', dictionaryForm: '辞書形',
    dictionaryCopy: 'クリップボードにコピー', copyWord: '単語をコピー', copied: 'コピーしました！', copyFailed: 'コピーできませんでした。もう一度お試しください。',
    stale: '保存済みの記事を表示しています。最終取得：{date}。更新して再試行できます。', fetched: '取得日時：{date}',
    fileOnly: '記事の取得と採点にはアプリのサーバーが必要です。保存済みの練習は引き続き開けます。',
    requestError: '処理に失敗しました。回答は保存されています。もう一度お試しください。',
    noArticles: '記事がありません。更新してみてください。', gradeError: '一部の文を採点できませんでした。その文をもう一度採点してください。'
  }
};
function el(tag, className = '', text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, action, primary = false) {
  const node = el('button', `reading-button ${primary ? 'primary' : 'ghost'}`, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function link(label, url) {
  const node = el('a', 'reading-link', label);
  node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer';
  return node;
}
const format = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');

export function createReadingPage({ root, lookup, annotateTitle, request = requestReading, storage = localStorage }) {
  const titleReadings = new Map();
  let context = { active: false, language: 'en', owner: null };
  let library = null;
  let articlesLoading = false;
  let articlesError = '';
  let attemptedLoad = false;
  let showLibrary = false;
  let drawerOpen = true;
  let furigana = true;
  let notice = '';
  let openRequest = 0;
  let operation = null;
  const reverseRequests = new Set();
  const reverseErrors = new Map();
  const sentenceErrors = new Map();
  const rows = new Map();
  let progressNode, syncNode, syncRetry, gradeAllButton;
  let clickTimer;
  let dictionaryToken = 0;
  let selectionTimer;
  let pointerSelecting = false;
  let selectionKey = '';
  const dictionary = el('div', 'reading-dictionary');
  dictionary.hidden = true;
  dictionary.setAttribute('role', 'dialog');
  document.body.append(dictionary);
  const c = () => copy[context.language] || copy.en;
  const active = () => sync.entries[sync.activeId]?.session || null;
  const fileMode = () => location.protocol === 'file:';
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString(context.language, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const sync = new ReadingSync({ storage, request, onChange(reason) {
    if (reason === 'owner') {
      operation = null; notice = ''; sentenceErrors.clear(); reverseErrors.clear(); rows.clear();
      showLibrary = false; openRequest += 1; hideDictionary();
    }
    if (reason === 'conflict') notice = c().conflict;
    if (reason === 'owner') root.replaceChildren();
    if (['owner', 'remote', 'conflict', 'remove'].includes(reason)) render();
    updateStatus();
  } });
  const aloud = createReadAloud({ request, getSession: active, save });
  function save(session) { session.updatedAt = Date.now(); sync.save(session); }
  function hideDictionary() { dictionary.hidden = true; dictionaryToken += 1; selectionKey = ''; }
  function sessionProgressText(session) {
    if (session.activity !== 'aloud') return format(c().progress, readingProgress(session));
    const reviews = session.reviews || [];
    return format(c().aloudProgress, { attempted: new Set(reviews.flatMap((r) => r.sentences.filter((s) => s.status === 'read').map((s) => s.id))).size,
      total: session.article.sentences.length, reviews: reviews.length });
  }
  function updateStatus() {
    if (syncNode) {
      syncNode.textContent = sync.storageFailed ? c().storageError : c()[sync.status];
      syncNode.title = sync.error || '';
      syncNode.classList.toggle('reading-error', sync.status === 'error');
    }
    if (syncRetry) syncRetry.hidden = sync.status !== 'error';
    root.querySelectorAll('[data-reading-session]').forEach((card) => {
      const saved = sync.entries[card.dataset.readingSession]?.session;
      if (!saved) return;
      card.querySelector('[data-reading-progress]').textContent = sessionProgressText(saved);
      card.querySelector('[data-reading-time]').textContent = date(saved.updatedAt);
    });
    const session = active();
    if (progressNode && session) progressNode.textContent = format(c().progress, readingProgress(session));
    if (gradeAllButton && session) {
      gradeAllButton.disabled = Boolean(operation) || !Object.values(session.answers[session.mode]).some((a) => a.input.trim()) || (session.mode === 'en-ja' && !session.english) || fileMode();
      gradeAllButton.textContent = operation ? c().grading : c().gradeAll;
    }
  }
  function render() {
    if (!context.active || !context.owner || showLibrary || active()?.activity !== 'aloud') aloud.leave();
    if (!context.active || !context.owner) return;
    clearTimeout(clickTimer);
    rows.clear();
    root.replaceChildren();
    const header = el('div', 'reading-page-header');
    const heading = el('div');
    heading.append(el('h2', '', c().title), el('p', 'reading-muted', c().subtitle));
    const tools = el('div', 'reading-actions');
    const drawerButton = button(c().savedSessions, () => { drawerOpen = !drawerOpen; render(); });
    drawerButton.setAttribute('aria-expanded', String(drawerOpen));
    drawerButton.setAttribute('aria-controls', 'reading-sessions-drawer');
    syncNode = el('span', 'reading-save-status'); syncNode.setAttribute('role', 'status');
    syncRetry = button(c().retry, () => { void sync.refresh(); });
    tools.append(syncNode, syncRetry, drawerButton);
    header.append(heading, tools); root.append(header);
    if (notice) { const note = el('div', 'reading-notice', notice); note.setAttribute('role', 'status'); root.append(note); }
    const layout = el('div', `reading-layout ${drawerOpen ? 'with-drawer' : ''}`);
    if (drawerOpen) layout.append(renderDrawer());
    const panel = el('section', 'panel reading-content');
    if (!active() || showLibrary) renderLibrary(panel); else renderArticle(panel, active());
    layout.append(panel); root.append(layout); updateStatus();
  }
  function renderDrawer() {
    const drawer = el('aside', 'panel reading-sessions'); drawer.id = 'reading-sessions-drawer';
    drawer.append(el('h3', '', c().savedSessions));
    if (!sync.sessions.length) drawer.append(el('p', 'reading-muted', c().empty));
    for (const session of sync.sessions) {
      const row = el('div', `reading-session-card ${session.id === sync.activeId && !showLibrary ? 'is-active' : ''}`);
      row.dataset.readingSession = session.id;
      const title = session.activity !== 'aloud' && session.mode === 'en-ja' && session.english
        ? el('strong', '', session.english.title) : renderJapaneseTitle('strong', session.article);
      const open = button('', () => openSession(session.id));
      open.className = 'reading-session-open';
      const progress = el('span', 'reading-muted', sessionProgressText(session)); progress.dataset.readingProgress = '';
      const timestamp = el('span', 'reading-muted', date(session.updatedAt)); timestamp.dataset.readingTime = '';
      open.append(title, progress, timestamp);
      if (session.recovered) open.append(el('span', 'reading-status', c().recovered));
      const remove = button(c().delete, () => { if (window.confirm(c().deleteConfirm)) sync.remove(session.id); });
      remove.classList.add('reading-delete');
      row.append(open, remove); drawer.append(row);
    }
    return drawer;
  }
  function renderLibrary(panel) {
    const top = el('div', 'reading-section-header');
    top.append(el('h3', '', c().articles), button(c().refresh, () => { void loadArticles(); }));
    panel.append(top, link(c().source, 'https://nhkeasier.com/'));
    if (fileMode()) panel.append(el('p', 'reading-notice', c().fileOnly));
    if (articlesLoading) panel.append(el('p', 'reading-muted', c().loading));
    if (articlesError) {
      const error = el('div', 'reading-error', articlesError); error.setAttribute('role', 'alert');
      error.append(button(c().retry, () => { void loadArticles(); })); panel.append(error);
    }
    if (library) panel.append(el('p', library.stale ? 'reading-notice' : 'reading-muted', format(library.stale ? c().stale : c().fetched, { date: date(library.fetchedAt) })));
    const grid = el('div', 'reading-article-grid');
    for (const article of library?.articles || []) {
      const card = el('div', 'reading-article-card');
      if (article.imageUrl) {
        const image = el('img', 'reading-article-thumbnail');
        image.alt = ''; // The adjacent article title identifies the topic.
        image.width = 640; image.height = 360;
        image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.remove(), { once: true });
        image.src = article.imageUrl;
        card.append(image);
      }
      card.append(el('span', 'reading-muted', date(article.publishedAt)), renderJapaneseTitle('h4', article), el('p', 'reading-muted', format(c().sentences, { count: article.sentenceCount })));
      const existing = sync.sessions.find((session) => session.article.id === article.id);
      card.append(button(existing ? c().resume : c().start, () => { void startArticle(article.id); }, true));
      grid.append(card);
    }
    panel.append(grid);
    if (library && !library.articles.length) panel.append(el('p', 'reading-muted', c().noArticles));
  }
  async function loadArticles() {
    if (articlesLoading || fileMode()) return;
    attemptedLoad = true; articlesLoading = true; articlesError = ''; render();
    try { library = await request('articles'); }
    catch (error) { articlesError = error.message || c().requestError; }
    finally { articlesLoading = false; if (showLibrary || !active()) render(); }
  }
  function openSession(id) {
    openRequest += 1;
    hideDictionary(); sync.activate(id); showLibrary = false; notice = ''; sentenceErrors.clear(); render();
    if (active()?.activity !== 'aloud' && active()?.mode === 'en-ja' && !active().english) void prepareEnglish();
  }
  async function startArticle(id) {
    const existing = sync.sessions.find((session) => session.article.id === id);
    if (existing) return openSession(existing.id);
    const token = ++openRequest;
    const epoch = sync.epoch;
    notice = c().loading; render();
    try {
      const { article } = await request(`articles/${encodeURIComponent(id)}`);
      if (token !== openRequest || epoch !== sync.epoch) return;
      const session = createReadingSession(article, newReadingId());
      sync.save(session); openSession(session.id);
    } catch (error) { if (token === openRequest && epoch === sync.epoch) { notice = error.message || c().requestError; render(); } }
  }
  function newAttempt() {
    const previous = active();
    if (!previous) return;
    const session = createReadingSession(previous.article, newReadingId());
    session.english = previous.english; session.mode = previous.mode; session.activity = previous.activity;
    sync.save(session); openSession(session.id);
  }
  function renderArticle(panel, session) {
    const navigation = el('div', 'reading-section-header');
    navigation.append(button(`← ${c().browse}`, () => { openRequest += 1; showLibrary = true; hideDictionary(); render(); if (!attemptedLoad) void loadArticles(); }), button(c().newAttempt, newAttempt));
    panel.append(navigation);
    const isAloud = session.activity === 'aloud';
    const isReverse = !isAloud && session.mode === 'en-ja';
    panel.append(isReverse ? el('h3', 'reading-article-title', session.english?.title || c().generating)
      : renderJapaneseTitle('h3', session.article, 'reading-article-title'));
    const attribution = el('div', 'reading-attribution');
    attribution.append(el('span', '', date(session.article.publishedAt)), link(c().originalLink, session.article.sourceUrl), link(c().mirrorLink, session.article.providerUrl));
    panel.append(attribution);
    const activities = el('div', 'reading-toolbar');
    const activityToggle = el('fieldset', 'reading-activity-toggle');
    activityToggle.append(el('legend', 'sr-only', c().activity));
    for (const activity of ['translate', 'aloud']) {
      const option = el('label', 'reading-activity-option');
      const choice = el('input', 'sr-only');
      choice.type = 'radio'; choice.name = 'reading-activity'; choice.value = activity;
      choice.checked = (session.activity || 'translate') === activity;
      choice.addEventListener('change', () => {
        if (!choice.checked) return;
        const current = active(); current.activity = activity; hideDictionary(); save(current); render();
        root.querySelector(`input[name="reading-activity"][value="${activity}"]`)?.focus({ preventScroll: true });
        if (activity === 'translate' && current.mode === 'en-ja' && !current.english) void prepareEnglish();
      });
      option.append(choice, el('span', '', activity === 'aloud' ? c().readAloud : c().translate));
      activityToggle.append(option);
    }
    activities.append(activityToggle);
    panel.append(activities);
    const toolbar = el('div', 'reading-toolbar');
    for (const mode of isAloud ? [] : ['ja-en', 'en-ja']) {
      const control = button(mode === 'ja-en' ? c().jaEn : c().enJa, () => {
        const current = active(); current.mode = mode; sentenceErrors.clear(); hideDictionary(); save(current); render();
        if (mode === 'en-ja' && !current.english) void prepareEnglish();
      });
      control.setAttribute('aria-pressed', String(session.mode === mode)); toolbar.append(control);
    }
    const toggle = button(furigana ? c().furiganaOn : c().furiganaOff, () => { furigana = !furigana; render(); });
    toggle.setAttribute('aria-pressed', String(furigana)); toolbar.append(toggle);
    panel.append(toolbar);
    if (isAloud) {
      gradeAllButton = null; progressNode = null;
      aloud.mount(panel, session, { owner: context.owner, language: context.language, furigana, appendJapanese });
      return;
    }
    const gradebar = el('div', 'reading-section-header');
    progressNode = el('p', 'reading-progress'); progressNode.setAttribute('role', 'status');
    gradeAllButton = button(c().gradeAll, () => { void grade(); }, true);
    gradebar.append(progressNode, gradeAllButton); panel.append(gradebar, el('p', 'reading-muted', isReverse ? c().reverseHint : c().hint));
    if (isReverse && !session.english) {
      panel.append(el('p', 'reading-notice', c().preparingHint));
      if (reverseErrors.has(session.id)) {
        panel.append(el('p', 'reading-error', reverseErrors.get(session.id)), button(c().retry, () => { void prepareEnglish(); }, true));
      } else panel.append(el('p', 'reading-muted', c().generating));
      return;
    }
    const article = el('div', `reading-article ${furigana ? '' : 'reading-no-furigana'}`);
    let paragraph = -1;
    let group;
    session.article.sentences.forEach((sentence, index) => {
      if (paragraph !== sentence.paragraph) { paragraph = sentence.paragraph; group = el('div', 'reading-paragraph'); article.append(group); }
      group.append(renderSentence(session, sentence, index));
    });
    panel.append(article);
  }
  function renderJapaneseTitle(tag, article, className = '') {
    const node = el(tag, `reading-japanese-title ${className} ${furigana ? '' : 'reading-no-furigana'}`);
    node.lang = 'ja';
    appendJapanese(node, { segments: article.titleSegments || [{ text: article.title, reading: '' }] });
    // Older snapshots did not store title ruby. Enrich just the rendered title locally.
    if (annotateTitle && !article.titleSegments?.some((segment) => segment.reading) && /[\u3400-\u9fff]/.test(article.title)) {
      if (!titleReadings.has(article.title)) titleReadings.set(article.title, Promise.resolve().then(() => annotateTitle(article.title)).catch(() => null));
      void titleReadings.get(article.title).then((segments) => {
        if (!node.isConnected || !segments?.length || segments.map((segment) => segment.text).join('') !== article.title) return;
        node.replaceChildren(); appendJapanese(node, { segments });
      });
    }
    return node;
  }
  function appendJapanese(node, sentence) {
    for (const segment of sentence.segments) {
      if (!segment.reading) node.append(document.createTextNode(segment.text));
      else {
        const ruby = el('ruby'); ruby.append(document.createTextNode(segment.text), el('rt', '', segment.reading)); node.append(ruby);
      }
    }
  }
  function renderSentence(session, sentence, index) {
    const reverse = session.mode === 'en-ja';
    const row = el('div', 'reading-sentence-row'); row.dataset.sentenceId = sentence.id;
    const source = el('div', 'reading-sentence-source');
    source.tabIndex = 0; source.setAttribute('role', 'button'); source.lang = reverse ? 'en' : 'ja';
    source.setAttribute('aria-label', `${c().sentence} ${index + 1}: ${reverse ? session.english.sentences.find((s) => s.id === sentence.id).text : sentence.text}`);
    const label = el('span', 'reading-sentence-number', `${index + 1}`); label.setAttribute('aria-hidden', 'true');
    const textNode = el('span', 'reading-source-text');
    if (reverse) textNode.textContent = session.english.sentences.find((s) => s.id === sentence.id).text;
    else appendJapanese(textNode, sentence);
    source.append(label, textNode);
    const badge = el('span', 'reading-status'); badge.setAttribute('aria-live', 'polite');
    const editor = el('div', 'reading-inline-editor'); editor.id = `reading-editor-${sentence.id}`;
    editor.hidden = !session.expanded.includes(sentence.id);
    source.setAttribute('aria-expanded', String(!editor.hidden)); source.setAttribute('aria-controls', editor.id);
    const answerLabel = el('label', '', reverse ? c().answerJa : c().answerEn);
    const input = el('textarea', 'reading-answer'); input.id = `reading-answer-${sentence.id}`; answerLabel.htmlFor = input.id;
    input.lang = reverse ? 'ja' : 'en'; input.maxLength = MAX_READING_ANSWER; input.rows = 3; input.spellcheck = !reverse;
    input.placeholder = reverse ? c().placeholderJa : c().placeholderEn;
    input.value = session.answers[session.mode][sentence.id]?.input || '';
    const controls = el('div', 'reading-editor-actions');
    const gradeButton = button(c().grade, () => { void grade(sentence.id); }, true);
    controls.append(gradeButton);
    const feedback = el('div', 'reading-feedback'); feedback.setAttribute('aria-live', 'polite');
    editor.append(answerLabel, input, controls, feedback); row.append(source, badge, editor);
    function toggle() {
      const current = active(); if (!current || current.id !== session.id) return;
      editor.hidden = !editor.hidden;
      source.setAttribute('aria-expanded', String(!editor.hidden));
      current.expanded = editor.hidden ? current.expanded.filter((id) => id !== sentence.id) : [...new Set([...current.expanded, sentence.id])];
      save(current);
      if (!editor.hidden) input.focus({ preventScroll: true });
    }
    source.addEventListener('click', (event) => {
      clearTimeout(clickTimer);
      if (event.detail > 1 || !window.getSelection()?.isCollapsed) return;
      clickTimer = setTimeout(() => { if (window.getSelection()?.isCollapsed && dictionary.hidden) toggle(); }, 300);
    });
    source.addEventListener('dblclick', () => clearTimeout(clickTimer));
    source.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && window.getSelection()?.isCollapsed) { event.preventDefault(); toggle(); }
    });
    input.addEventListener('input', () => {
      const current = active(); if (!current || current.id !== session.id) return;
      updateReadingAnswer(current, session.mode, sentence.id, input.value);
      sentenceErrors.delete(sentence.id); save(current); updateRow(sentence.id); updateStatus();
    });
    rows.set(sentence.id, { row, editor, source, badge, gradeButton, feedback, sentence });
    updateRow(sentence.id);
    return row;
  }
  function updateRow(id) {
    const view = rows.get(id); const session = active(); if (!view || !session) return;
    const answer = session.answers[session.mode][id];
    const result = answer?.gradedInput === answer?.input ? answer?.grade : null;
    const status = result?.verdict || (answer?.input.trim() ? 'ungraded' : 'unanswered');
    const busy = operation?.id === session.id && operation.direction === session.mode && operation.pending.has(id);
    const rating = result ? `${result.verdict === 'correct' ? '✅' : '❌'} ${c()[status]}${Number.isInteger(result.score) ? ` · ${result.score}%` : ''}` : c()[status];
    view.badge.textContent = busy ? c().grading : rating; view.badge.dataset.status = status;
    view.row.dataset.status = status;
    view.gradeButton.disabled = Boolean(operation) || !answer?.input.trim() || fileMode();
    view.gradeButton.textContent = busy ? c().grading : c().grade;
    view.feedback.replaceChildren();
    if (sentenceErrors.has(id)) view.feedback.append(el('p', 'reading-error', sentenceErrors.get(id)));
    if (result) {
      const summary = el('div', 'reading-grade-summary', rating);
      summary.dataset.status = status;
      view.feedback.append(summary);
      view.feedback.append(el('p', '', result.explanation));
      if (result.improvement) view.feedback.append(el('strong', 'reading-feedback-label', c().improvement), el('p', '', result.improvement));
      if (session.mode === 'en-ja') {
        view.feedback.append(el('strong', 'reading-feedback-label', c().original));
        const original = el('p', `reading-original ${furigana ? '' : 'reading-no-furigana'}`); original.lang = 'ja';
        appendJapanese(original, view.sentence); view.feedback.append(original);
      }
    }
  }
  async function prepareEnglish() {
    const session = active(); if (!session || session.english || fileMode()) return;
    const key = `${sync.epoch}:${session.id}`;
    if (reverseRequests.has(key)) return;
    const epoch = sync.epoch;
    reverseRequests.add(key); reverseErrors.delete(session.id); render();
    try {
      const { english } = await request('reverse', { method: 'POST', body: { article: session.article } });
      if (epoch !== sync.epoch) return;
      const current = sync.entries[session.id]?.session;
      if (current) { current.english = english; save(current); }
    } catch (error) { if (epoch === sync.epoch) reverseErrors.set(session.id, error.message || c().requestError); }
    finally {
      reverseRequests.delete(key);
      if (epoch === sync.epoch && active()?.id === session.id && active().mode === 'en-ja') render();
    }
  }
  async function grade(onlyId) {
    const session = active(); if (!session || operation || fileMode()) return;
    const direction = session.mode;
    const submitted = session.article.sentences.filter(({ id }) => (!onlyId || id === onlyId) && session.answers[direction][id]?.input.trim()).map(({ id }) => ({ id, input: session.answers[direction][id].input }));
    if (!submitted.length || (direction === 'en-ja' && !session.english)) return;
    const epoch = sync.epoch;
    const task = { id: session.id, direction, pending: new Set(submitted.map((answer) => answer.id)) };
    operation = task;
    for (const answer of submitted) sentenceErrors.delete(answer.id);
    rows.forEach((_, id) => updateRow(id)); updateStatus();
    try {
      for (let index = 0; index < submitted.length; index += MAX_READING_BATCH) {
        if (epoch !== sync.epoch || active()?.id !== session.id || active()?.mode !== direction || showLibrary) break;
        const batch = submitted.slice(index, index + MAX_READING_BATCH);
        try {
          const data = await request('grade', { method: 'POST', body: { article: session.article, english: session.english, direction, answers: batch } });
          if (epoch !== sync.epoch || active()?.id !== session.id || active()?.mode !== direction || showLibrary) break;
          const current = active();
          for (const answer of batch) {
            const result = data.results.find((item) => item.id === answer.id);
            if (result) applyReadingGrade(current, direction, answer, result);
          }
          save(current);
        } catch (error) {
          if (epoch !== sync.epoch || active()?.id !== session.id || active()?.mode !== direction) break;
          for (const answer of batch) if (active().answers[direction][answer.id]?.input === answer.input) sentenceErrors.set(answer.id, error.message || c().requestError);
        } finally {
          batch.forEach(({ id }) => task.pending.delete(id));
          if (epoch === sync.epoch && active()?.id === session.id && active()?.mode === direction) { rows.forEach((_, id) => updateRow(id)); updateStatus(); }
        }
      }
    } finally {
      if (operation === task) operation = null;
      if (epoch === sync.epoch) { rows.forEach((_, id) => updateRow(id)); updateStatus(); }
    }
  }

  function readSelection() {
    const focused = document.activeElement;
    if (focused?.matches('.reading-answer') && root.contains(focused)) {
      if (focused.selectionStart === focused.selectionEnd) return null;
      return { text: focused.value.slice(focused.selectionStart, focused.selectionEnd).trim(), rect: focused.getBoundingClientRect() };
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    const region = start?.closest('.reading-source-text, .reading-original');
    if (!region || !root.contains(region) || !region.contains(end)) return null;
    const fragment = range.cloneContents(); fragment.querySelectorAll('rt,rp').forEach((node) => node.remove());
    return { text: fragment.textContent.trim(), rect: range.getBoundingClientRect() };
  }
  async function showDictionary() {
    if (!context.active || pointerSelecting) return;
    const selection = readSelection();
    const language = dictionarySelectionLanguage(selection?.text);
    if (!language) return;
    clearTimeout(clickTimer);
    if (selectionKey === selection.text && !dictionary.hidden) return;
    selectionKey = selection.text;
    const token = ++dictionaryToken;
    dictionary.replaceChildren(); dictionary.hidden = false; dictionary.setAttribute('aria-label', c().dictionary);
    const header = el('div', 'reading-section-header');
    header.append(el('strong', '', selection.text), button(c().close, hideDictionary));
    const definition = el('div', 'reading-dictionary-result', c().looking); definition.setAttribute('role', 'status');
    dictionary.append(header, definition);
    function copyButton(label, text) {
      const node = button(label, async () => {
        try {
          await navigator.clipboard.writeText(text);
          if (token !== dictionaryToken) return;
          node.textContent = c().copied;
          copyStatus.textContent = c().copied;
        } catch {
          if (token === dictionaryToken) copyStatus.textContent = c().copyFailed;
        }
        setTimeout(() => { if (token === dictionaryToken) node.textContent = label; }, 1500);
      });
      // Mouse clicks should keep the editor's caret and selection ready for pasting.
      node.addEventListener('mousedown', (event) => event.preventDefault());
      return node;
    }
    const copyStatus = el('p', 'reading-dictionary-kana'); copyStatus.setAttribute('role', 'status');
    function position() {
      const height = dictionary.getBoundingClientRect().height;
      dictionary.style.left = `${Math.max(12, Math.min(selection.rect.left, innerWidth - dictionary.offsetWidth - 12))}px`;
      dictionary.style.top = `${Math.max(12, Math.min(selection.rect.bottom + 10, innerHeight - height - 12))}px`;
    }
    position();
    try {
      const outcome = await lookup(selection.text);
      if (token !== dictionaryToken) return;
      definition.replaceChildren();
      if (!outcome?.entry) definition.append(el('p', '', outcome?.status === 'error' ? c().dictionaryError : c().missing));
      else {
        const entries = language === 'en' ? (outcome.entry.choices || [outcome.entry]) : [outcome.entry];
        for (const entry of entries) {
          const item = el('div', 'reading-dictionary-entry');
          if (language === 'en') {
            const row = el('div', 'reading-section-header');
            const wordCopy = copyButton(c().copyWord, entry.word);
            wordCopy.setAttribute('aria-label', `${c().copyWord}: ${entry.word}`);
            row.append(el('strong', '', entry.word), wordCopy);
            item.append(row);
          } else if (entry.word !== selection.text) item.append(el('p', '', `${c().dictionaryForm}: ${entry.word}`));
          item.append(el('p', 'reading-dictionary-kana', entry.reading), el('p', '', entry.meaning));
          definition.append(item);
        }
        const actions = el('div', 'reading-dictionary-actions');
        actions.append(copyButton(c().dictionaryCopy, dictionaryClipboardText(entries)), copyStatus);
        dictionary.append(actions);
      }
    } catch { if (token === dictionaryToken) definition.textContent = c().dictionaryError; }
    if (token === dictionaryToken) position();
  }
  root.addEventListener('pointerdown', () => { pointerSelecting = true; });
  document.addEventListener('pointerup', () => { pointerSelecting = false; clearTimeout(selectionTimer); selectionTimer = setTimeout(showDictionary, 80); });
  document.addEventListener('selectionchange', () => { clearTimeout(selectionTimer); selectionTimer = setTimeout(showDictionary, 180); });
  document.addEventListener('pointerdown', (event) => { if (!dictionary.contains(event.target)) hideDictionary(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { hideDictionary(); clearTimeout(clickTimer); } });
  window.addEventListener('scroll', (event) => { if (!dictionary.contains(event.target)) hideDictionary(); }, true);
  window.addEventListener('resize', hideDictionary);
  window.addEventListener('focus', () => { if (context.active) void sync.refresh(); });
  document.addEventListener('visibilitychange', () => { if (context.active && document.visibilityState === 'visible') void sync.refresh(); });
  window.addEventListener('pagehide', () => { sync.persist(); });
  setInterval(() => { if (context.active && document.visibilityState === 'visible') void sync.refresh(); }, 30000);
  return {
    update(next) {
      const previous = context;
      context = next;
      sync.setOwner(next.owner);
      if (!next.active) { hideDictionary(); aloud.leave(); return; }
      if (next.active !== previous.active || next.language !== previous.language || next.owner !== previous.owner) {
        render();
        if (!attemptedLoad && !active()) void loadArticles();
        if (active()?.activity !== 'aloud' && active()?.mode === 'en-ja' && !active().english) void prepareEnglish();
      }
    }
  };
}
