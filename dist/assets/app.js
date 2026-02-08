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
const japaneseCharRegex = new RegExp(`[${japaneseCharRange}]`);
const japaneseEdgeRegex = new RegExp(`^[^${japaneseCharRange}]+|[^${japaneseCharRange}]+$`, 'g');
const japaneseRunRegex = new RegExp(`[${japaneseCharRange}]+`, 'g');
const kanaRegex = /[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]/;
const japanesePunctuationRegex = /^[\u3001\u3002\u30fb\u300c\u300d]+$/;
const smallKanaRegex = /[ゃゅょぁぃぅぇぉャュョァィゥェォ]/;
const smallTsuRegex = /[っッ]/;
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('ja', { granularity: 'word' })
  : null;

const i18n = {
  en: {
    appTitle: 'Japanese Composer',
    appSubtitle: 'Journal workspace with furigana and vocab support',
    editorTitle: 'Composer',
    editorSubtitle: 'Write in English or Japanese — switch to Reading Mode for furigana and kanji details.',
    editorPlaceholder: 'Write your journal entry here...',
    previewEmpty: 'Your text will appear here as you type.',
    vocabTitle: 'Vocabulary',
    vocabSubtitle: 'Saved words from your journal entry.',
    vocabEmpty: 'No vocabulary yet. Hover a kanji and add it here.',
    vocabMeaning: 'Meaning',
    vocabKana: 'Kana',
    vocabKanji: 'Kanji',
    vocabDelete: 'Delete',
    selectionTitle: 'Selection',
    selectionTranslate: 'Translate',
    selectionCopy: 'Copy',
    selectionCopied: 'Copied',
    selectionLoading: 'Translating…',
    selectionError: 'Translation failed.',
    selectionRomaji: 'Romaji',
    furiganaOn: 'Furigana: On',
    furiganaOff: 'Furigana: Off',
    vocabOn: 'Vocab: On',
    vocabOff: 'Vocab: Off',
    languageToggle: '日本語 UI',
    modeEdit: 'Mode: Edit',
    modeRead: 'Mode: Reading',
    addToVocab: 'Add to vocab',
    clear: 'Clear',
    loading: 'Looking up…',
    missing: 'No definition found.'
  },
  ja: {
    appTitle: '日本語コンポーザー',
    appSubtitle: 'ふりがな・語彙リスト付きの作文ワークスペース',
    editorTitle: '作文',
    editorSubtitle: '英語でも日本語でも入力できます。読むモードでふりがなと漢字情報を表示。',
    editorPlaceholder: 'ここに日記を書いてください…',
    previewEmpty: '入力するとここに表示されます。',
    vocabTitle: '語彙リスト',
    vocabSubtitle: '日記から保存した単語を表示します。',
    vocabEmpty: 'まだ語彙がありません。漢字から追加しましょう。',
    vocabMeaning: '意味',
    vocabKana: 'かな',
    vocabKanji: '漢字',
    vocabDelete: '削除',
    selectionTitle: '選択',
    selectionTranslate: '翻訳',
    selectionCopy: 'コピー',
    selectionCopied: 'コピーしました',
    selectionLoading: '翻訳中…',
    selectionError: '翻訳に失敗しました。',
    selectionRomaji: 'ローマ字',
    furiganaOn: 'ふりがな: あり',
    furiganaOff: 'ふりがな: なし',
    vocabOn: '語彙: 表示',
    vocabOff: '語彙: 非表示',
    languageToggle: 'English UI',
    modeEdit: 'モード: 編集',
    modeRead: 'モード: 閲覧',
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
  mode: 'edit',
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
const modeToggle = document.querySelector('#mode-toggle');
const furiganaToggle = document.querySelector('#furigana-toggle');
const vocabToggle = document.querySelector('#vocab-toggle');
const clearVocab = document.querySelector('#clear-vocab');

const tooltip = document.querySelector('#tooltip');
const tooltipWord = document.querySelector('#tooltip-word');
const tooltipReading = document.querySelector('#tooltip-reading');
const tooltipMeaning = document.querySelector('#tooltip-meaning');
const tooltipAdd = document.querySelector('#tooltip-add');
const selectionTooltip = document.querySelector('#selection-tooltip');
const selectionTitle = document.querySelector('#selection-title');
const selectionTranslate = document.querySelector('#selection-translate');
const selectionCopy = document.querySelector('#selection-copy');
const selectionResult = document.querySelector('#selection-result');
let activeHoverBase = null;
let lastSelectionPoint = null;

const defaultText = `今日はカフェで日本語の日記を書きました。\n天気は少し寒かったですが、コーヒーがとてもおいしかったです。\nI want to practice writing more natural sentences.`;

function hasKanji(text) {
  return kanjiRegex.test(text);
}

function isKanji(char) {
  return kanjiRegex.test(char);
}

function hasJapaneseChars(text) {
  return japaneseCharRegex.test(text);
}

function hasKana(text) {
  return kanaRegex.test(text);
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

function splitTokenForFurigana(token, reading) {
  if (!reading) {
    return [{ type: 'plain', text: token }];
  }

  const parts = token.match(/[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]+|[^\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]+/g) || [];
  const hiraReading = toHiragana(reading);
  let rIdx = 0;
  const segments = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (hasKana(part)) {
      segments.push({ type: 'kana', text: part });
      const partHira = toHiragana(part);
      const foundIdx = hiraReading.indexOf(partHira, rIdx);
      if (foundIdx >= 0) {
        rIdx = foundIdx + partHira.length;
      }
      continue;
    }

    if (hasKanji(part)) {
      const nextKana = parts.slice(i + 1).find((item) => hasKana(item));
      const immediateKana = hasKana(parts[i + 1]) ? parts[i + 1] : '';
      const hoverKey = part + okuriganaPrefix(immediateKana);
      let readingPart = '';
      if (nextKana) {
        const nextKanaHira = toHiragana(nextKana);
        const foundIdx = hiraReading.indexOf(nextKanaHira, rIdx);
        if (foundIdx >= 0) {
          readingPart = hiraReading.slice(rIdx, foundIdx);
          rIdx = foundIdx;
        } else {
          readingPart = hiraReading.slice(rIdx);
          rIdx = hiraReading.length;
        }
      } else {
        readingPart = hiraReading.slice(rIdx);
        rIdx = hiraReading.length;
      }
      segments.push({
        type: 'kanji',
        text: part,
        reading: readingPart,
        hoverKey
      });
      continue;
    }

    segments.push({ type: 'plain', text: part });
  }

  return segments;
}

function decodeHtml(text) {
  if (!text) {
    return '';
  }
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

async function resolveReadingForToken(token) {
  const lookupKey = normalizeLookupWord(token);
  if (!lookupKey || !hasKanji(lookupKey)) {
    return '';
  }
  if (lookupCache.has(lookupKey)) {
    return lookupCache.get(lookupKey)?.reading || '';
  }
  const result = await lookupWord(lookupKey);
  lookupCache.set(lookupKey, result);
  return result?.reading || '';
}

async function buildRomajiForText(text) {
  const lines = text.split('\n');
  const outputLines = [];

  for (const line of lines) {
    const segments = segmentLine(line);
    let output = '';
    let lastWasJapaneseWord = false;

    for (const segment of segments) {
      if (!segment) {
        continue;
      }
      if (/^\s+$/.test(segment)) {
        output += segment;
        lastWasJapaneseWord = false;
        continue;
      }

      const isPunctuation = japanesePunctuationRegex.test(segment);
      const isJapanese = hasJapaneseChars(segment);
      let converted = segment;

      if (hasKanji(segment)) {
        const reading = await resolveReadingForToken(segment);
        converted = reading ? kanaToRomaji(reading) : segment;
      } else if (hasKana(segment)) {
        converted = kanaToRomaji(segment);
      }

      if (lastWasJapaneseWord && isJapanese && !isPunctuation) {
        output += ' ';
      }

      output += converted;
      lastWasJapaneseWord = isJapanese && !isPunctuation;
    }

    outputLines.push(output.trim());
  }

  return outputLines.join('\n');
}

function toHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0x60);
  });
}

