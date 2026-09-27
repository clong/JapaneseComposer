import { randomUUID } from 'node:crypto';
import { ReadingError, MAX_CUSTOM_READING_TEXT, splitJapaneseSentences, validateArticle } from '../src/reading-model.js';
import { japaneseTokenizer } from './japanese-tokenizer.js';

function annotate(text, tokenizer) {
  const segments = [];
  let cursor = 0;
  for (const token of tokenizer.tokenize(text)) {
    const start = token.word_position - 1;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), reading: '' });
    const reading = /[\u3400-\u9fff]/.test(token.surface_form) && token.reading && token.reading !== '*'
      ? token.reading.replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60)) : '';
    segments.push({ text: token.surface_form, reading });
    cursor = start + token.surface_form.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), reading: '' });
  // Tokenizer offsets for unusual Unicode must never alter pasted text.
  return segments.map(part => part.text).join('') === text ? segments : [{ text, reading: '' }];
}

export function createReadingImporter({ ai, tokenizer = japaneseTokenizer, uuid = randomUUID, now = Date.now }) {
  return async function importText(body) {
    if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > MAX_CUSTOM_READING_TEXT) {
      throw new ReadingError(`Paste between 1 and ${MAX_CUSTOM_READING_TEXT.toLocaleString('en-US')} characters.`);
    }
    if (body.title != null && (typeof body.title !== 'string' || body.title.length > 200)) throw new ReadingError('Use a title of at most 200 characters.');
    const paragraphs = body.text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    if (paragraphs.length > 200) throw new ReadingError('Use at most 200 paragraphs.');
    const parts = paragraphs.flatMap((paragraph, index) => splitJapaneseSentences(paragraph).map(({ text }) => ({ text: text.trim(), paragraph: index })));
    if (parts.length > 200) throw new ReadingError('Use at most 200 sentences.');
    const uncertain = parts.flatMap((part, index) => /[。！？!?]/.test(part.text) ? [] : [{ id: String(index), text: part.text }]);
    const splits = new Map();
    if (uncertain.length) {
      const output = await ai.split(uncertain);
      try {
        if (!Array.isArray(output?.passages) || output.passages.length !== uncertain.length) throw new Error();
        const entries = new Map(output.passages.map(entry => [entry.id, entry.sentences]));
        if (entries.size !== uncertain.length) throw new Error();
        for (const passage of uncertain) {
          const sentences = entries.get(passage.id);
          if (!Array.isArray(sentences) || !sentences.length || sentences.length > 200) throw new Error();
          let remaining = passage.text;
          const verified = sentences.map(sentence => {
            if (typeof sentence !== 'string' || !sentence.trim()) throw new Error();
            const value = sentence.trim();
            remaining = remaining.trimStart();
            if (!remaining.startsWith(value)) throw new Error();
            remaining = remaining.slice(value.length);
            return value;
          });
          if (remaining.trim()) throw new Error();
          splits.set(passage.id, verified);
        }
      } catch { throw new ReadingError('Sentence splitting changed or omitted text. Your pasted text is unchanged; please retry.', 502); }
    }
    const sentences = parts.flatMap((part, index) => (splits.get(String(index)) || [part.text]).map(text => ({ text, paragraph: part.paragraph })));
    if (sentences.length > 200 || sentences.some(sentence => sentence.text.length > 8000)) throw new ReadingError('Use at most 200 sentences, with no sentence longer than 8,000 characters.');
    const engine = await tokenizer();
    const title = body.title?.trim() || sentences[0].text.slice(0, 60);
    return { article: validateArticle({ id: `custom-${uuid()}`, sourceType: 'custom', title, titleSegments: annotate(title, engine), fetchedAt: now(),
      sentences: sentences.map((sentence, index) => ({ ...sentence, id: `sentence-${index + 1}`, segments: annotate(sentence.text, engine) })) }) };
  };
}
