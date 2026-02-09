const DIRECT_DICT_ENDPOINT = 'https://jisho.org/api/v1/search/words?keyword=';
const PROXY_DICT_ENDPOINT = '/api/lookup?keyword=';
const VOCAB_API_ENDPOINT = '/api/vocab';
const preferProxy = typeof window !== 'undefined'
  && window.location
  && ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
const vocabApiEnabled = typeof window !== 'undefined'
  && window.location
  && window.location.protocol !== 'file:';
let vocabApiAvailable = vocabApiEnabled;
const STORAGE_KEYS = {
  entry: 'jc_entry',
  vocab: 'jc_vocab_list',
  questions: 'jc_questions',
  documents: 'jc_documents',
  activeDocument: 'jc_active_document'
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
const monthTokenRegex = /^[0-9\uFF10-\uFF19]+月$/;
const tokenizableCharRange = `${japaneseCharRange}0-9\uFF10-\uFF19`;
const tokenizableRunRegex = new RegExp(`[${tokenizableCharRange}]+`, 'g');
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('ja', { granularity: 'word' })
  : null;

const tokenReadingOverrides = new Map([
  ['日本', 'にほん'],
  ['大谷', 'おおたに'],
  ['弘和', 'ひろかず']
]);

const compoundReadingOverrides = new Map([
  ['世界大会', 'せかいたいかい'],
  ['大活躍', 'だいかつやく'],
  ['翔平', 'しょうへい']
]);

const i18n = {
  en: {
    appTitle: 'Japanese Composer',
    appSubtitle: 'Journal workspace with furigana and vocab support',
    editorTitle: 'Composer',
    editorSubtitle: 'Write in English or Japanese — switch to Reading Mode for furigana and kanji details.',
    editorPlaceholder: 'Write your journal entry here...',
    documentTitleLabel: 'Document title',
    documentTitlePlaceholder: 'Give this entry a title...',
    documentSelectLabel: 'Saved documents',
    documentSelectPlaceholder: 'Choose a document',
    documentNew: 'New',
    documentSave: 'Save',
    documentDelete: 'Delete',
    documentDeleteConfirm: 'Delete this document? This cannot be undone.',
    documentUntitled: 'Untitled entry',
    previewEmpty: 'Switch to edit mode to enable editing',
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
    selectionAsk: 'Ask',
    selectionAskLabel: 'Ask about selected text',
    selectionAskPlaceholder: 'Ask a question about this text...',
    selectionAskSubmit: 'Send',
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
    collapse: 'Collapse',
    expand: 'Expand',
    loading: 'Looking up…',
    missing: 'No definition found.',
    proofreadTitle: 'Proofreading',
    proofreadSubtitle: 'Send the full entry to OpenAI for JLPT feedback and corrections.',
    proofreadButton: 'Proofread',
    proofreadEmpty: 'No feedback yet. Click Proofread to analyze your entry.',
    proofreadLoading: 'Proofreading…',
    proofreadError: 'Proofreading failed.',
    proofreadMissing: 'Enter some text to proofread.',
    proofreadUpdated: 'Last updated',
    selectionAskLoading: 'Asking…',
    selectionAskError: 'Question failed.',
    selectionAskMissing: 'Enter a question to ask.',
    questionsTitle: 'Questions',
    questionsSubtitle: 'Your Q&A about selected text.',
    questionsEmpty: 'No questions yet. Select text and ask a question.',
    questionsSelectedLabel: 'Selected text',
    questionsQuestionLabel: 'Question',
    questionsAnswerLabel: 'Answer'
  },
  ja: {
    appTitle: '日本語コンポーザー',
    appSubtitle: 'ふりがな・語彙リスト付きの作文ワークスペース',
    editorTitle: '作文',
    editorSubtitle: '英語でも日本語でも入力できます。読むモードでふりがなと漢字情報を表示。',
    editorPlaceholder: 'ここに日記を書いてください…',
    documentTitleLabel: 'タイトル',
    documentTitlePlaceholder: 'この作文のタイトルを入力…',
    documentSelectLabel: '保存した作文',
    documentSelectPlaceholder: '作文を選択',
    documentNew: '新規',
    documentSave: '保存',
    documentDelete: '削除',
    documentDeleteConfirm: 'この作文を削除しますか？元に戻せません。',
    documentUntitled: '無題',
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
    selectionAsk: '質問',
    selectionAskLabel: '選択テキストについて質問',
    selectionAskPlaceholder: '選択したテキストについて質問…',
    selectionAskSubmit: '送信',
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
    collapse: '折りたたむ',
    expand: '展開',
    loading: '検索中…',
    missing: '意味が見つかりません。',
    proofreadTitle: '添削フィードバック',
    proofreadSubtitle: '全文をOpenAIに送ってJLPT判定と添削を受けます。',
    proofreadButton: '添削する',
    proofreadEmpty: 'まだフィードバックがありません。添削するをクリックしてください。',
    proofreadLoading: '添削中…',
    proofreadError: '添削に失敗しました。',
    proofreadMissing: 'まずテキストを入力してください。',
    proofreadUpdated: '更新',
    selectionAskLoading: '質問中…',
    selectionAskError: '質問に失敗しました。',
    selectionAskMissing: '質問を入力してください。',
    questionsTitle: '質問',
    questionsSubtitle: '選択テキストに関するQ&A。',
    questionsEmpty: 'まだ質問がありません。テキストを選択して質問してください。',
    questionsSelectedLabel: '選択テキスト',
    questionsQuestionLabel: '質問',
    questionsAnswerLabel: '回答'
  }
};

const state = {
  documentId: '',
  title: '',
  documents: [],
  text: '',
  showFurigana: true,
  showVocab: true,
  language: 'en',
  mode: 'edit',
  vocab: [],
  questions: []
};

const proofreadState = {
  status: 'idle',
  content: '',
  error: '',
  updatedAt: null
};

const lookupCache = new Map();
const pendingLookups = new Map();
let pendingRender = false;
let vocabSaveQueue = Promise.resolve();

function enqueueVocabApiTask(task) {
  vocabSaveQueue = vocabSaveQueue
    .then(() => task())
    .catch(() => {});
}
let kuromojiTokenizer = null;
let kuromojiInitPromise = null;

const app = document.querySelector('#app');
const composerInput = document.querySelector('#composer-input');
const documentTitleInput = document.querySelector('#document-title');
const documentTitleLabel = document.querySelector('#document-title-label');
const documentSelect = document.querySelector('#document-select');
const documentSelectLabel = document.querySelector('#document-select-label');
const documentSave = document.querySelector('#document-save');
const documentNew = document.querySelector('#document-new');
const documentDelete = document.querySelector('#document-delete');
const preview = document.querySelector('#preview');
const vocabPanel = document.querySelector('#vocab-panel');
const vocabBody = document.querySelector('#vocab-body');
const vocabCollapse = document.querySelector('#vocab-collapse');
const vocabList = document.querySelector('#vocab-list');
const questionsPanel = document.querySelector('#questions-panel');
const questionsBody = document.querySelector('#questions-body');
const questionsCollapse = document.querySelector('#questions-collapse');
const questionsTitle = document.querySelector('#questions-title');
const questionsSubtitle = document.querySelector('#questions-subtitle');
const questionsList = document.querySelector('#questions-list');
const languageToggle = document.querySelector('#language-toggle');
const modeToggle = document.querySelector('#mode-toggle');
const furiganaToggle = document.querySelector('#furigana-toggle');
const vocabToggle = document.querySelector('#vocab-toggle');
const clearVocab = document.querySelector('#clear-vocab');
const proofreadTitle = document.querySelector('#proofread-title');
const proofreadSubtitle = document.querySelector('#proofread-subtitle');
const proofreadButton = document.querySelector('#proofread-button');
const proofreadMeta = document.querySelector('#proofread-meta');
const proofreadResult = document.querySelector('#proofread-result');

const tooltip = document.querySelector('#tooltip');
const tooltipWord = document.querySelector('#tooltip-word');
const tooltipReading = document.querySelector('#tooltip-reading');
const tooltipMeaning = document.querySelector('#tooltip-meaning');
const tooltipAdd = document.querySelector('#tooltip-add');
const selectionTooltip = document.querySelector('#selection-tooltip');
const selectionTitle = document.querySelector('#selection-title');
const selectionTranslate = document.querySelector('#selection-translate');
const selectionCopy = document.querySelector('#selection-copy');
const selectionAsk = document.querySelector('#selection-ask');
const selectionAskForm = document.querySelector('#selection-ask-form');
const selectionAskLabel = document.querySelector('#selection-ask-label');
const selectionAskInput = document.querySelector('#selection-ask-input');
const selectionAskSubmit = document.querySelector('#selection-ask-submit');
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

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(text) {
  const escaped = escapeHtml(text);
  const codeSegments = [];
  let output = escaped.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = codeSegments.length;
    codeSegments.push(code);
    return `{{CODE_${idx}}}`;
  });

  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  output = output.replace(/\{\{CODE_(\d+)\}\}/g, (_match, idx) => {
    const code = codeSegments[Number(idx)] ?? '';
    return `<code>${code}</code>`;
  });

  return output;
}

