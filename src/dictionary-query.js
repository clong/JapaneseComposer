const japanese = /[\u3005\u3006\u3007\u3040-\u30ff\u3400-\u9fff\uff66-\uff9d]/;

export function englishLookupQuery(value) {
  if (typeof value !== 'string' || value.length > 80) return '';
  const query = value.normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/^["'“”]+|["'“”.,!?;:]+$/g, '').replace(/\s+/g, ' ');
  return /^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*){0,5}$/.test(query) ? query : '';
}

export function dictionarySelectionLanguage(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) return null;
  if (japanese.test(value)) return 'ja';
  return englishLookupQuery(value) ? 'en' : null;
}

// English searches can have several Japanese equivalents. Keep their meanings together.
export function englishDictionaryChoices(entries, query = '') {
  const choices = [], seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const form = entry.japanese?.find((item) => item.word || item.reading);
    const word = form?.word || form?.reading;
    const definitions = (entry.senses || []).flatMap((sense) => sense.english_definitions || []).filter((text) => typeof text === 'string');
    const match = (text) => query && ` ${text.toLowerCase().replace(/[^a-z'-]+/g, ' ')} `.includes(` ${query} `);
    const meaning = definitions.sort((a, b) => Number(match(b)) - Number(match(a))).slice(0, 5).join('; ');
    if (!word || !meaning || seen.has(word)) continue;
    seen.add(word);
    choices.push({ word, reading: form.reading || '', meaning });
    if (choices.length === 5) break;
  }
  return choices;
}

export function dictionaryClipboardText(entries) {
  return entries.map(({ word, reading, meaning }) => [word, reading && reading !== word ? reading : '', meaning].filter(Boolean).join('\n')).join('\n\n');
}
