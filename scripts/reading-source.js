import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import { ReadingError, readingImageUrl, splitJapaneseSentences, validateArticle } from '../src/reading-model.js';

const ORIGIN = 'https://nhkeasier.com';
const CACHE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const japanDate = (value) => new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const summarize = (found) => found.map(({ sentences, ...article }) => ({ ...article, sentenceCount: sentences.length }));
function attr(node, name) { return node.attrs?.find((item) => item.name === name)?.value || ''; }
function descendants(node, tag) {
  return (node.childNodes || []).flatMap((child) => [ ...(child.tagName === tag ? [child] : []), ...descendants(child, tag) ]);
}
function plain(node) {
  if (['rt', 'rp', 'script', 'style', 'audio', 'noscript'].includes(node.nodeName)) return '';
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes || []).map(plain).join('');
}
function segments(node) {
  if (['rt', 'rp', 'script', 'style', 'audio', 'noscript'].includes(node.nodeName)) return [];
  if (node.nodeName === '#text') return [{ text: node.value, reading: '' }];
  if (node.tagName === 'ruby') {
    const reading = descendants(node, 'rt').map((rt) => (rt.childNodes || []).map(plain).join('')).join('');
    return [{ text: plain(node), reading }];
  }
  if (node.tagName === 'br') return [{ text: ' ', reading: '' }];
  return (node.childNodes || []).flatMap(segments);
}
function sliceSegments(parts, start, end) {
  let offset = 0;
  return parts.flatMap((part) => {
    const left = Math.max(start - offset, 0);
    const right = Math.min(end - offset, part.text.length);
    offset += part.text.length;
    return right > left ? [{ text: part.text.slice(left, right), reading: left === 0 && right === part.text.length ? part.reading : '' }] : [];
  });
}