function renderMarkdown(container, text) {
  container.replaceChildren();
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    const p = document.createElement('p');
    p.innerHTML = renderInlineMarkdown(paragraph.join(' ').trim());
    container.appendChild(p);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (line.trim().startsWith('```')) {
      flushParagraph();
      const codeLines = [];
      for (i += 1; i < lines.length; i += 1) {
        if (lines[i].trim().startsWith('```')) {
          break;
        }
        codeLines.push(lines[i]);
      }
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
      const heading = document.createElement(tag);
      heading.innerHTML = renderInlineMarkdown(headingMatch[2].trim());
      container.appendChild(heading);
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const list = document.createElement(orderedMatch ? 'ol' : 'ul');
      for (; i < lines.length; i += 1) {
        const current = lines[i];
        const currentUnordered = current.match(/^\s*[-*•]\s+(.+)$/);
        const currentOrdered = current.match(/^\s*\d+\.\s+(.+)$/);
        if (orderedMatch && !currentOrdered) {
          break;
        }
        if (unorderedMatch && !currentUnordered) {
          break;
        }
        const itemText = (orderedMatch ? currentOrdered[1] : currentUnordered[1]).trim();
        const li = document.createElement('li');
        li.innerHTML = renderInlineMarkdown(itemText);
        list.appendChild(li);
      }
      i -= 1;
      container.appendChild(list);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
}

function initKuromoji() {
  if (kuromojiInitPromise) {
    return kuromojiInitPromise;
  }
  const api = typeof window !== 'undefined' ? window.kuromoji : null;
  if (!api) {
    kuromojiInitPromise = Promise.resolve(null);
    return kuromojiInitPromise;
  }
  const basePath = new URL('./', window.location.href).pathname;
  const dicPath = `${basePath}assets/kuromoji-dict/`;
  kuromojiInitPromise = new Promise((resolve) => {
    api.builder({ dicPath }).build((error, tokenizer) => {
      if (error) {
        console.warn('Kuromoji init failed', error, dicPath);
        resolve(null);
        return;
      }
      kuromojiTokenizer = tokenizer;
      resolve(tokenizer);
    });
  });
  return kuromojiInitPromise;
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
    const segments = getLineTokens(line);
    let output = '';
    let lastWasJapaneseWord = false;

    for (const segment of segments) {
      const raw = segment?.text ?? '';
      if (!raw) {
        continue;
      }
      if (/^\s+$/.test(raw)) {
        output += raw;
        lastWasJapaneseWord = false;
        continue;
      }

      const isPunctuation = japanesePunctuationRegex.test(raw);
      const isJapanese = hasJapaneseChars(raw);
      let converted = raw;

      if (segment.reading) {
        converted = kanaToRomaji(segment.reading);
      } else if (hasKanji(raw)) {
        const reading = await resolveReadingForToken(raw);
        converted = reading ? kanaToRomaji(reading) : raw;
      } else if (hasKana(raw)) {
        converted = kanaToRomaji(raw);
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

function splitTokenizableRuns(text) {
  if (!text) {
    return [{ type: 'plain', text: '' }];
  }
  tokenizableRunRegex.lastIndex = 0;
  const segments = [];
  let lastIndex = 0;
  for (const match of text.matchAll(tokenizableRunRegex)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ type: 'plain', text: text.slice(lastIndex, start) });
    }
    const runText = match[0];
    if (runText) {
      segments.push({ type: 'tokenize', text: runText });
    }
    lastIndex = start + runText.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'plain', text: text.slice(lastIndex) });
  }
  if (!segments.length) {
    segments.push({ type: 'plain', text });
  }
  return segments;
}

