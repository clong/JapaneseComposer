import { test } from 'node:test';
import assert from 'node:assert/strict';

const japaneseCharRange =
  '\u3005\u3006\u3007\u303b\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d';
const japaneseEdgeRegex = new RegExp(`^[^${japaneseCharRange}]+|[^${japaneseCharRange}]+$`, 'g');
const japaneseRunRegex = new RegExp(`[${japaneseCharRange}]+`, 'g');
const kanjiRegex = /[\u3400-\u9fff]/;

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
  const runWithKanji = runs.find((run) => kanjiRegex.test(run));
  return runWithKanji || runs[0];
}

function toHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0x60);
  });
}

function buildDictionaryMeaning(entry) {
  return entry.senses?.[0]?.english_definitions?.slice(0, 3).join('; ') || '';
}

function selectBestEntry(entries, query) {
  let best = null;
  let bestScore = -1;
  const normalizedQuery = normalizeLookupWord(query);
  if (!normalizedQuery) {
    return null;
  }

  entries.forEach((entry) => {
    (entry.japanese || []).forEach((form) => {
      const wordForm = normalizeLookupWord(form.word || '');
      const reading = typeof form.reading === 'string' ? form.reading : '';
      let score = -1;
      let exact = false;

      if (wordForm && wordForm === normalizedQuery) {
        score = 200;
        exact = true;
      } else if (!wordForm && reading === normalizedQuery) {
        score = 150;
        exact = true;
      } else if (wordForm && wordForm.startsWith(normalizedQuery)) {
        score = 120;
      } else if (normalizedQuery.startsWith(wordForm) && wordForm) {
        score = 110;
      } else if (reading && reading.startsWith(normalizedQuery)) {
        score = 90;
      } else if (normalizedQuery.startsWith(reading) && reading) {
        score = 80;
      }
      if (score < 0) {
        return;
      }

      if (reading) score += 5;
      if (buildDictionaryMeaning(entry)) score += 3;

      if (score > bestScore) {
        bestScore = score;
        best = { entry, form, exact };
      }
    });
  });

  return best;
}

function pickKanjiFormForKana(entry, query) {
  const kanaQuery = toHiragana(query);
  if (!kanaQuery) {
    return null;
  }
  const forms = Array.isArray(entry?.japanese) ? entry.japanese : [];
  let best = null;
  let bestScore = -1;

  for (const form of forms) {
    const word = typeof form.word === 'string' ? form.word : '';
    if (!kanjiRegex.test(word)) {
      continue;
    }
    const reading = typeof form.reading === 'string' ? form.reading : '';
    const readingKana = toHiragana(reading);
    let score = -1;
    let exact = false;

    if (word === query) {
      score = 210;
      exact = true;
    }
    if (readingKana && readingKana === kanaQuery) {
      score = Math.max(score, 220);
      exact = true;
    } else if (readingKana && readingKana.startsWith(kanaQuery)) {
      score = Math.max(score, 120);
    } else if (kanaQuery && readingKana && kanaQuery.startsWith(readingKana)) {
      score = Math.max(score, 110);
    }
    if (score < 0) {
      continue;
    }

    if (reading) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = { word, reading, exact };
    }
  }

  return best;
}

test('exact kanji match beats longer prefix match', () => {
  const entries = [
    {
      japanese: [{ word: '代わり映え', reading: 'かわりばえ' }],
      senses: [{ english_definitions: ['change for the better'] }]
    },
    {
      japanese: [{ word: '代わり', reading: 'かわり' }],
      senses: [{ english_definitions: ['substitute'] }]
    }
  ];

  const selection = selectBestEntry(entries, '代わり');
  assert.equal(selection?.form?.word, '代わり');
  assert.equal(selection?.exact, true);
});

test('kanji lookup can still return a labeled fallback when no exact form exists', () => {
  const entries = [
    {
      japanese: [{ word: '代わり映え', reading: 'かわりばえ' }],
      senses: [{ english_definitions: ['change for the better'] }]
    }
  ];

  const selection = selectBestEntry(entries, '代わり');
  assert.equal(selection?.form?.word, '代わり映え');
  assert.equal(selection?.exact, false);
});

test('exact kana match beats longer reading prefix match', () => {
  const entries = [
    {
      japanese: [{ word: '代わり映え', reading: 'かわりばえ' }],
      senses: [{ english_definitions: ['change for the better'] }]
    },
    {
      japanese: [{ word: '代わり', reading: 'かわり' }],
      senses: [{ english_definitions: ['substitute'] }]
    }
  ];

  const selection = pickKanjiFormForKana(entries[1], 'かわり');
  assert.equal(selection?.word, '代わり');
  assert.equal(selection?.exact, true);
});

test('kana lookup can still surface a closest fallback when exact reading is missing', () => {
  const entry = {
    japanese: [{ word: '代わり映え', reading: 'かわりばえ' }],
    senses: [{ english_definitions: ['change for the better'] }]
  };

  const selection = pickKanjiFormForKana(entry, 'かわり');
  assert.equal(selection?.word, '代わり映え');
  assert.equal(selection?.exact, false);
});
