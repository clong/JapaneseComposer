import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import { ReadingError, splitJapaneseSentences, validateArticle } from '../src/reading-model.js';

const ORIGIN = 'https://nhkeasier.com';
const CACHE_MS = 10 * 60 * 1000;
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
    return [validateArticle({
      id: `nhkeasier-${permalink.match(/\d+/)[0]}`, title,
      titleSegments: sliceSegments(titleParts, titleStart, titleStart + title.length),
      audioPath: attr(descendants(node, 'audio')[0] || {}, 'src') || attr(descendants(node, 'source')[0] || {}, 'src') || null,
      publishedAt: attr(descendants(node, 'time')[0] || {}, 'datetime'),
      sourceUrl: original, providerUrl: `${ORIGIN}${permalink}`, fetchedAt, sentences
    })];
  });
}

export function createReadingSource({ fetchImpl = fetch, now = Date.now } = {}) {
  let listing = null;
  let inFlight = null;
  const articles = new Map();
  async function download(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { Accept: 'text/html' } });
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
  return {
    async list() {
      if (listing && now() - listing.fetchedAt < CACHE_MS) return { ...listing, stale: false };
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const fetchedAt = now();
          const found = parseReadingArticles(await download(`${ORIGIN}/`), fetchedAt);
          if (!found.length) throw new ReadingError('No articles could be read from NHK Easier. Please retry later.', 502);
          found.forEach(remember);
          listing = { articles: found.map(({ sentences, ...article }) => ({ ...article, sentenceCount: sentences.length })), fetchedAt };
          return { ...listing, stale: false };
        } catch (error) {
          if (listing) return { ...listing, stale: true };
          throw error;
        } finally { inFlight = null; }
      })();
      return inFlight;
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
