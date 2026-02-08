const DIRECT_DICT_ENDPOINT = 'https://jisho.org/api/v1/search/words?keyword=';
const PROXY_DICT_ENDPOINT = '/api/lookup?keyword=';
const preferProxy = typeof window !== 'undefined'
  && window.location
  && ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
const STORAGE_KEYS = {
  entry: 'jc_entry',
  vocab: 'jc_vocab_list'
};

const kanjiRegex = /[\u3400-\u9fff]/;
const japaneseCharRange =
  '\u3005\u3006\u3007\u303b\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d';
const japaneseEdgeRegex = new RegExp(`^[^${japaneseCharRange}]+|[^${japaneseCharRange}]+$`, 'g');
const japaneseRunRegex = new RegExp(`[${japaneseCharRange}]+`, 'g');
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('ja', { granularity: 'word' })
  : null;

const i18n = {
  en: {
    appTitle: 'Japanese Composer',
    appSubtitle: 'Journal workspace with furigana and vocab support',
    editorTitle: 'Composer',
    editorSubtitle: 'Write in English or Japanese — hover view shows furigana and kanji details.',
    editorPlaceholder: 'Write your journal entry here...',
    hoverTitle: 'Hover View',
    previewEmpty: 'Your hover view will appear here as you type.',
    vocabTitle: 'Vocabulary',
    vocabSubtitle: 'Saved words from your journal entry.',
    vocabEmpty: 'No vocabulary yet. Hover a kanji and add it here.',
    furiganaOn: 'Furigana: On',
    furiganaOff: 'Furigana: Off',
    vocabOn: 'Vocab: On',
    vocabOff: 'Vocab: Off',
    languageToggle: '日本語 UI',
    addToVocab: 'Add to vocab',
    clear: 'Clear',
    loading: 'Looking up…',
    missing: 'No definition found.'
  },
  ja: {
    appTitle: '日本語コンポーザー',
    appSubtitle: 'ふりがな・語彙リスト付きの作文ワークスペース',
    editorTitle: '作文',
    editorSubtitle: '英語でも日本語でも入力できます。下の表示でふりがなと漢字情報を確認。',
    editorPlaceholder: 'ここに日記を書いてください…',
    hoverTitle: 'ホバー表示',
    previewEmpty: '入力するとここに表示されます。',
    vocabTitle: '語彙リスト',
    vocabSubtitle: '日記から保存した単語を表示します。',
    vocabEmpty: 'まだ語彙がありません。漢字から追加しましょう。',
    furiganaOn: 'ふりがな: あり',
    furiganaOff: 'ふりがな: なし',
    vocabOn: '語彙: 表示',
    vocabOff: '語彙: 非表示',
    languageToggle: 'English UI',
    addToVocab: '語彙に追加',
    clear: 'クリア',
    loading: '検索中…',
    missing: '意味が見つかりません。'
  }
};

const state = {
  text: '',
  showFurigana: true,
  showVocab: true,
  language: 'en',
  vocab: []
};

const lookupCache = new Map();
const pendingLookups = new Map();
let pendingRender = false;

const app = document.querySelector('#app');
const composerInput = document.querySelector('#composer-input');
const preview = document.querySelector('#preview');
const vocabPanel = document.querySelector('#vocab-panel');
const vocabList = document.querySelector('#vocab-list');
const languageToggle = document.querySelector('#language-toggle');
const furiganaToggle = document.querySelector('#furigana-toggle');
const vocabToggle = document.querySelector('#vocab-toggle');
const clearVocab = document.querySelector('#clear-vocab');

const tooltip = document.querySelector('#tooltip');
const tooltipWord = document.querySelector('#tooltip-word');
const tooltipReading = document.querySelector('#tooltip-reading');
const tooltipMeaning = document.querySelector('#tooltip-meaning');
const tooltipAdd = document.querySelector('#tooltip-add');
let activeHoverBase = null;

const defaultText = `今日はカフェで日本語の日記を書きました。\n天気は少し寒かったですが、コーヒーがとてもおいしかったです。\nI want to practice writing more natural sentences.`;

function hasKanji(text) {
  return kanjiRegex.test(text);
}

function isKanji(char) {
  return kanjiRegex.test(char);
}

function normalizeLookupWord(token) {
  if (!token) {
    return '';
  }
  const trimmed = token.replace(japaneseEdgeRegex, '');
  if (trimmed) {
    return trimmed;
  }
  const runs = token.match(japaneseRunRegex);
  if (!runs || !runs.length) {
    return token;
  }
  const runWithKanji = runs.find((run) => hasKanji(run));
  return runWithKanji || runs[0];
}

function segmentLine(line) {
  if (!segmenter) {
    return line.split(/(\s+)/);
  }
  const segments = [];
  for (const { segment } of segmenter.segment(line)) {
    segments.push(segment);
  }
  return segments;
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Ignore storage errors.
  }
}

