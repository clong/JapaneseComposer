import { audioPath, validateAloudReview } from './read-aloud-model.js';

export const READING_DIRECTIONS = ['ja-en', 'en-ja'];
export const MAX_READING_ANSWER = 4000;
export const MAX_READING_BATCH = 10;

export class ReadingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new ReadingError('Invalid or oversized reading text.');
  }
  return value;
}

export function readingId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) {
    throw new ReadingError('Invalid reading ID.');
  }
  return value;
}

function sourceUrl(value, provider = false) {
  try {
    const url = new URL(value);
    const allowed = provider
      ? url.hostname === 'nhkeasier.com' && /^\/story\/\d+\/$/.test(url.pathname)
      : ['www3.nhk.or.jp', 'news.web.nhk'].includes(url.hostname) && /^\/news\/easy\//.test(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) throw new Error();
    return url.href;
  } catch {
    throw new ReadingError('Invalid article source URL.');
  }
}

export function validateArticle(value) {
  if (!value || !Array.isArray(value.sentences) || !value.sentences.length || value.sentences.length > 200) {
    throw new ReadingError('The article must contain between 1 and 200 sentences.');
  }
  const ids = new Set();
  let total = 0;
  const sentences = value.sentences.map((sentence) => {
    const id = readingId(sentence.id);
    if (ids.has(id)) throw new ReadingError('Duplicate sentence ID.');
    ids.add(id);
    const plain = text(sentence.text, 8000, true);
    total += plain.length;
    if (!Number.isInteger(sentence.paragraph) || sentence.paragraph < 0 || sentence.paragraph > 199) {
      throw new ReadingError('Invalid paragraph.');
    }
    const segments = Array.isArray(sentence.segments) && sentence.segments.length
      ? sentence.segments.map((segment) => ({ text: text(segment.text, 8000), reading: text(segment.reading || '', 500) }))
      : [{ text: plain, reading: '' }];
    if (segments.length > 2000 || segments.map((segment) => segment.text).join('') !== plain) {
      throw new ReadingError('Article annotations do not match the sentence.');
    }
    return { id, paragraph: sentence.paragraph, text: plain, segments };
  });
  if (total > 50000) throw new ReadingError('Article is too long.');
  const title = text(value.title, 1000, true);
  const titleSegments = Array.isArray(value.titleSegments) && value.titleSegments.length
    ? value.titleSegments.map((segment) => ({ text: text(segment.text, 1000), reading: text(segment.reading || '', 500) }))
    : [{ text: title, reading: '' }];
  if (titleSegments.length > 1000 || titleSegments.map((segment) => segment.text).join('') !== title) {
    throw new ReadingError('Article annotations do not match the title.');
  }
  return {
    id: readingId(value.id), title, titleSegments, audioPath: audioPath(value.audioPath),
    publishedAt: text(value.publishedAt || '', 100),
    sourceUrl: sourceUrl(value.sourceUrl), providerUrl: sourceUrl(value.providerUrl, true),
    fetchedAt: Number.isFinite(value.fetchedAt) ? value.fetchedAt : Date.now(), sentences
  };
}

export function validateEnglish(value, article) {
  if (!value || !Array.isArray(value.sentences) || value.sentences.length !== article.sentences.length) {
    throw new ReadingError('English prompts are incomplete.');
  }
  const byId = new Map(value.sentences.map((entry) => [entry.id, entry]));
  if (byId.size !== article.sentences.length) throw new ReadingError('Duplicate English prompt ID.');
  return {
    title: text(value.title, 1000, true),
    sentences: article.sentences.map(({ id }) => {
      if (!byId.has(id)) throw new ReadingError('English prompt IDs do not match the article.');
      return { id, text: text(byId.get(id).text, 8000, true) };
    })
  };
}

export function validateGrade(value, { requireScore = false } = {}) {
  if (!value || !['correct', 'needs_revision'].includes(value.verdict)) throw new ReadingError('Invalid grade.');
  // Older saved feedback has no score. Keep it readable without inventing a percentage.
  const score = value.score ?? null;
  if ((score === null && requireScore) || (score !== null && (!Number.isInteger(score) || score < 0 || score > 100
    || (value.verdict === 'correct' ? score < 90 : score >= 90)))) throw new ReadingError('Invalid correctness score.');
  return {
    verdict: value.verdict, score,
    explanation: text(value.explanation, 2000, true),
    improvement: text(value.improvement || '', 8000)
  };
}