function tokenizeLineWithKuromoji(line) {
  if (!kuromojiTokenizer) {
    return null;
  }
  const tokens = [];
  const segments = splitTokenizableRuns(line);
  segments.forEach((segment) => {
    if (segment.type === 'plain') {
      tokens.push({ text: segment.text, reading: '' });
      return;
    }
    const kuromojiTokens = kuromojiTokenizer.tokenize(segment.text);
    kuromojiTokens.forEach((token) => {
      const reading = token.reading && token.reading !== '*' ? token.reading : '';
      tokens.push({
        text: token.surface_form || '',
        reading
      });
    });
  });
  return tokens;
}

function applyReadingOverrides(tokens) {
  if (!Array.isArray(tokens)) {
    return tokens;
  }

  const merged = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    if (!current || !current.text) {
      merged.push(current);
      continue;
    }

    const next = tokens[i + 1];
    if (next && next.text && !/^\s+$/.test(current.text) && !/^\s+$/.test(next.text)) {
      const combinedText = current.text + next.text;
      const combinedReading = compoundReadingOverrides.get(combinedText);
      if (combinedReading) {
        merged.push({ text: combinedText, reading: combinedReading });
        i += 1;
        continue;
      }
    }

    merged.push(current);
  }

  return merged.map((token) => {
    if (!token || !token.text) {
      return token;
    }
    const override = tokenReadingOverrides.get(token.text);
    if (override) {
      return { ...token, reading: override };
    }
    if (monthTokenRegex.test(token.text)) {
      return { ...token, reading: 'がつ' };
    }
    return token;
  });
}

function getLineTokens(line) {
  const kuromojiTokens = tokenizeLineWithKuromoji(line);
  if (kuromojiTokens) {
    return applyReadingOverrides(kuromojiTokens);
  }
  const segments = segmentLine(line).map((segment) => ({ text: segment, reading: '' }));
  return applyReadingOverrides(segments);
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

function generateDocumentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeVocabEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const word = typeof entry.word === 'string' ? entry.word : '';
      const reading = typeof entry.reading === 'string' ? entry.reading : '';
      const meaning = typeof entry.meaning === 'string' ? entry.meaning : '';
      const addedAt = Number.isFinite(entry.addedAt) ? Math.trunc(entry.addedAt) : now;
      if (!word && !reading && !meaning) {
        return null;
      }
      return {
        word,
        reading,
        meaning,
        addedAt
      };
    })
    .filter(Boolean);
}

function normalizeQuestionEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const selectedText = typeof entry.selectedText === 'string' ? entry.selectedText : '';
      const question = typeof entry.question === 'string' ? entry.question : '';
      const answer = typeof entry.answer === 'string' ? entry.answer : '';
      const createdAt = Number.isFinite(entry.createdAt) ? Math.trunc(entry.createdAt) : now;
      if (!selectedText && !question && !answer) {
        return null;
      }
      return {
        selectedText,
        question,
        answer,
        createdAt
      };
    })
    .filter(Boolean);
}

function normalizeDocumentEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  const seenIds = new Set();
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : generateDocumentId();
      if (seenIds.has(id)) {
        id = generateDocumentId();
      }
      seenIds.add(id);
      const title = typeof entry.title === 'string' ? entry.title : '';
      const text = typeof entry.text === 'string' ? entry.text : '';
      const vocab = normalizeVocabEntries(entry.vocab);
      const questions = normalizeQuestionEntries(entry.questions);
      const proofreadContent = typeof entry.proofreadContent === 'string' ? entry.proofreadContent : '';
      const proofreadUpdatedAt = Number.isFinite(entry.proofreadUpdatedAt)
        ? Math.trunc(entry.proofreadUpdatedAt)
        : null;
      const createdAt = Number.isFinite(entry.createdAt) ? Math.trunc(entry.createdAt) : now;
      const updatedAt = Number.isFinite(entry.updatedAt) ? Math.trunc(entry.updatedAt) : createdAt;
      return {
        id,
        title,
        text,
        vocab,
        questions,
        proofreadContent,
        proofreadUpdatedAt,
        createdAt,
        updatedAt
      };
    })
    .filter(Boolean);
}

function loadVocabFromStorage() {
  const storedVocab = safeStorageGet(STORAGE_KEYS.vocab);
  if (!storedVocab) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedVocab);
    return normalizeVocabEntries(parsed);
  } catch (error) {
    return [];
  }
}

function loadQuestionsFromStorage() {
  const storedQuestions = safeStorageGet(STORAGE_KEYS.questions);
  if (!storedQuestions) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedQuestions);
    return normalizeQuestionEntries(parsed);
  } catch (error) {
    return [];
  }
}

function loadDocumentsFromStorage() {
  const storedDocuments = safeStorageGet(STORAGE_KEYS.documents);
  if (!storedDocuments) {
    return [];
  }
  try {
    const parsed = JSON.parse(storedDocuments);
    return normalizeDocumentEntries(parsed);
  } catch (error) {
    return [];
  }
}

function saveDocumentsToStorage() {
  safeStorageSet(STORAGE_KEYS.documents, JSON.stringify(state.documents));
}

async function fetchVocabFromApi() {
  if (!vocabApiAvailable) {
    return null;
  }
  try {
    const response = await fetch(VOCAB_API_ENDPOINT, { method: 'GET' });
    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        vocabApiAvailable = false;
      }
      return null;
    }
    const data = await response.json();
    if (!Array.isArray(data?.items)) {
      return null;
    }
    return normalizeVocabEntries(data.items);
  } catch (error) {
    vocabApiAvailable = false;
    return null;
  }
}

async function hydrateVocabFromApi() {
  if (state.documents.length > 1 || state.vocab.length) {
    return;
  }
  const items = await fetchVocabFromApi();
  if (items === null) {
    return;
  }
  state.vocab = items;
  persistActiveDocument();
  renderVocab();
}

async function persistVocabToApi(items) {
  if (!vocabApiAvailable) {
    return;
  }
  try {
    const response = await fetch(VOCAB_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ items })
    });
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      vocabApiAvailable = false;
    }
  } catch (error) {
    vocabApiAvailable = false;
  }
}

async function deleteVocabEntryFromApi(entry) {
  if (!vocabApiAvailable) {
    return;
  }
  try {
    const response = await fetch(VOCAB_API_ENDPOINT, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ entry })
    });
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      vocabApiAvailable = false;
    }
  } catch (error) {
    vocabApiAvailable = false;
  }
}

function enqueueVocabDelete(entry) {
  const normalized = normalizeVocabEntries([entry])[0];
  if (!normalized) {
    return;
  }
  enqueueVocabApiTask(() => deleteVocabEntryFromApi(normalized));
}

