const kanjiRegex = /[\u3400-\u9fff]/;
const japaneseCharRange =
  '\u3005\u3006\u3007\u303b\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d';
const japaneseEdgeRegex = new RegExp(`^[^${japaneseCharRange}]+|[^${japaneseCharRange}]+$`, 'g');
const kanaRegex = /[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9d]/;

export function hasKanji(text = '') {
  return kanjiRegex.test(String(text || ''));
}

export function hasKana(text = '') {
  return kanaRegex.test(String(text || ''));
}

export function toHiragana(text = '') {
  return String(text || '').replace(/[\u30a1-\u30f6]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0x60);
  });
}

export function normalizeSelectionText(text) {
  return typeof text === 'string' ? text.trim() : '';
}

export function normalizeLookupText(text) {
  return normalizeSelectionText(text).replace(japaneseEdgeRegex, '').trim();
}

export function buildDictionaryMeaning(entry) {
  return entry?.senses?.[0]?.english_definitions?.slice(0, 3).join('; ') || '';
}

function describeDictionaryForm(form) {
  const word = normalizeSelectionText(form?.word);
  const reading = normalizeSelectionText(form?.reading);
  if (word && reading) {
    return `${word} (${reading})`;
  }
  return word || reading || '';
}

export function normalizeResolvedVocabEntry(entry, fallbackText = '') {
  const fallbackRaw = normalizeSelectionText(fallbackText);
  const fallbackWord = normalizeLookupText(fallbackRaw) || fallbackRaw;

  if (!entry || typeof entry !== 'object') {
    if (!fallbackWord) {
      return null;
    }
    return {
      word: fallbackWord,
      reading: !hasKanji(fallbackWord) && hasKana(fallbackWord) ? fallbackWord : '',
      meaning: ''
    };
  }

  const word = normalizeSelectionText(entry.word) || fallbackWord;
  let reading = normalizeSelectionText(entry.reading);
  if (!reading && word && !hasKanji(word) && hasKana(word)) {
    reading = word;
  }
  const meaning = normalizeSelectionText(entry.meaning);

  if (!word && !reading && !meaning) {
    return null;
  }

  return { word, reading, meaning };
}

export function buildFallbackVocabEntry(text) {
  return normalizeResolvedVocabEntry(null, text);
}

export function isInformativeVocabEntry(entry, fallbackText = '') {
  const normalized = normalizeResolvedVocabEntry(entry, fallbackText);
  if (!normalized) {
    return false;
  }
  const fallbackRaw = normalizeSelectionText(fallbackText);
  const fallbackWord = normalizeLookupText(fallbackRaw) || fallbackRaw;
  return Boolean(
    normalized.meaning
    || (normalized.reading && normalized.reading !== fallbackWord)
    || (normalized.word && normalized.word !== fallbackWord)
  );
}

export function resolveDictionaryVocabEntry(query, entries) {
  const normalizedQuery = normalizeLookupText(query);
  if (!normalizedQuery || !Array.isArray(entries) || !entries.length) {
    return null;
  }

  const queryKana = toHiragana(normalizedQuery);
  let best = null;
  let bestScore = -1;

  entries.forEach((entry) => {
    const meaning = buildDictionaryMeaning(entry);
    const forms = Array.isArray(entry?.japanese) ? entry.japanese : [];

    forms.forEach((form) => {
      const word = normalizeSelectionText(form?.word);
      const wordLookup = normalizeLookupText(word);
      const reading = normalizeSelectionText(form?.reading);
      const derivedReading = reading || (!hasKanji(word) && hasKana(word) ? word : '');
      const readingKana = toHiragana(derivedReading);
      let score = -1;

      if (wordLookup && wordLookup === normalizedQuery) {
        score = hasKanji(word) ? 340 : 310;
      } else if (readingKana && queryKana && readingKana === queryKana) {
        score = hasKanji(word) ? 330 : 290;
      } else if (wordLookup && normalizedQuery.startsWith(wordLookup)) {
        score = hasKanji(word) ? 180 : 150;
      } else if (readingKana && queryKana && queryKana.startsWith(readingKana)) {
        score = hasKanji(word) ? 170 : 140;
      }

      if (score < 0) {
        return;
      }

      if (meaning) score += 4;
      if (derivedReading) score += 3;
      if (word) score += 2;
      if (hasKanji(word)) score += 2;

      if (score > bestScore) {
        bestScore = score;
        best = {
          word: word || derivedReading || normalizedQuery,
          reading: reading || (!hasKanji(word) && hasKana(word) ? word : ''),
          meaning
        };
      }
    });
  });

  return best ? normalizeResolvedVocabEntry(best, query) : null;
}

export function formatDictionaryCandidatesForPrompt(entries, limit = 5) {
  if (!Array.isArray(entries) || !entries.length) {
    return 'None';
  }
  return entries
    .slice(0, limit)
    .map((entry, index) => {
      const forms = (Array.isArray(entry?.japanese) ? entry.japanese : [])
        .map((form) => describeDictionaryForm(form))
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      const meaning = buildDictionaryMeaning(entry) || 'unknown';
      return `${index + 1}. ${forms || 'unknown form'} - ${meaning}`;
    })
    .join('\n');
}

export function parseVocabResolutionOutput(output, fallbackText = '') {
  const raw = normalizeSelectionText(output);
  if (!raw) {
    return null;
  }

  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [unfenced];
  const jsonMatch = unfenced.match(/\{[\s\S]*\}/);
  if (jsonMatch && jsonMatch[0] !== unfenced) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      return normalizeResolvedVocabEntry(JSON.parse(candidate), fallbackText);
    } catch (error) {
      continue;
    }
  }

  return null;
}

export async function resolveSelectionVocabEntry({
  text,
  lookupText = '',
  dictionaryEntries = [],
  resolveWithModel = null
}) {
  const selectionText = normalizeSelectionText(text);
  if (!selectionText) {
    return null;
  }

  const lookupQueries = Array.from(
    new Set([lookupText, selectionText].map((value) => normalizeLookupText(value)).filter(Boolean))
  );

  for (const query of lookupQueries) {
    const dictionaryEntry = resolveDictionaryVocabEntry(query, dictionaryEntries);
    if (dictionaryEntry) {
      return {
        entry: dictionaryEntry,
        source: 'dictionary'
      };
    }
  }

  if (typeof resolveWithModel === 'function') {
    try {
      const modelEntry = normalizeResolvedVocabEntry(
        await resolveWithModel({
          text: selectionText,
          lookupText: normalizeSelectionText(lookupText) || lookupQueries[0] || selectionText,
          dictionaryEntries
        }),
        selectionText
      );

      if (isInformativeVocabEntry(modelEntry, selectionText)) {
        return {
          entry: modelEntry,
          source: 'model'
        };
      }
    } catch (error) {
      // Fall through to the raw selection fallback.
    }
  }

  return {
    entry: buildFallbackVocabEntry(selectionText),
    source: 'fallback'
  };
}