export function parseReadingArticles(html, fetchedAt = Date.now()) {
  const doc = parse(html);
  return descendants(doc, 'article').flatMap((node) => {
    const links = descendants(node, 'a');
    const permalink = links.map((link) => attr(link, 'href')).find((href) => /^\/story\/\d+\/$/.test(href));
    const original = links.map((link) => attr(link, 'href')).find((href) => /^https:\/\/(?:www3\.nhk\.or\.jp|news\.web\.nhk)\/news\/easy\//.test(href));
    const titleNode = descendants(node, 'h3')[0] || descendants(node, 'h1')[0];
    if (!permalink || !original || !titleNode) return [];
    const paragraphs = descendants(node, 'p').filter((paragraph) => plain(paragraph).trim());
    const parts = paragraphs.map(segments);
    const version = createHash('sha256').update(parts.map((p) => p.map((s) => s.text).join('')).join('\n')).digest('hex').slice(0,12);
    const sentences = parts.flatMap((paragraph, index) => splitJapaneseSentences(paragraph.map((p) => p.text).join('')).map((sentence, n) => ({
      id: `${version}-${index}-${n}`, paragraph: index, text: sentence.text,
      segments: sliceSegments(paragraph, sentence.start, sentence.end)
    })));
    if (!sentences.length) return [];
    const titleParts = segments(titleNode);
    const rawTitle = titleParts.map((part) => part.text).join('');
    const title = rawTitle.trim();
    const titleStart = rawTitle.length - rawTitle.trimStart().length;
    const imageUrl = descendants(node, 'img').map((image) => {
      try { return readingImageUrl(attr(image, 'src')); } catch { return null; }
    }).find(Boolean) || null;
    return [validateArticle({
      id: `nhkeasier-${permalink.match(/\d+/)[0]}`, title, imageUrl,
      titleSegments: sliceSegments(titleParts, titleStart, titleStart + title.length),
      audioPath: attr(descendants(node, 'audio')[0] || {}, 'src') || attr(descendants(node, 'source')[0] || {}, 'src') || null,
      publishedAt: attr(descendants(node, 'time')[0] || {}, 'datetime'),
      sourceUrl: original, providerUrl: `${ORIGIN}${permalink}`, fetchedAt, sentences
    })];
  });
}

export function createReadingSource({ fetchImpl = fetch, now = Date.now, random = Math.random } = {}) {
  const days = new Map();
  const inFlightDays = new Map();
  let randomInFlight = null;
  const articles = new Map();
  async function download(url, { allowMissing = false, timeout = 15000 } = {}) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout), redirect: 'error', headers: { Accept: 'text/html' } });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new ReadingError('The article source is unavailable. Please retry.', 502);
    let html = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      html += decoder.decode(chunk, { stream: true });
      if (html.length > 2_000_000) throw new ReadingError('The article response is too large.', 502);
    }
    return html + decoder.decode();
  }
  function remember(article) {
    articles.delete(article.id);
    articles.set(article.id, article);
    if (articles.size > 150) articles.delete(articles.keys().next().value);
  }
  async function loadDay(day, { refresh = false, timeout } = {}) {
    const cached = days.get(day);
    if (!refresh && cached && now() - cached.fetchedAt < CACHE_MS) return cached;
    if (inFlightDays.has(day)) return inFlightDays.get(day);
    const task = (async () => {
      const fetchedAt = now();
      const html = await download(`${ORIGIN}/${day.replaceAll('-', '/')}/`, { allowMissing: true, timeout });
      const found = html === null ? [] : parseReadingArticles(html, fetchedAt);
      if (html !== null && !found.length) throw new ReadingError('No articles could be read from NHK Easier. Please retry later.', 502);
      const seen = new Set();
      const matches = found.filter((article) => {
        const published = Date.parse(article.publishedAt);
        if (!Number.isFinite(published) || published > fetchedAt || japanDate(published) !== day || seen.has(article.id)) return false;
        seen.add(article.id); return true;
      });
      matches.forEach(remember);
      const result = { articles: matches, fetchedAt };
      days.delete(day); days.set(day, result);
      if (days.size > 60) days.delete(days.keys().next().value);
      return result;
    })();
    inFlightDays.set(day, task);
    try { return await task; } finally { inFlightDays.delete(day); }
  }
  return {
    async list({ refresh = false } = {}) {
      const day = japanDate(now());
      let result, stale = false;
      try { result = await loadDay(day, { refresh }); }
      catch (error) {
        result = days.get(day);
        if (!result) throw error;
        stale = true;
      }
      return { ...result, articles: summarize(result.articles), mode: 'today', date: day, stale };
    },
    async random() {
      if (randomInFlight) return randomInFlight;
      randomInFlight = (async () => {
        const fetchedAt = now();
        const end = Date.parse(`${japanDate(fetchedAt)}T00:00:00Z`);
        const start = new Date(end);
        start.setUTCFullYear(start.getUTCFullYear() - 1);
        // February 29 maps to February 28 in the previous year.
        if (start.getUTCMonth() !== new Date(end).getUTCMonth()) start.setUTCDate(0);
        const dates = [];
        for (let day = start.getTime(); day < end; day += DAY_MS) dates.push(new Date(day).toISOString().slice(0, 10));
        for (let i = dates.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [dates[i], dates[j]] = [dates[j], dates[i]];
        }
        const selected = [], seen = new Set();
        // At most four requests at a time, and 24 dates total, including unpublished days.
        // Eight-second archive timeouts keep the whole operation within the client timeout.
        let checked = 0;
        while (selected.length < 4 && checked < Math.min(24, dates.length)) {
          const batch = dates.slice(checked, Math.min(checked + 4, 24));
          checked += batch.length;
          const results = await Promise.all(batch.map((day) => loadDay(day, { timeout: 8000 })));
          for (const result of results) {
            const candidates = result.articles.filter((article) => !seen.has(article.id));
            if (!candidates.length) continue;
            const article = candidates[Math.floor(random() * candidates.length)];
            selected.push(article); seen.add(article.id);
            if (selected.length === 4) break;
          }
        }
        if (selected.length !== 4) throw new ReadingError('Could not find four articles from the past year. Please try Random articles again.', 502);
        return { articles: summarize(selected), fetchedAt, mode: 'random', stale: false };
      })();
      try { return await randomInFlight; } finally { randomInFlight = null; }
    },
    async article(id) {
      const match = /^nhkeasier-(\d{1,12})$/.exec(id);
      if (!match) throw new ReadingError('Invalid article ID.');
      if (articles.has(id) && now() - articles.get(id).fetchedAt < CACHE_MS) return articles.get(id);
      try {
        const found = parseReadingArticles(await download(`${ORIGIN}/story/${match[1]}/`), now()).find((article) => article.id === id);
        if (!found) throw new ReadingError('This article could not be read.', 502);
        remember(found);
        return found;
      } catch (error) {
        if (articles.has(id)) return articles.get(id);
        throw error;
      }
    }
  };
}
