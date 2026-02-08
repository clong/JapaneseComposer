import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const localEntriesPath = process.env.JMDICT_ENTRIES_PATH || path.join(dataDir, 'jmdict-entries.json');
const localIndexPath = process.env.JMDICT_INDEX_PATH || path.join(dataDir, 'jmdict-index.json');

const localDictionary = await loadLocalDictionary();
const localLookupCache = new Map();

await import('./build.js');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (requestUrl.pathname === '/api/lookup') {
    const keyword = requestUrl.searchParams.get('keyword');
    if (!keyword) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing keyword' }));
      return;
    }

    try {
      if (localDictionary) {
        const localResults = lookupLocalDictionary(keyword);
        if (localResults.length) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ data: localResults }));
          return;
        }
      }

      const response = await fetch(
        `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(keyword)}`
      );
      const body = await response.text();
      res.writeHead(response.ok ? 200 : response.status, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(body);
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Lookup failed' }));
      return;
    }
  }
  if (requestUrl.pathname === '/api/translate') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing GOOGLE_TRANSLATE_API_KEY' }));
      return;
    }

    const body = await readJsonBody(req);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing text' }));
      return;
    }

    try {
      const detectResponse = await fetch(
        `https://translation.googleapis.com/language/translate/v2/detect?q=${encodeURIComponent(text)}`,
        {
          method: 'POST',
          headers: { 'X-goog-api-key': apiKey }
        }
      );
      const detectData = await detectResponse.json();
      const detectedLanguage =
        detectData?.data?.detections?.[0]?.[0]?.language || 'en';
      const targetLanguage = detectedLanguage === 'en' ? 'ja' : 'en';

      const translateResponse = await fetch(
        'https://translation.googleapis.com/language/translate/v2',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
          },
          body: JSON.stringify({ q: text, target: targetLanguage, format: 'text' })
        }
      );
      const translateData = await translateResponse.json();
      const translation = translateData?.data?.translations?.[0]?.translatedText;

      if (!translation) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Translation failed' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        translation,
        detectedLanguage,
        targetLanguage
      }));
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Translation failed' }));
      return;
    }
  }
  const requestPath = decodeURIComponent(requestUrl.pathname);
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.join(distDir, safePath);

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    res.writeHead(404);
    res.end('Not found');
  }
});

const port = 5173;
server.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
  if (localDictionary) {
    console.log('Local JMdict lookup enabled.');
  } else {
    console.log('Local JMdict lookup not found. Using Jisho API.');
  }
});

async function readJsonBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
  }
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

async function loadLocalDictionary() {
  try {
    const [entriesRaw, indexRaw] = await Promise.all([
      fs.readFile(localEntriesPath, 'utf8'),
      fs.readFile(localIndexPath, 'utf8')
    ]);
    const entries = JSON.parse(entriesRaw);
    const index = JSON.parse(indexRaw);
    const keys = Object.keys(index);
    return { entries, index, keys };
  } catch (error) {
    return null;
  }
}

const japaneseCharRange =
  '\u3005\u3006\u3007\u303b\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9d';
const japaneseEdgeRegex = new RegExp(`^[^${japaneseCharRange}]+|[^${japaneseCharRange}]+$`, 'g');

function normalizeKeyword(keyword) {
  return keyword.trim().replace(japaneseEdgeRegex, '');
}

function lookupLocalDictionary(keyword) {
  if (!localDictionary) {
    return [];
  }
  const normalized = normalizeKeyword(keyword);
  if (!normalized) {
    return [];
  }
  if (localLookupCache.has(normalized)) {
    return localLookupCache.get(normalized);
  }

  let entryIds = localDictionary.index[normalized];
  if (!entryIds && normalized.length > 1) {
    const results = new Set();
    for (const key of localDictionary.keys) {
      if (key.startsWith(normalized)) {
        const ids = localDictionary.index[key] || [];
        ids.forEach((id) => results.add(id));
      }
      if (results.size >= 25) {
        break;
      }
    }
    entryIds = Array.from(results);
  }

  const entries = (entryIds || []).map((id) => localDictionary.entries[id]).filter(Boolean);
  const data = entries.map((entry) => ({
    japanese: buildJapaneseForms(entry),
    senses: [{ english_definitions: entry.glosses || [] }]
  }));

  localLookupCache.set(normalized, data);
  return data;
}

function buildJapaneseForms(entry) {
  const forms = [];
  const readings = entry.readings || [];
  const words = entry.words || [];

  if (words.length) {
    const primaryReading = readings[0] || '';
    words.forEach((word) => {
      forms.push({ word, reading: primaryReading });
    });
  } else {
    readings.forEach((reading) => {
      forms.push({ reading });
    });
  }

  return forms;
}