function okuriganaPrefix(text) {
  if (!text) {
    return '';
  }
  const chars = Array.from(text);
  if (chars.length >= 2 && smallTsuRegex.test(chars[0])) {
    return chars[0] + chars[1];
  }
  if (chars.length >= 2 && smallKanaRegex.test(chars[1])) {
    return chars[0] + chars[1];
  }
  return chars[0];
}

const kanaDigraphMap = {
  きゃ: 'kya',
  きゅ: 'kyu',
  きょ: 'kyo',
  ぎゃ: 'gya',
  ぎゅ: 'gyu',
  ぎょ: 'gyo',
  しゃ: 'sha',
  しゅ: 'shu',
  しょ: 'sho',
  じゃ: 'ja',
  じゅ: 'ju',
  じょ: 'jo',
  ちゃ: 'cha',
  ちゅ: 'chu',
  ちょ: 'cho',
  にゃ: 'nya',
  にゅ: 'nyu',
  にょ: 'nyo',
  ひゃ: 'hya',
  ひゅ: 'hyu',
  ひょ: 'hyo',
  びゃ: 'bya',
  びゅ: 'byu',
  びょ: 'byo',
  ぴゃ: 'pya',
  ぴゅ: 'pyu',
  ぴょ: 'pyo',
  みゃ: 'mya',
  みゅ: 'myu',
  みょ: 'myo',
  りゃ: 'rya',
  りゅ: 'ryu',
  りょ: 'ryo',
  ふぁ: 'fa',
  ふぃ: 'fi',
  ふぇ: 'fe',
  ふぉ: 'fo',
  てぃ: 'ti',
  でぃ: 'di',
  つぁ: 'tsa',
  つぃ: 'tsi',
  つぇ: 'tse',
  つぉ: 'tso',
  うぁ: 'wa',
  うぃ: 'wi',
  うぇ: 'we',
  うぉ: 'wo',
  しぇ: 'she',
  ちぇ: 'che',
  じぇ: 'je'
};