export function validateSession(value) {
  if (!value || !READING_DIRECTIONS.includes(value.mode)) throw new ReadingError('Invalid reading session.');
  const article = validateArticle(value.article);
  const ids = new Set(article.sentences.map((sentence) => sentence.id));
  const answers = {};
  for (const direction of READING_DIRECTIONS) {
    answers[direction] = {};
    for (const id of ids) {
      const answer = value.answers?.[direction]?.[id];
      if (!answer) continue;
      const input = text(answer.input, MAX_READING_ANSWER);
      const grade = answer.grade && answer.gradedInput === input && input.trim()
        ? validateGrade(answer.grade) : null;
      answers[direction][id] = { input, grade, gradedInput: grade ? input : '', gradedAt: grade ? Number(answer.gradedAt) || 0 : 0 };
    }
  }
  return {
    id: readingId(value.id), article, mode: value.mode,
    activity: value.activity === 'aloud' ? 'aloud' : 'translate',
    reviews: (Array.isArray(value.reviews) ? value.reviews : []).slice(0, 20).map((review) => validateAloudReview(review, article)),
    english: value.english ? validateEnglish(value.english, article) : null,
    answers, expanded: Array.isArray(value.expanded) ? [...new Set(value.expanded.filter((id) => ids.has(id)))] : [],
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    recovered: value.recovered === true
  };
}

export function createReadingSession(article, id, now = Date.now()) {
  return validateSession({ id, article, mode: 'ja-en', answers: {}, expanded: [], createdAt: now, updatedAt: now });
}

export function readingProgress(session, direction = session.mode) {
  const answers = session.answers[direction];
  const attempted = Object.values(answers).filter((answer) => answer.input.trim()).length;
  const correct = Object.values(answers).filter((answer) => answer.grade?.verdict === 'correct' && answer.gradedInput === answer.input).length;
  return { attempted, correct, total: session.article.sentences.length };
}

export function updateReadingAnswer(session, direction, id, input) {
  session.answers[direction][id] = { input, grade: null, gradedInput: '', gradedAt: 0 };
}

// A request may finish after an edit, navigation, or another request for the same sentence.
export function applyReadingGrade(session, direction, submitted, result) {
  const answer = session.answers[direction]?.[submitted.id];
  if (!answer || answer.input !== submitted.input || result.id !== submitted.id) return false;
  answer.grade = validateGrade(result);
  answer.gradedInput = submitted.input;
  answer.gradedAt = Date.now();
  return true;
}

export function readingLookupTarget(selected, tokens = []) {
  // Inflected verbs/adjectives often include separate auxiliary tokens (食べ + まし + た).
  const meaningful = tokens.filter((token) => !['助詞', '助動詞', '記号'].includes(token.pos)
    && !(token.pos === '動詞' && token.pos_detail_1 === '非自立'));
  if (meaningful.length === 1 && (tokens.length === 1 || ['動詞', '形容詞'].includes(meaningful[0].pos))) {
    const basic = meaningful[0].basic_form;
    if (basic && basic !== '*') return basic;
  }
  return selected;
}

export function splitJapaneseSentences(input) {
  const sentences = [];
  let start = 0;
  const stack = [];
  const pairs = { '「': '」', '『': '』', '（': '）', '(': ')', '“': '”' };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (pairs[char]) stack.push(pairs[char]);
    else if (char === stack.at(-1)) stack.pop();
    const closesStandaloneQuote = /[」』”]/.test(char) && !stack.length
      && /[。！？!?][」』”]+$/.test(input.slice(start, i + 1))
      && !/^(?:と|って|など|[やのをがはにでも、,。！？!?])/.test(input.slice(i + 1).trimStart());
    if ((/[。！？!?]/.test(char) && !stack.length) || closesStandaloneQuote) {
      while (/[。！？!?」』”]/.test(input[i + 1] || '\u0000')) i += 1;
      sentences.push({ text: input.slice(start, i + 1), start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < input.length) sentences.push({ text: input.slice(start), start, end: input.length });
  return sentences.filter((sentence) => sentence.text.trim());
}