function createDocument({ title = '', text = '', vocab = [], questions = [] } = {}) {
  const now = Date.now();
  return {
    id: generateDocumentId(),
    title,
    text,
    vocab: normalizeVocabEntries(vocab),
    questions: normalizeQuestionEntries(questions),
    proofreadContent: '',
    proofreadUpdatedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function applyDocumentToState(doc) {
  state.documentId = doc.id;
  state.title = doc.title || '';
  state.text = doc.text || '';
  state.vocab = normalizeVocabEntries(doc.vocab);
  state.questions = normalizeQuestionEntries(doc.questions);
}

function hydrateProofreadFromDocument(doc, { reset = false } = {}) {
  if (reset) {
    setProofreadState({
      status: 'idle',
      content: '',
      error: '',
      updatedAt: null
    });
    return;
  }
  const content = typeof doc.proofreadContent === 'string' ? doc.proofreadContent : '';
  const updatedAt = Number.isFinite(doc.proofreadUpdatedAt)
    ? new Date(doc.proofreadUpdatedAt)
    : null;
  if (content) {
    setProofreadState({
      status: 'success',
      content,
      error: '',
      updatedAt
    });
  } else {
    setProofreadState({
      status: 'idle',
      content: '',
      error: '',
      updatedAt: null
    });
  }
}

function persistActiveDocument({ updateList = false, normalize = false } = {}) {
  if (!state.documentId) {
    return;
  }
  const now = Date.now();
  const normalizedVocab = normalize ? normalizeVocabEntries(state.vocab) : state.vocab;
  const normalizedQuestions = normalize ? normalizeQuestionEntries(state.questions) : state.questions;
  if (normalize) {
    state.vocab = normalizedVocab;
    state.questions = normalizedQuestions;
  }

  const index = state.documents.findIndex((doc) => doc.id === state.documentId);
  const hasProofread = proofreadState.status === 'success' && Boolean(proofreadState.content);
  const proofreadContent = hasProofread ? proofreadState.content : null;
  const proofreadUpdatedAt = hasProofread
    ? (proofreadState.updatedAt instanceof Date ? proofreadState.updatedAt.getTime() : now)
    : null;
  if (index === -1) {
    state.documents.unshift({
      id: state.documentId,
      title: state.title,
      text: state.text,
      vocab: normalizedVocab,
      questions: normalizedQuestions,
      proofreadContent: proofreadContent || '',
      proofreadUpdatedAt,
      createdAt: now,
      updatedAt: now
    });
  } else {
    const doc = state.documents[index];
    doc.title = state.title;
    doc.text = state.text;
    doc.vocab = normalizedVocab;
    doc.questions = normalizedQuestions;
    if (hasProofread) {
      doc.proofreadContent = proofreadContent || '';
      doc.proofreadUpdatedAt = proofreadUpdatedAt;
    }
    doc.updatedAt = now;
  }

  saveDocumentsToStorage();
  safeStorageSet(STORAGE_KEYS.activeDocument, state.documentId);

  if (updateList) {
    renderDocumentSelect();
  }
}

function setActiveDocument(doc, { resetProofread = true } = {}) {
  applyDocumentToState(doc);
  safeStorageSet(STORAGE_KEYS.activeDocument, state.documentId);
  if (documentTitleInput && documentTitleInput.value !== state.title) {
    documentTitleInput.value = state.title;
  }
  composerInput.value = state.text;
  renderDocumentSelect();
  renderPreview();
  renderVocab();
  renderQuestions();
  hydrateProofreadFromDocument(doc, { reset: resetProofread });
  clearActiveHover();
  hideTooltip();
  hideSelectionTooltip();
}

function buildLegacyDocument() {
  const storedEntry = safeStorageGet(STORAGE_KEYS.entry);
  const legacyVocab = loadVocabFromStorage();
  const legacyQuestions = loadQuestionsFromStorage();
  if (!storedEntry && !legacyVocab.length && !legacyQuestions.length) {
    return null;
  }
  return {
    id: generateDocumentId(),
    title: '',
    text: storedEntry || defaultText,
    vocab: legacyVocab,
    questions: legacyQuestions,
    proofreadContent: '',
    proofreadUpdatedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function loadState() {
  state.documents = loadDocumentsFromStorage();
  if (!state.documents.length) {
    const legacyDocument = buildLegacyDocument();
    state.documents = legacyDocument ? [legacyDocument] : [createDocument({ text: defaultText })];
    saveDocumentsToStorage();
  }

  const storedActiveId = safeStorageGet(STORAGE_KEYS.activeDocument);
  const activeDocument = storedActiveId
    ? state.documents.find((doc) => doc.id === storedActiveId)
    : null;
  setActiveDocument(activeDocument || state.documents[0], { resetProofread: false });
}

function saveEntry() {
  persistActiveDocument();
}

function saveVocab({ persist = true } = {}) {
  const normalized = normalizeVocabEntries(state.vocab);
  state.vocab = normalized;
  persistActiveDocument();
  if (!persist) {
    return;
  }
  enqueueVocabApiTask(() => persistVocabToApi(normalized));
}

function saveQuestions() {
  const normalized = normalizeQuestionEntries(state.questions);
  state.questions = normalized;
  persistActiveDocument();
}

function deleteActiveDocument() {
  if (!state.documentId || !state.documents.length) {
    return;
  }
  const index = state.documents.findIndex((doc) => doc.id === state.documentId);
  if (index === -1) {
    return;
  }
  state.documents.splice(index, 1);
  if (!state.documents.length) {
    state.documents = [createDocument()];
  }
  saveDocumentsToStorage();
  const nextIndex = Math.min(index, state.documents.length - 1);
  setActiveDocument(state.documents[nextIndex]);
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
    const segments = getLineTokens(line);
    segments.forEach((segment) => {
      const raw = segment?.text ?? '';
      if (!raw) {
        return;
      }

      if (hasKanji(raw)) {
        const lookupWord = normalizeLookupWord(raw);
        ensureLookup(lookupWord);
        const info = lookupCache.get(lookupWord);
        const readingInfo = segment.reading ? { reading: segment.reading } : info;
        preview.appendChild(buildTokenElement(raw, readingInfo, lookupWord));
      } else {
        preview.appendChild(document.createTextNode(raw));
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
  header.appendChild(buildVocabCell(i18n[state.language].vocabDelete));
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
      const removed = state.vocab[index];
      state.vocab = state.vocab.filter((_, idx) => idx !== index);
      saveVocab();
      enqueueVocabDelete(removed);
      renderVocab();
    });

    row.appendChild(deleteButton);
    table.appendChild(row);
  });

  vocabList.appendChild(table);
}

function renderQuestions() {
  const copy = i18n[state.language];
  questionsList.replaceChildren();

  if (!state.questions.length) {
    const empty = document.createElement('div');
    empty.className = 'questions-empty';
    empty.textContent = copy.questionsEmpty;
    questionsList.appendChild(empty);
    return;
  }

  state.questions.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'question-card';

    const selectedLabel = document.createElement('div');
    selectedLabel.className = 'question-label';
    selectedLabel.textContent = copy.questionsSelectedLabel;

    const selectedText = document.createElement('div');
    selectedText.className = 'question-text';
    selectedText.textContent = entry.selectedText || '';

    const questionLabel = document.createElement('div');
    questionLabel.className = 'question-label';
    questionLabel.textContent = copy.questionsQuestionLabel;

    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = entry.question || '';

    const answerLabel = document.createElement('div');
    answerLabel.className = 'question-label';
    answerLabel.textContent = copy.questionsAnswerLabel;

    const answerText = document.createElement('div');
    answerText.className = 'question-answer';
    answerText.textContent = entry.answer || '';

    card.appendChild(selectedLabel);
    card.appendChild(selectedText);
    card.appendChild(questionLabel);
    card.appendChild(questionText);
    card.appendChild(answerLabel);
    card.appendChild(answerText);

    questionsList.appendChild(card);
  });
}

function buildDocumentLabel(doc, copy) {
  const title = typeof doc.title === 'string' ? doc.title.trim() : '';
  return title || copy.documentUntitled;
}

function formatDocumentUpdatedAt(doc, locale) {
  const timestamp = Number.isFinite(doc.updatedAt) ? doc.updatedAt : null;
  if (!timestamp) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(timestamp));
  } catch (error) {
    return '';
  }
}

