import { ReadingError, readingId } from './reading-model.js';

export const ALOUD_RATINGS = ['clear', 'practice', 'uncertain'];
export const ALOUD_CATEGORIES = ['accuracy', 'pronunciation', 'pacing'];
export const ALOUD_MAX_SECONDS = 300;
export function audioPath(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\/media\/mp3\/[a-zA-Z0-9_-]{1,100}\.mp3$/.test(value)) throw new ReadingError('Invalid reference audio.');
  return value;
}
const bounded = (value, max) => {
  if (typeof value !== 'string' || value.length > max) throw new ReadingError('Invalid read aloud text.');
  return value;
};
export function practiceIds(ids, article) {
  const known = new Set(article.sentences.map((s) => s.id));
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) throw new ReadingError('Invalid practice sentences.');
  return article.sentences.filter((s) => ids.includes(s.id)).map((s) => s.id);
}
export function validateAloudReview(value, article) {
  if (!value) throw new ReadingError('Missing read aloud review.');
  const sentenceIds = practiceIds(value.sentenceIds, article);
  const ratings = {};
  for (const key of ALOUD_CATEGORIES) {
    if (!ALOUD_RATINGS.includes(value.ratings?.[key])) throw new ReadingError('Invalid read aloud rating.');
    ratings[key] = value.ratings[key];
  }
  if (!Number.isFinite(value.duration) || value.duration < 0 || value.duration > ALOUD_MAX_SECONDS + 1) throw new ReadingError('Invalid recording duration.');
  if (!Array.isArray(value.tips) || value.tips.length > 3) throw new ReadingError('Invalid reading tips.');
  const tips = value.tips.map((tip) => {
    if (!ALOUD_CATEGORIES.includes(tip.category) || (tip.sentenceId && !sentenceIds.includes(tip.sentenceId))) throw new ReadingError('Invalid reading tip.');
    return { category: tip.category, sentenceId: tip.sentenceId || '', text: bounded(tip.text, 1000) };
  });
  if (!Array.isArray(value.sentences) || value.sentences.length !== sentenceIds.length) throw new ReadingError('Incomplete reading review.');
  const entries = new Map(value.sentences.map((s) => [s.id, s]));
  if (entries.size !== sentenceIds.length) throw new ReadingError('Duplicate reading review sentence.');
  const sentences = sentenceIds.map((id) => {
    const s = entries.get(id);
    if (!s || !['read', 'skipped', 'unfinished', 'uncertain'].includes(s.status)) throw new ReadingError('Invalid reading observation.');
    const timing = s.start != null && s.end != null;
    if (timing && (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || s.end > value.duration + .1)) throw new ReadingError('Invalid recording timing.');
    return { id, status: s.status, observation: bounded(s.observation || '', 1000), start: timing ? s.start : null, end: timing ? s.end : null };
  });
  return { id: readingId(value.id), sentenceIds, transcript: bounded(value.transcript, 18000), duration: value.duration,
    summary: bounded(value.summary, 2000), ratings, tips, sentences, referenceUsed: value.referenceUsed === true,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now() };
}

export function normalizeSpeech(text) {
  return String(text).normalize('NFKC').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[^\p{L}\p{N}ー]/gu, '');
}

// Semi-global edit alignment allows introductions and skipped sentences without inventing timings.
export function alignSpeech(sentences, words, normalize = normalizeSpeech) {
  const chars = [], spans = [];
  for (const word of words || []) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start) continue;
    for (const char of normalize(word.word ?? word.text ?? '')) { chars.push(char); spans.push({ start: word.start, end: word.end }); }
    if (chars.length > 20000) return [];
  }
  let cursor = 0, operations = 0;
  const matches = [];
  for (const sentence of sentences) {
    const needle = [...normalize(sentence.text)];
    if (needle.length < 3 || needle.length > 2000 || cursor >= chars.length) continue;
    const hay = chars.slice(cursor);
    operations += needle.length * hay.length;
    if (operations > 20_000_000) break; // Very long or badly aligned input stays uncertain instead of blocking the server.
    let previous = new Uint16Array(hay.length + 1);
    let starts = Uint32Array.from({ length: hay.length + 1 }, (_, i) => i);
    for (let i = 1; i <= needle.length; i++) {
      const row = new Uint16Array(hay.length + 1), nextStarts = new Uint32Array(hay.length + 1); row[0] = i;
      for (let j = 1; j <= hay.length; j++) {
        const sub = previous[j - 1] + (needle[i - 1] === hay[j - 1] ? 0 : 1);
        const del = previous[j] + 1, ins = row[j - 1] + 1;
        if (sub <= del && sub <= ins) { row[j] = sub; nextStarts[j] = starts[j - 1]; }
        else if (del <= ins) { row[j] = del; nextStarts[j] = starts[j]; }
        else { row[j] = ins; nextStarts[j] = nextStarts[j - 1]; }
      }
      previous = row; starts = nextStarts;
    }
    let end = 1;
    for (let j = 2; j <= hay.length; j++) if (previous[j] < previous[end]) end = j;
    const start = starts[end], coverage = 1 - previous[end] / needle.length;
    if (coverage < .85 || end - start < needle.length * .75) continue;
    matches.push({ id: sentence.id, start: spans[cursor + start].start, end: spans[cursor + end - 1].end });
    cursor += end;
  }
  return matches;
}

export class LiveTranscript {
  constructor() { this.items = new Map(); }
  receive(event) {
    if (event.type === 'input_audio_buffer.committed') {
      const item = this.items.get(event.item_id) || { text: '', final: false };
      this.items.set(event.item_id, { ...item, previous: event.previous_item_id ?? null });
    } else if (event.type === 'conversation.item.input_audio_transcription.delta' || event.type === 'conversation.item.input_audio_transcription.completed') {
      const item = this.items.get(event.item_id) || { text: '', final: false };
      if (!item.final) this.items.set(event.item_id, { ...item, text: event.transcript ?? item.text + (event.delta || ''), final: event.type.endsWith('.completed') });
    }
    const ordered = [], pending = [...this.items.entries()];
    while (pending.length) {
      let index = pending.findIndex(([, item]) => !item.previous || ordered.some(([id]) => id === item.previous) || !this.items.has(item.previous));
      if (index < 0) index = 0;
      ordered.push(...pending.splice(index, 1));
    }
    return { text: ordered.map(([, i]) => i.text).join(''), provisional: ordered.some(([, i]) => !i.final) };
  }
}

export function liveSentenceId(sentences, transcript, previousId = '') {
  const heard = normalizeSpeech(transcript);
  const previous = Math.max(0, sentences.findIndex((s) => s.id === previousId));
  for (let i = Math.min(previous + 2, sentences.length - 1); i >= previous; i--) {
    const s = sentences[i], base = normalizeSpeech(s.text);
    const alternatives = [base, normalizeSpeech(s.segments?.map((p) => p.reading || p.text).join('') || s.text)];
    if (alternatives.some((t) => t.length >= 4 && heard.includes(t))) return s.id;
    if (alternatives.some((t) => t.length >= 8 && heard.endsWith(t.slice(0, Math.min(12, Math.ceil(t.length / 2)))))) return s.id;
  }
  return previousId;
}