function loadState() {
  const storedEntry = safeStorageGet(STORAGE_KEYS.entry);
  const storedVocab = safeStorageGet(STORAGE_KEYS.vocab);

  state.text = storedEntry || defaultText;

  if (storedVocab) {
    try {
      const parsed = JSON.parse(storedVocab);
      if (Array.isArray(parsed)) {
        state.vocab = parsed;
      }
    } catch (error) {
      state.vocab = [];
    }
  }
}

function saveEntry() {
  safeStorageSet(STORAGE_KEYS.entry, state.text);
}

function saveVocab() {
  safeStorageSet(STORAGE_KEYS.vocab, JSON.stringify(state.vocab));
}

async function lookupWord(word) {
  if (!hasKanji(word)) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const directUrl = `${DIRECT_DICT_ENDPOINT}${encodeURIComponent(word)}`;
    const proxyUrl = `${PROXY_DICT_ENDPOINT}${encodeURIComponent(word)}`;
    const data = preferProxy
      ? await fetchJson(proxyUrl, controller.signal) || await fetchJson(directUrl, controller.signal)
      : await fetchJson(directUrl, controller.signal) || await fetchJson(proxyUrl, controller.signal);
    const entry = data?.data?.[0];
    if (!entry) {
      return null;
    }

    const japanese = entry.japanese?.[0] || {};
    const reading = japanese.reading || '';
    const resolvedWord = japanese.word || word;
    const meaning = entry.senses?.[0]?.english_definitions?.slice(0, 3).join('; ') || '';

    return {
      word: resolvedWord,
      reading,
      meaning
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJson(url, signal) {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    return null;
  }
}

function ensureLookup(word) {
  if (!word || !hasKanji(word)) {
    return;
  }

  if (lookupCache.has(word) || pendingLookups.has(word)) {
    return;
  }

  const lookupPromise = lookupWord(word).then((result) => {
    lookupCache.set(word, result);
    pendingLookups.delete(word);
    schedulePreviewRender();
  });

  pendingLookups.set(word, lookupPromise);
}

function buildTokenElement(token, info, lookupWord) {
  const resolvedLookup = lookupWord || token;
  const ruby = document.createElement('ruby');
  ruby.className = 'token';

  const base = document.createElement('span');
  base.className = 'token-base';

  for (const char of token) {
    if (isKanji(char)) {
      const kanjiSpan = document.createElement('span');
      kanjiSpan.className = 'kanji';
      kanjiSpan.dataset.word = resolvedLookup;
      kanjiSpan.textContent = char;
      base.appendChild(kanjiSpan);
    } else {
      base.appendChild(document.createTextNode(char));
    }
  }

  ruby.appendChild(base);

  const rt = document.createElement('rt');
  rt.textContent = info?.reading || '';
  ruby.appendChild(rt);

  return ruby;
}

function renderPreview() {
  preview.replaceChildren();

  if (!state.text.trim()) {
    const placeholder = document.createElement('div');
    placeholder.className = 'vocab-empty';
    placeholder.textContent = i18n[state.language].previewEmpty;
    preview.appendChild(placeholder);
    return;
  }

  const lines = state.text.split('\n');
  lines.forEach((line, index) => {
    const segments = segmentLine(line);
    segments.forEach((segment) => {
      if (!segment) {
        return;
      }

      if (hasKanji(segment)) {
        const lookupWord = normalizeLookupWord(segment);
        ensureLookup(lookupWord);
        const info = lookupCache.get(lookupWord);
        preview.appendChild(buildTokenElement(segment, info, lookupWord));
      } else {
        preview.appendChild(document.createTextNode(segment));
      }
    });

    if (index < lines.length - 1) {
      preview.appendChild(document.createElement('br'));
    }
  });
}

function renderVocab() {
  vocabList.replaceChildren();

  if (!state.vocab.length) {
    const empty = document.createElement('div');
    empty.className = 'vocab-empty';
    empty.textContent = i18n[state.language].vocabEmpty;
    vocabList.appendChild(empty);
    return;
  }

  state.vocab.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'vocab-card';

    const word = document.createElement('div');
    word.className = 'word';
    word.textContent = entry.word;

    const reading = document.createElement('div');
    reading.className = 'reading';
    reading.textContent = entry.reading || '-';

    const meaning = document.createElement('div');
    meaning.className = 'meaning';
    meaning.textContent = entry.meaning || '-';

    card.appendChild(word);
    card.appendChild(reading);
    card.appendChild(meaning);
    vocabList.appendChild(card);
  });
}