function buildDocumentOptionLabel(doc, copy, locale) {
  const title = buildDocumentLabel(doc, copy);
  const updatedAt = formatDocumentUpdatedAt(doc, locale);
  if (!updatedAt) {
    return title;
  }
  return `${title} — ${updatedAt}`;
}

function renderDocumentSelect() {
  if (!documentSelect) {
    return;
  }
  const copy = i18n[state.language];
  const locale = state.language === 'ja' ? 'ja-JP' : 'en-US';
  documentSelect.replaceChildren();
  if (!state.documents.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = copy.documentSelectPlaceholder;
    documentSelect.appendChild(option);
    documentSelect.disabled = true;
    return;
  }
  documentSelect.disabled = false;
  state.documents.forEach((doc) => {
    const option = document.createElement('option');
    option.value = doc.id;
    option.textContent = buildDocumentOptionLabel(doc, copy, locale);
    documentSelect.appendChild(option);
  });
  if (state.documentId) {
    documentSelect.value = state.documentId;
  }
}

function renderDocumentControls() {
  const copy = i18n[state.language];
  if (documentTitleLabel) {
    documentTitleLabel.textContent = copy.documentTitleLabel;
  }
  if (documentSelectLabel) {
    documentSelectLabel.textContent = copy.documentSelectLabel;
  }
  if (documentTitleInput) {
    documentTitleInput.placeholder = copy.documentTitlePlaceholder;
    if (documentTitleInput.value !== state.title) {
      documentTitleInput.value = state.title;
    }
  }
  if (documentSave) {
    documentSave.textContent = copy.documentSave;
  }
  if (documentNew) {
    documentNew.textContent = copy.documentNew;
  }
  if (documentDelete) {
    documentDelete.textContent = copy.documentDelete;
  }
  renderDocumentSelect();
}

function buildVocabCell(text) {
  const cell = document.createElement('div');
  cell.className = 'vocab-cell';
  cell.textContent = text;
  return cell;
}

function syncPanelToggle(panel, body, button, copy) {
  if (!panel || !body || !button) {
    return;
  }
  const isCollapsed = panel.classList.contains('is-collapsed');
  body.setAttribute('aria-hidden', String(isCollapsed));
  button.setAttribute('aria-expanded', String(!isCollapsed));
  button.textContent = isCollapsed ? copy.expand : copy.collapse;
}

function setPanelCollapsed(panel, body, button, collapsed) {
  if (!panel || !body || !button) {
    return;
  }
  panel.classList.toggle('is-collapsed', collapsed);
  syncPanelToggle(panel, body, button, i18n[state.language]);
}