const kanaMap = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo',
  ゔ: 'vu',
  ー: '-',
  '、': ',',
  '。': '.'
};

function kanaToRomaji(text) {
  if (!text) {
    return '';
  }
  const hira = toHiragana(text);
  let result = '';
  for (let i = 0; i < hira.length; i += 1) {
    const char = hira[i];
    const pair = hira.slice(i, i + 2);

    if (char === 'っ') {
      const nextPair = hira.slice(i + 1, i + 3);
      const nextChar = hira[i + 1];
      const nextRomaji = kanaDigraphMap[nextPair] || kanaMap[nextChar] || '';
      if (nextRomaji) {
        result += nextRomaji[0];
      }
      continue;
    }

    if (char === 'ー') {
      const lastVowel = result.match(/[aeiou]$/)?.[0];
      if (lastVowel) {
        result += lastVowel;
      }
      continue;
    }

    if (kanaDigraphMap[pair]) {
      result += kanaDigraphMap[pair];
      i += 1;
      continue;
    }

    if (char === 'ん') {
      const nextChar = hira[i + 1];
      const nextPair = hira.slice(i + 1, i + 3);
      const nextRomaji = kanaDigraphMap[nextPair] || kanaMap[nextChar] || '';
      if (nextRomaji && /^[aeiouy]/.test(nextRomaji)) {
        result += "n'";
      } else {
        result += 'n';
      }
      continue;
    }

    result += kanaMap[char] || char;
  }
  return result;
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
    const selection = selectBestEntry(data?.data, word);
    if (!selection) {
      return null;
    }

    const { entry, form } = selection;
    const reading = form.reading || '';
    const resolvedWord = form.word || word;
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

function selectBestEntry(entries, query) {
  if (!Array.isArray(entries) || !entries.length) {
    return null;
  }
  let best = null;
  let bestScore = -1;
  const normalizedQuery = query.trim();

  entries.forEach((entry) => {
    (entry.japanese || []).forEach((form) => {
      const wordForm = form.word || '';
      const reading = form.reading || '';
      let score = 0;

      if (wordForm && wordForm === normalizedQuery) score += 100;
      if (reading && reading === normalizedQuery) score += 90;
      if (wordForm && wordForm.startsWith(normalizedQuery)) score += 80;
      if (normalizedQuery.startsWith(wordForm) && wordForm) score += 70;
      if (reading && reading.startsWith(normalizedQuery)) score += 60;
      if (normalizedQuery.startsWith(reading) && reading) score += 50;
      if (hasKanji(wordForm) && hasKanji(normalizedQuery)) score += 10;

      if (score > bestScore) {
        bestScore = score;
        best = { entry, form };
      }
    });
  });

  if (!best) {
    return null;
  }
  return best;
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
  const base = document.createElement('span');
  base.className = 'token-base';

  const reading = info?.reading ? toHiragana(info.reading) : '';
  const segments = hasKanji(token) && reading
    ? splitTokenForFurigana(token, reading)
    : [{ type: 'plain', text: token }];

  segments.forEach((segment) => {
    if (segment.type === 'kanji' && segment.reading) {
      const hoverWord = segment.hoverKey || resolvedLookup;
      const ruby = document.createElement('ruby');
      const rb = document.createElement('span');
      rb.className = 'ruby-base';
      for (const char of segment.text) {
        const span = document.createElement('span');
        span.className = isKanji(char) ? 'kanji char' : 'char';
        if (isKanji(char)) {
          span.dataset.word = hoverWord;
        }
        span.textContent = char;
        rb.appendChild(span);
      }
      const rt = document.createElement('rt');
      rt.textContent = segment.reading;
      ruby.appendChild(rb);
      ruby.appendChild(rt);
      base.appendChild(ruby);
      return;
    }

    for (const char of segment.text) {
      const hoverWord = segment.hoverKey || resolvedLookup;
      const span = document.createElement('span');
      span.className = isKanji(char) ? 'kanji char' : 'char';
      if (isKanji(char)) {
        span.dataset.word = hoverWord;
      }
      span.textContent = char;
      base.appendChild(span);
    }
  });

  return base;
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

  const table = document.createElement('div');
  table.className = 'vocab-table';

  const header = document.createElement('div');
  header.className = 'vocab-row vocab-head';
  header.appendChild(buildVocabCell(i18n[state.language].vocabMeaning));
  header.appendChild(buildVocabCell(i18n[state.language].vocabKana));
  header.appendChild(buildVocabCell(i18n[state.language].vocabKanji));
  table.appendChild(header);

  state.vocab.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'vocab-row';

    const meaningText = entry.meaning || '-';
    const hasEntryKanji = hasKanji(entry.word || '');
    const kanaText = entry.reading || (hasEntryKanji ? '-' : (entry.word || '-'));
    const kanjiText = hasEntryKanji ? entry.word : '-';

    row.appendChild(buildVocabCell(meaningText));
    row.appendChild(buildVocabCell(kanaText));
    row.appendChild(buildVocabCell(kanjiText));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'vocab-delete';
    deleteButton.setAttribute('aria-label', i18n[state.language].vocabDelete);
    deleteButton.setAttribute('title', i18n[state.language].vocabDelete);
    deleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 3h6l1 2h4v2h-1.2l-1.1 13.2a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8L5.2 7H4V5h4l1-2zm-1.6 4 1 12.1c.1.2.2.4.5.4h6.2c.3 0 .4-.2.5-.4L16.6 7H7.4zm3 2h2v8h-2V9zm-3 0h2v8h-2V9zm8 0h2v8h-2V9z"/>
      </svg>
    `;
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      state.vocab = state.vocab.filter((_, idx) => idx !== index);
      saveVocab();
      renderVocab();
    });

    row.appendChild(deleteButton);
    table.appendChild(row);
  });

  vocabList.appendChild(table);
}

function buildVocabCell(text) {
  const cell = document.createElement('div');
  cell.className = 'vocab-cell';
  cell.textContent = text;
  return cell;
}

function renderUI() {
  const copy = i18n[state.language];

  document.documentElement.lang = state.language;

  app.classList.toggle('furigana-off', !state.showFurigana);
  app.classList.toggle('vocab-hidden', !state.showVocab);
  app.classList.toggle('reading-mode', state.mode === 'read');

  languageToggle.textContent = copy.languageToggle;
  languageToggle.setAttribute('aria-pressed', state.language === 'ja');

  modeToggle.textContent = state.mode === 'read' ? copy.modeRead : copy.modeEdit;
  modeToggle.setAttribute('aria-pressed', state.mode === 'read');

  furiganaToggle.textContent = state.showFurigana ? copy.furiganaOn : copy.furiganaOff;
  furiganaToggle.setAttribute('aria-pressed', state.showFurigana);

  vocabToggle.textContent = state.showVocab ? copy.vocabOn : copy.vocabOff;
  vocabToggle.setAttribute('aria-pressed', state.showVocab);

  vocabPanel.style.display = state.showVocab ? 'flex' : 'none';
  clearVocab.textContent = copy.clear;
  tooltipAdd.textContent = copy.addToVocab;
  selectionTitle.textContent = copy.selectionTitle;
  selectionTranslate.textContent = copy.selectionTranslate;
  selectionCopy.textContent = copy.selectionCopy;

  document.querySelector('#app-title').textContent = copy.appTitle;
  document.querySelector('#app-subtitle').textContent = copy.appSubtitle;
  document.querySelector('#editor-title').textContent = copy.editorTitle;
  document.querySelector('#editor-subtitle').textContent = copy.editorSubtitle;
  document.querySelector('#vocab-title').textContent = copy.vocabTitle;
  document.querySelector('#vocab-subtitle').textContent = copy.vocabSubtitle;
  composerInput.placeholder = copy.editorPlaceholder;
  composerInput.readOnly = state.mode === 'read';
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
  const lookupKey = normalizeLookupWord(word);
  if (lookupKey && !lookupCache.has(lookupKey) && !pendingLookups.has(lookupKey)) {
    ensureLookup(lookupKey);
  }
  const info = lookupCache.get(lookupKey);
  const pending = pendingLookups.has(lookupKey);

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

function positionFloatingTooltip(element, x, y) {
  const tooltipRect = element.getBoundingClientRect();
  let left = x - tooltipRect.width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tooltipRect.width - 12));

  let top = y + 12;
  if (top + tooltipRect.height > window.innerHeight - 12) {
    top = y - tooltipRect.height - 12;
  }

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function getSelectedText() {
  const start = composerInput.selectionStart ?? 0;
  const end = composerInput.selectionEnd ?? 0;
  if (start === end) {
    return '';
  }
  return composerInput.value.slice(start, end);
}

function showSelectionTooltip(text, point) {
  selectionTooltip.dataset.text = text;
  selectionResult.replaceChildren();
  selectionTooltip.classList.remove('expanded');
  selectionTooltip.setAttribute('aria-hidden', 'false');

  const rect = composerInput.getBoundingClientRect();
  const x = point?.x ?? (rect.left + rect.width / 2);
  const y = point?.y ?? rect.top;
  positionFloatingTooltip(selectionTooltip, x, y);
}

function hideSelectionTooltip() {
  selectionTooltip.setAttribute('aria-hidden', 'true');
  selectionTooltip.classList.remove('expanded');
}

function maybeUpdateSelectionTooltip(point) {
  if (state.mode !== 'edit') {
    hideSelectionTooltip();
    return;
  }
  const text = getSelectedText().trim();
  if (!text) {
    hideSelectionTooltip();
    return;
  }
  showSelectionTooltip(text, point);
}

async function requestTranslation(text) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    throw new Error('Translation failed');
  }
  return response.json();
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
    maybeUpdateSelectionTooltip(lastSelectionPoint);
  });

  composerInput.addEventListener('pointerdown', (event) => {
    lastSelectionPoint = { x: event.clientX, y: event.clientY };
  });

  composerInput.addEventListener('pointerup', (event) => {
    lastSelectionPoint = { x: event.clientX, y: event.clientY };
    requestAnimationFrame(() => {
      maybeUpdateSelectionTooltip(lastSelectionPoint);
    });
  });

  composerInput.addEventListener('keyup', () => {
    requestAnimationFrame(() => {
      maybeUpdateSelectionTooltip(lastSelectionPoint);
    });
  });

  languageToggle.addEventListener('click', () => {
    state.language = state.language === 'en' ? 'ja' : 'en';
    renderUI();
    renderPreview();
    renderVocab();
  });

  modeToggle.addEventListener('click', () => {
    state.mode = state.mode === 'read' ? 'edit' : 'read';
    renderUI();
    clearActiveHover();
    hideTooltip();
    hideSelectionTooltip();
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
    if (state.mode !== 'read') {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const kanjiTarget = target.classList.contains('kanji')
      ? target
      : target.closest('.kanji');
    if (!(kanjiTarget instanceof HTMLElement)) {
      return;
    }
    const word = kanjiTarget.dataset.word;
    if (!word) {
      return;
    }
    const base = kanjiTarget.closest('.token-base');
    if (base instanceof HTMLElement) {
      setActiveHover(base);
    }
    showTooltip(word, kanjiTarget);
  });

  preview.addEventListener('pointerout', (event) => {
    if (state.mode !== 'read') {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const kanjiTarget = target.classList.contains('kanji')
      ? target
      : target.closest('.kanji');
    if (!(kanjiTarget instanceof HTMLElement)) {
      return;
    }
    const base = kanjiTarget.closest('.token-base');
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

  preview.addEventListener('pointerleave', (event) => {
    const related = event.relatedTarget;
    if (related instanceof HTMLElement && tooltip.contains(related)) {
      return;
    }
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

  selectionTranslate.addEventListener('click', async () => {
    const copy = i18n[state.language];
    const text = selectionTooltip.dataset.text?.trim();
    if (!text) {
      return;
    }
  selectionResult.replaceChildren();
  const loading = document.createElement('div');
  loading.textContent = copy.selectionLoading;
  selectionResult.appendChild(loading);
  selectionTooltip.classList.add('expanded');
  try {
      const result = await requestTranslation(text);
      const translation = decodeHtml(result?.translation || '');
      selectionResult.replaceChildren();
      if (!translation) {
        selectionResult.textContent = copy.selectionError;
      } else {
        const translationLine = document.createElement('div');
        translationLine.className = 'selection-translation';
        translationLine.textContent = translation;
        selectionResult.appendChild(translationLine);

        if (result?.targetLanguage === 'ja') {
          const romaji = await buildRomajiForText(translation);
          if (romaji) {
            const romajiLine = document.createElement('div');
            romajiLine.className = 'selection-romaji';
            romajiLine.textContent = `${copy.selectionRomaji}: ${romaji}`;
            selectionResult.appendChild(romajiLine);
          }
        }
      }
  } catch (error) {
      selectionResult.textContent = copy.selectionError;
  }
  });

  selectionCopy.addEventListener('click', async () => {
    const copy = i18n[state.language];
    const text = selectionTooltip.dataset.text?.trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      selectionCopy.textContent = copy.selectionCopied;
      setTimeout(() => {
        selectionCopy.textContent = copy.selectionCopy;
      }, 1200);
    } catch (error) {
      selectionCopy.textContent = copy.selectionError;
      setTimeout(() => {
        selectionCopy.textContent = copy.selectionCopy;
      }, 1200);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (selectionTooltip.contains(target) || composerInput.contains(target)) {
      return;
    }
    hideSelectionTooltip();
  });

  window.addEventListener('scroll', () => {
    clearActiveHover();
    hideTooltip();
    hideSelectionTooltip();
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
