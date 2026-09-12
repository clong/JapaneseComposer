import { englishLookupQuery } from '../src/dictionary-query.js';

const glossText = (text) => text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z'-]+/g, ' ').trim();

// Built lazily from the existing JMdict glosses; no second dictionary download is needed.
export function createEnglishDictionarySearch(entries) {
  let index;
  function prepare() {
    index = new Map();
    for (const [id, entry] of Object.entries(entries)) {
      const words = new Set((entry.glosses || []).flatMap((gloss) => glossText(gloss).split(' ')));
      for (const word of words) {
        if (!word) continue;
        if (!index.has(word)) index.set(word, []);
        index.get(word).push(id);
      }
    }
  }
  return (value, limit = 25) => {
    const query = englishLookupQuery(value);
    if (!query) return [];
    if (!index) prepare();
    const tokens = [...new Set(query.split(' '))];
    const candidates = tokens.map((word) => index.get(word) || []).sort((a, b) => a.length - b.length);
    const ranked = [];
    for (const id of candidates[0]) {
      const entry = entries[id];
      let score = 0;
      for (const [senseIndex, gloss] of (entry.glosses || []).entries()) {
        const normalized = glossText(gloss), words = normalized.split(' ');
        if (!tokens.every((word) => words.includes(word))) continue;
        const plain = glossText(gloss.replace(/\([^)]*\)/g, '')).replace(/^to /, '');
        const rank = normalized === query || plain === query ? 1000 : (` ${normalized} `.includes(` ${query} `) ? 500 : 100);
        score = Math.max(score, rank - words.length - senseIndex * 8);
      }
      if (score) ranked.push({ entry, score: score + (entry.common ? 150 : 0) + (entry.everyday ? 75 : 0) + Math.max(0, 50 - (entry.frequencyRank || 99)) });
    }
    return ranked.sort((a, b) => b.score - a.score).slice(0, limit).map(({ entry }) => entry);
  };
}