function renderUI() {
  const copy = i18n[state.language];

  document.documentElement.lang = state.language;

  app.classList.toggle('furigana-off', !state.showFurigana);
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
  syncPanelToggle(vocabPanel, vocabBody, vocabCollapse, copy);
  syncPanelToggle(questionsPanel, questionsBody, questionsCollapse, copy);
  clearVocab.textContent = copy.clear;
  tooltipAdd.textContent = copy.addToVocab;
  selectionTitle.textContent = copy.selectionTitle;
  selectionTranslate.textContent = copy.selectionTranslate;
  selectionCopy.textContent = copy.selectionCopy;
  selectionAsk.textContent = copy.selectionAsk;
  selectionAskSubmit.textContent = copy.selectionAskSubmit;
  selectionAskLabel.textContent = copy.selectionAskLabel;
  selectionAskInput.placeholder = copy.selectionAskPlaceholder;

  document.querySelector('#app-title').textContent = copy.appTitle;
  document.querySelector('#app-subtitle').textContent = copy.appSubtitle;
  document.querySelector('#editor-title').textContent = copy.editorTitle;
  document.querySelector('#editor-subtitle').textContent = copy.editorSubtitle;
  document.querySelector('#vocab-title').textContent = copy.vocabTitle;
  document.querySelector('#vocab-subtitle').textContent = copy.vocabSubtitle;
  questionsTitle.textContent = copy.questionsTitle;
  questionsSubtitle.textContent = copy.questionsSubtitle;
  composerInput.placeholder = copy.editorPlaceholder;
  composerInput.readOnly = state.mode === 'read';

  renderDocumentControls();
  renderProofread();
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
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  let left = targetRect.left + scrollX + targetRect.width / 2 - tooltipRect.width / 2;
  left = Math.max(scrollX + 12, Math.min(left, scrollX + window.innerWidth - tooltipRect.width - 12));

  let top = targetRect.bottom + scrollY + 12;
  if (top + tooltipRect.height > scrollY + window.innerHeight - 12) {
    top = targetRect.top + scrollY - tooltipRect.height - 12;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.setAttribute('aria-hidden', 'true');
}

function positionFloatingTooltip(element, x, y) {
  const tooltipRect = element.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  let left = x + scrollX - tooltipRect.width / 2;
  left = Math.max(scrollX + 12, Math.min(left, scrollX + window.innerWidth - tooltipRect.width - 12));

  let top = y + scrollY + 12;
  if (top + tooltipRect.height > scrollY + window.innerHeight - 12) {
    top = y + scrollY - tooltipRect.height - 12;
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

function resetSelectionAsk() {
  selectionAskInput.value = '';
  selectionAskInput.disabled = false;
  selectionAskSubmit.disabled = false;
  selectionTooltip.classList.remove('ask-open');
}

function showSelectionTooltip(text, point) {
  selectionTooltip.dataset.text = text;
  selectionResult.replaceChildren();
  selectionTooltip.classList.remove('expanded');
  resetSelectionAsk();
  selectionTooltip.setAttribute('aria-hidden', 'false');

  const rect = composerInput.getBoundingClientRect();
  const x = point?.x ?? (rect.left + rect.width / 2);
  const y = point?.y ?? rect.top;
  positionFloatingTooltip(selectionTooltip, x, y);
}

function hideSelectionTooltip() {
  selectionTooltip.setAttribute('aria-hidden', 'true');
  selectionTooltip.classList.remove('expanded');
  resetSelectionAsk();
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

async function requestProofread(text) {
  const response = await fetch('/api/proofread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = data?.error || 'Proofreading failed';
    throw new Error(message);
  }
  return data;
}

async function requestAsk(text, question) {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, question })
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  if (!response.ok) {
    const message = data?.error || 'Question failed';
    throw new Error(message);
  }
  return data;
}

function formatProofreadTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const locale = state.language === 'ja' ? 'ja-JP' : 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch (error) {
    return date.toLocaleString();
  }
}

function renderProofread() {
  const copy = i18n[state.language];

  proofreadTitle.textContent = copy.proofreadTitle;
  proofreadSubtitle.textContent = copy.proofreadSubtitle;
  proofreadButton.textContent = copy.proofreadButton;

  const hasText = Boolean(state.text.trim());
  const isLoading = proofreadState.status === 'loading';
  proofreadButton.disabled = isLoading || !hasText;
  proofreadButton.setAttribute('aria-busy', isLoading);

  proofreadResult.classList.remove('is-empty', 'is-loading', 'is-error', 'markdown');

  if (proofreadState.status === 'loading') {
    proofreadResult.textContent = copy.proofreadLoading;
    proofreadResult.classList.add('is-loading');
  } else if (proofreadState.status === 'error') {
    proofreadResult.textContent = proofreadState.error || copy.proofreadError;
    proofreadResult.classList.add('is-error');
  } else if (proofreadState.status === 'success') {
    if (!proofreadState.content) {
      proofreadResult.textContent = copy.proofreadEmpty;
      proofreadResult.classList.add('is-empty');
    } else {
      proofreadResult.classList.add('markdown');
      renderMarkdown(proofreadResult, proofreadState.content);
    }
  } else {
    proofreadResult.textContent = copy.proofreadEmpty;
    proofreadResult.classList.add('is-empty');
  }

  if (proofreadState.status === 'success' && proofreadState.updatedAt) {
    const timestamp = formatProofreadTimestamp(proofreadState.updatedAt);
    proofreadMeta.textContent = timestamp
      ? `${copy.proofreadUpdated}: ${timestamp}`
      : '';
  } else {
    proofreadMeta.textContent = '';
  }
}

function setProofreadState(next) {
  Object.assign(proofreadState, next);
  if (proofreadState.status === 'success' && proofreadState.content) {
    persistActiveDocument();
  }
  renderProofread();
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
  documentTitleInput?.addEventListener('input', (event) => {
    state.title = event.target.value;
    persistActiveDocument({ updateList: true });
  });

  documentSelect?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    const nextId = target.value;
    const nextDocument = state.documents.find((doc) => doc.id === nextId);
    if (nextDocument) {
      setActiveDocument(nextDocument);
    }
  });

  documentSave?.addEventListener('click', () => {
    persistActiveDocument({ updateList: true });
  });

  documentNew?.addEventListener('click', () => {
    const newDocument = createDocument();
    state.documents.unshift(newDocument);
    saveDocumentsToStorage();
    setActiveDocument(newDocument);
    documentTitleInput?.focus();
  });

  documentDelete?.addEventListener('click', () => {
    if (!state.documentId) {
      return;
    }
    const confirmMessage = i18n[state.language].documentDeleteConfirm;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    deleteActiveDocument();
    documentTitleInput?.focus();
  });

  composerInput.addEventListener('input', (event) => {
    state.text = event.target.value;
    saveEntry();
    schedulePreviewRender();
    maybeUpdateSelectionTooltip(lastSelectionPoint);
    renderProofread();
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
    renderQuestions();
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

  vocabCollapse.addEventListener('click', () => {
    const nextCollapsed = !vocabPanel.classList.contains('is-collapsed');
    setPanelCollapsed(vocabPanel, vocabBody, vocabCollapse, nextCollapsed);
  });

  questionsCollapse.addEventListener('click', () => {
    const nextCollapsed = !questionsPanel.classList.contains('is-collapsed');
    setPanelCollapsed(questionsPanel, questionsBody, questionsCollapse, nextCollapsed);
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

  proofreadButton.addEventListener('click', async () => {
    const copy = i18n[state.language];
    const text = composerInput.value.trim();
    if (!text) {
      setProofreadState({
        status: 'error',
        error: copy.proofreadMissing
      });
      return;
    }

    setProofreadState({
      status: 'loading',
      content: '',
      error: '',
      updatedAt: null
    });

    try {
      const result = await requestProofread(text);
      const output = typeof result?.output === 'string' ? result.output.trim() : '';
      if (!output) {
        throw new Error(copy.proofreadError);
      }
      setProofreadState({
        status: 'success',
        content: output,
        error: '',
        updatedAt: new Date()
      });
    } catch (error) {
      setProofreadState({
        status: 'error',
        error: error?.message || copy.proofreadError,
        updatedAt: null
      });
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
  });

  preview.addEventListener('pointerleave', (event) => {
    const related = event.relatedTarget;
    if (related instanceof HTMLElement && tooltip.contains(related)) {
      return;
    }
    clearActiveHover();
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

  selectionAsk.addEventListener('click', () => {
    const isOpen = selectionTooltip.classList.toggle('ask-open');
    if (isOpen) {
      selectionAskInput.focus();
    }
  });

  selectionAskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const copy = i18n[state.language];
    const text = selectionTooltip.dataset.text?.trim();
    const question = selectionAskInput.value.trim();
    if (!text) {
      return;
    }
    if (!question) {
      selectionResult.textContent = copy.selectionAskMissing;
      selectionTooltip.classList.add('expanded');
      return;
    }

    selectionResult.replaceChildren();
    const loading = document.createElement('div');
    loading.textContent = copy.selectionAskLoading;
    selectionResult.appendChild(loading);
    selectionTooltip.classList.add('expanded');
    selectionAskSubmit.disabled = true;
    selectionAskInput.disabled = true;

    try {
      const result = await requestAsk(text, question);
      const output = typeof result?.output === 'string' ? result.output.trim() : '';
      if (!output) {
        throw new Error(copy.selectionAskError);
      }
      selectionResult.textContent = output;
      state.questions.unshift({
        selectedText: text,
        question,
        answer: output,
        createdAt: Date.now()
      });
      saveQuestions();
      renderQuestions();
      selectionAskInput.value = '';
    } catch (error) {
      selectionResult.textContent = error?.message || copy.selectionAskError;
    } finally {
      selectionAskSubmit.disabled = false;
      selectionAskInput.disabled = false;
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
    if (!selectionTooltip.contains(target)) {
      hideSelectionTooltip();
    }
    if (!tooltip.contains(target)) {
      clearActiveHover();
      hideTooltip();
    }
  });

  window.addEventListener('scroll', () => {
    clearActiveHover();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    clearActiveHover();
    hideTooltip();
    hideSelectionTooltip();
  });
}

function init() {
  loadState();
  composerInput.value = state.text;
  renderUI();
  renderPreview();
  renderVocab();
  renderQuestions();
  bindEvents();
  void hydrateVocabFromApi();
  void initKuromoji().then((tokenizer) => {
    if (tokenizer) {
      schedulePreviewRender();
    }
  });
}

init();