function renderUI() {
  const copy = i18n[state.language];

  document.documentElement.lang = state.language;

  app.classList.toggle('furigana-off', !state.showFurigana);
  app.classList.toggle('vocab-hidden', !state.showVocab);

  languageToggle.textContent = copy.languageToggle;
  languageToggle.setAttribute('aria-pressed', state.language === 'ja');

  furiganaToggle.textContent = state.showFurigana ? copy.furiganaOn : copy.furiganaOff;
  furiganaToggle.setAttribute('aria-pressed', state.showFurigana);

  vocabToggle.textContent = state.showVocab ? copy.vocabOn : copy.vocabOff;
  vocabToggle.setAttribute('aria-pressed', state.showVocab);

  vocabPanel.style.display = state.showVocab ? 'flex' : 'none';
  clearVocab.textContent = copy.clear;
  tooltipAdd.textContent = copy.addToVocab;

  document.querySelector('#app-title').textContent = copy.appTitle;
  document.querySelector('#app-subtitle').textContent = copy.appSubtitle;
  document.querySelector('#editor-title').textContent = copy.editorTitle;
  document.querySelector('#editor-subtitle').textContent = copy.editorSubtitle;
  document.querySelector('#hover-title').textContent = copy.hoverTitle;
  document.querySelector('#vocab-title').textContent = copy.vocabTitle;
  document.querySelector('#vocab-subtitle').textContent = copy.vocabSubtitle;
  composerInput.placeholder = copy.editorPlaceholder;
}

function schedulePreviewRender() {
  if (pendingRender) {
    return;
  }
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    renderPreview();
  });
}

function addToVocab(entry) {
  const exists = state.vocab.some((item) => item.word === entry.word && item.reading === entry.reading);
  if (exists) {
    return;
  }
  state.vocab.unshift({
    word: entry.word,
    reading: entry.reading,
    meaning: entry.meaning,
    addedAt: Date.now()
  });
  saveVocab();
  renderVocab();
}

function showTooltip(word, target) {
  const copy = i18n[state.language];
  const info = lookupCache.get(word);
  const pending = pendingLookups.has(word);

  const readingText = pending
    ? copy.loading
    : (info?.reading || copy.missing);
  const meaningText = pending
    ? copy.loading
    : (info?.meaning || copy.missing);

  tooltip.dataset.word = info?.word || word;
  tooltip.dataset.reading = info?.reading || '';
  tooltip.dataset.meaning = info?.meaning || '';

  tooltipWord.textContent = info?.word || word;
  tooltipReading.textContent = readingText;
  tooltipMeaning.textContent = meaningText;

  tooltip.setAttribute('aria-hidden', 'false');

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  let left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tooltipRect.width - 12));

  let top = targetRect.bottom + 12;
  if (top + tooltipRect.height > window.innerHeight - 12) {
    top = targetRect.top - tooltipRect.height - 12;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.setAttribute('aria-hidden', 'true');
}

function setActiveHover(base) {
  if (activeHoverBase && activeHoverBase !== base) {
    activeHoverBase.classList.remove('word-hover');
  }
  activeHoverBase = base;
  if (activeHoverBase) {
    activeHoverBase.classList.add('word-hover');
  }
}

function clearActiveHover() {
  if (activeHoverBase) {
    activeHoverBase.classList.remove('word-hover');
    activeHoverBase = null;
  }
}

function bindEvents() {
  composerInput.addEventListener('input', (event) => {
    state.text = event.target.value;
    saveEntry();
    schedulePreviewRender();
  });

  languageToggle.addEventListener('click', () => {
    state.language = state.language === 'en' ? 'ja' : 'en';
    renderUI();
    renderPreview();
    renderVocab();
  });

  furiganaToggle.addEventListener('click', () => {
    state.showFurigana = !state.showFurigana;
    renderUI();
  });

  vocabToggle.addEventListener('click', () => {
    state.showVocab = !state.showVocab;
    renderUI();
  });

  clearVocab.addEventListener('click', () => {
    if (!state.vocab.length) {
      return;
    }
    const confirmMessage = state.language === 'ja'
      ? '語彙リストを削除しますか？'
      : 'Clear the vocabulary list?';
    if (window.confirm(confirmMessage)) {
      state.vocab = [];
      saveVocab();
      renderVocab();
    }
  });

  preview.addEventListener('pointerover', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!target.classList.contains('kanji')) {
      return;
    }
    const word = target.dataset.word;
    if (!word) {
      return;
    }
    const base = target.closest('.token-base');
    if (base instanceof HTMLElement) {
      setActiveHover(base);
    }
    showTooltip(word, target);
  });

  preview.addEventListener('pointerout', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (!target.classList.contains('kanji')) {
      return;
    }
    const base = target.closest('.token-base');
    const related = event.relatedTarget;
    if (related instanceof HTMLElement) {
      if (tooltip.contains(related)) {
        return;
      }
      if (base instanceof HTMLElement && base.contains(related)) {
        return;
      }
    }
    clearActiveHover();
    hideTooltip();
  });

  preview.addEventListener('pointerleave', () => {
    clearActiveHover();
    hideTooltip();
  });

  tooltip.addEventListener('pointerleave', () => {
    clearActiveHover();
    hideTooltip();
  });

  tooltipAdd.addEventListener('click', () => {
    const word = tooltip.dataset.word;
    if (!word) {
      return;
    }
    addToVocab({
      word,
      reading: tooltip.dataset.reading || '',
      meaning: tooltip.dataset.meaning || ''
    });
  });

  window.addEventListener('scroll', () => {
    clearActiveHover();
    hideTooltip();
  }, true);
}

function init() {
  loadState();
  composerInput.value = state.text;
  renderUI();
  renderPreview();
  renderVocab();
  bindEvents();
}

init();
