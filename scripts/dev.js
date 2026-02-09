import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const localEntriesPath = process.env.JMDICT_ENTRIES_PATH || path.join(dataDir, 'jmdict-entries.json');
const localIndexPath = process.env.JMDICT_INDEX_PATH || path.join(dataDir, 'jmdict-index.json');
const vocabDbPath = process.env.VOCAB_DB_PATH || path.join(dataDir, 'vocab.sqlite');
const shareDbPath = process.env.SHARE_DB_PATH || path.join(dataDir, 'shares.sqlite');
const DEFAULT_OPENAI_MODEL = 'gpt-4.1';
const PROOFREAD_SYSTEM_PROMPT = `System Prompt: Japanese Writing Evaluator & Tutor

You are a Japanese language teacher and writing tutor.

All output must be in English.
Whenever you include Japanese text, immediately follow it with romaji in parentheses (use Hepburn-style romaji).
If you cannot provide romaji, do not include Japanese characters; provide romaji only.

When the user submits a large selection of Japanese text, perform the following tasks in order:
  1. JLPT Level Assessment
  - Based on the vocabulary, grammar, sentence complexity, and naturalness of expression, estimate the overall writing level.
  - Rank the level on the JLPT scale from N5 (beginner) to N1 (advanced).
  - Briefly explain why you chose this level, citing specific examples (e.g., grammar patterns, sentence forms, word choice).
  2. Proofreading & Corrections
  - Proofread the text for:
  - Grammar errors
  - Incorrect or unnatural word usage
  - Particle misuse
  - Awkward or unnatural sentence structure
  - Present corrections clearly:
  - Show the original sentence
  - Show the corrected or improved version
  - Include a brief explanation of the correction when helpful
  - Favor natural, native-like Japanese, not just technically correct forms.
  3. Quality Improvement Suggestions
  - Suggest optional improvements that would raise the overall quality, such as:
  - More natural phrasing
  - Better sentence flow
  - More precise or expressive vocabulary
  - Appropriate use of conjunctions, nuance markers, or tone
  - Clearly mark these as style or quality improvements, not required corrections.
  4. Targeted Goals for the Next Entry
  - Provide 1-3 concrete, actionable goals for the next writing entry.
  - Goals should:
  - Address recurring mistakes found in the text and/or
  - Encourage use of slightly more advanced grammar or vocabulary than was demonstrated
  - Phrase goals clearly and practically (e.g., "Try using X grammar pattern at least once," not vague advice).

Tone & Style Guidelines
  - Be encouraging, constructive, and teacher-like.
  - Assume the writer is actively learning and wants to improve.
  - Avoid overwhelming the user; prioritize clarity and usefulness over exhaustiveness.

Output Structure
Use clear section headers:
  - JLPT Level Assessment
  - Corrections & Proofreading
  - Style & Quality Suggestions
  - Goals for the Next Entry

Do not include unrelated explanations or meta commentary.
`;
const ASK_SYSTEM_PROMPT = `System Prompt: Selected Text Q&A Assistant

You are a helpful Japanese language assistant. The user provides selected text from a journal entry and a question about it.

Use the selected text as the primary context. Answer clearly and concisely.
If the question is about Japanese language usage, briefly explain and include a short example when helpful.
Respond in the same language as the question when possible; otherwise respond in English.
`;

const debugEnabled = process.env.DEV_DEBUG === '1';

function debug(...args) {
  if (!debugEnabled) {
    return;
  }
  console.log('[dev]', ...args);
}

await fs.mkdir(dataDir, { recursive: true });
debug('Data directory ready:', dataDir);

let vocabDbReady = false;
try {
  debug('Initializing vocab DB:', vocabDbPath);
  await ensureVocabDb(vocabDbPath);
  vocabDbReady = true;
  debug('Vocab DB ready.');
} catch (error) {
  console.error('Failed to initialize vocab database:', error);
}

let shareDbReady = false;
try {
  debug('Initializing share DB:', shareDbPath);
  await ensureShareDb(shareDbPath);
  shareDbReady = true;
  debug('Share DB ready.');
} catch (error) {
  console.error('Failed to initialize share database:', error);
}

debug('Loading local dictionary...');
const localDictionary = await loadLocalDictionary();
const localLookupCache = new Map();
debug(localDictionary ? 'Local dictionary loaded.' : 'Local dictionary not found.');

debug('Running build script...');
await import('./build.js');
debug('Build complete.');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (requestUrl.pathname === '/api/vocab') {
    if (!vocabDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Vocab database unavailable' }));
      return;
    }
    if (req.method === 'GET') {
      try {
        const items = await readVocabState(vocabDbPath);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ items }));
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Vocab lookup failed' }));
      }
      return;
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const items = normalizeVocabList(body?.items);
      try {
        await writeVocabState(vocabDbPath, items);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, count: items.length }));
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Vocab update failed' }));
      }
      return;
    }
    if (req.method === 'DELETE') {
      const body = await readJsonBody(req);
      try {
        if (body?.all === true) {
          const existing = await readVocabState(vocabDbPath);
          await writeVocabState(vocabDbPath, []);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, removed: existing.length, count: 0 }));
          return;
        }
        const targets = normalizeVocabDeleteTargets(body);
        if (!targets.length) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Missing entry' }));
          return;
        }
        const { items, removed } = await deleteVocabEntries(vocabDbPath, targets);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, removed, count: items.length }));
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Vocab delete failed' }));
      }
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  if (requestUrl.pathname === '/api/share') {
    if (!shareDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Share database unavailable' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const body = await readJsonBody(req);
    const entry = normalizeShareEntry(body?.entry);
    if (!entry) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing entry' }));
      return;
    }
    const token = createShareToken();
    try {
      await writeShareEntry(shareDbPath, token, entry);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ token, createdAt: entry.createdAt, updatedAt: entry.updatedAt }));
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Share create failed' }));
      return;
    }
  }
  if (requestUrl.pathname.startsWith('/api/share/')) {
    if (!shareDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Share database unavailable' }));
      return;
    }
    const segments = requestUrl.pathname.split('/').filter(Boolean);
    const token = segments[2];
    const subresource = segments[3] || '';
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing share token' }));
      return;
    }

    if (subresource === 'comments') {
      if (req.method === 'GET') {
        try {
          const comments = await readShareComments(shareDbPath, token);
          if (comments === null) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Share not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ comments }));
          return;
        } catch (error) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Share comments lookup failed' }));
          return;
        }
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const comment = normalizeShareComment(body);
        if (!comment) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Missing comment' }));
          return;
        }
        try {
          const created = await insertShareComment(shareDbPath, token, comment);
          if (!created) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Share not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ comment: created }));
          return;
        } catch (error) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Share comment failed' }));
          return;
        }
      }
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (req.method === 'GET') {
      try {
        const entry = await readShareEntry(shareDbPath, token);
        if (!entry) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Share not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ entry }));
        return;
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Share lookup failed' }));
        return;
      }
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const entry = normalizeShareEntry(body?.entry);
      if (!entry) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Missing entry' }));
        return;
      }
      try {
        const updated = await updateShareEntry(shareDbPath, token, entry);
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Share not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, updatedAt: entry.updatedAt }));
        return;
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Share update failed' }));
        return;
      }
    }

    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
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
  if (requestUrl.pathname === '/api/proofread') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing OPENAI_API_KEY' }));
      return;
    }

    const body = await readJsonBody(req);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing text' }));
      return;
    }

    const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          instructions: PROOFREAD_SYSTEM_PROMPT,
          input: text
        })
      });

      const data = await response.json();
      if (!response.ok) {
        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: data?.error?.message || 'Proofreading failed' }));
        return;
      }

      const output = extractOpenAiText(data);
      if (!output) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Proofreading failed' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ output, model }));
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Proofreading failed' }));
      return;
    }
  }
  if (requestUrl.pathname === '/api/ask') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing OPENAI_API_KEY' }));
      return;
    }

    const body = await readJsonBody(req);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!text || !question) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing text or question' }));
      return;
    }

    const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          instructions: ASK_SYSTEM_PROMPT,
          input: `Selected text:\n${text}\n\nQuestion:\n${question}`
        })
      });

      const data = await response.json();
      if (!response.ok) {
        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: data?.error?.message || 'Question failed' }));
        return;
      }

      const output = extractOpenAiText(data);
      if (!output) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Question failed' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ output, model }));
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Question failed' }));
      return;
    }
  }
  const shareSegments = requestUrl.pathname.split('/').filter(Boolean);
  const isShareRoute = (shareSegments[0] === 'share' || shareSegments[0] === 's')
    && shareSegments.length === 2;
  if (isShareRoute) {
    try {
      const shareHtmlPath = path.join(distDir, 'share.html');
      const data = await fs.readFile(shareHtmlPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
      return;
    } catch (error) {
      res.writeHead(404);
      res.end('Not found');
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

function extractOpenAiText(payload) {
  if (!payload) {
    return '';
  }
  if (typeof payload.output_text === 'string') {
    return payload.output_text.trim();
  }
  if (!Array.isArray(payload.output)) {
    return '';
  }
  const parts = [];
  payload.output.forEach((item) => {
    if (item?.type !== 'message') {
      return;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((part) => {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    });
  });
  return parts.join('\n').trim();
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runSqlite(dbPath, sql, { json = false } = {}) {
  const args = json ? ['-json', '-bail', dbPath] : ['-bail', dbPath];
  const timeoutMs = Number(process.env.SQLITE_TIMEOUT_MS) || 8000;
  const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 160);
  debug('sqlite3 start', { dbPath, json, timeoutMs, sql: preview });
  return await new Promise((resolve, reject) => {
    const child = spawn('sqlite3', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      debug('sqlite3 error', error?.message || error);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error('sqlite3 timed out');
        error.code = 'ETIMEDOUT';
        error.signal = signal;
        debug('sqlite3 error', error.message);
        reject(error);
        return;
      }
      if (code !== 0) {
        const error = new Error(`sqlite3 exited with code ${code}`);
        error.code = code;
        error.stderr = stderr;
        debug('sqlite3 error', error.message);
        reject(error);
        return;
      }
      if (stderr.trim()) {
        debug('sqlite3 stderr', stderr.trim());
      }
      debug('sqlite3 done');
      resolve(stdout);
    });

    if (child.stdin) {
      child.stdin.write(sql);
      child.stdin.end();
    }
  });
}

async function ensureVocabDb(dbPath) {
  const sql = `
    CREATE TABLE IF NOT EXISTS vocab_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO vocab_state (id, payload, updated_at)
    VALUES (1, '[]', 0)
    ON CONFLICT(id) DO NOTHING;
  `;
  await runSqlite(dbPath, sql);
}

async function ensureShareDb(dbPath) {
  const sql = `
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS shared_entries (
      token TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS share_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      author TEXT,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (token) REFERENCES shared_entries(token) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_share_comments_token ON share_comments(token, created_at);
  `;
  await runSqlite(dbPath, sql);
}

function createShareToken() {
  return randomBytes(18).toString('hex');
}

function normalizeShareEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 200) : '';
  const text = typeof entry.text === 'string' ? entry.text.trim().slice(0, 20000) : '';
  if (!title && !text) {
    return null;
  }
  const now = Date.now();
  const createdAt = Number.isFinite(entry.createdAt) ? Math.trunc(entry.createdAt) : now;
  const updatedAt = Number.isFinite(entry.updatedAt) ? Math.trunc(entry.updatedAt) : now;
  return {
    title,
    text,
    createdAt,
    updatedAt
  };
}

function normalizeShareComment(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const author = typeof body.author === 'string' ? body.author.trim().slice(0, 80) : '';
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 2000) : '';
  if (!text) {
    return null;
  }
  return {
    author,
    body: text
  };
}

function parseSqliteJson(stdout) {
  if (!stdout || !stdout.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function writeShareEntry(dbPath, token, entry) {
  const payload = JSON.stringify(entry);
  const sql = `
    INSERT INTO shared_entries (token, payload, created_at, updated_at)
    VALUES (${sqlString(token)}, ${sqlString(payload)}, ${entry.createdAt}, ${entry.updatedAt});
  `;
  await runSqlite(dbPath, sql);
}

async function updateShareEntry(dbPath, token, entry) {
  const existing = await readShareEntry(dbPath, token);
  if (!existing) {
    return false;
  }
  const payload = JSON.stringify(entry);
  const sql = `
    UPDATE shared_entries
    SET payload = ${sqlString(payload)}, updated_at = ${entry.updatedAt}
    WHERE token = ${sqlString(token)};
  `;
  await runSqlite(dbPath, sql);
  return true;
}

async function readShareEntry(dbPath, token) {
  const sql = `
    SELECT payload, created_at, updated_at
    FROM shared_entries
    WHERE token = ${sqlString(token)}
    LIMIT 1;
  `;
  const stdout = await runSqlite(dbPath, sql, { json: true });
  const rows = parseSqliteJson(stdout);
  if (!rows.length) {
    return null;
  }
  const payload = rows[0]?.payload;
  if (typeof payload !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(payload);
    return {
      ...parsed,
      createdAt: Number(rows[0]?.created_at) || parsed?.createdAt || null,
      updatedAt: Number(rows[0]?.updated_at) || parsed?.updatedAt || null
    };
  } catch (error) {
    return null;
  }
}

async function readShareComments(dbPath, token) {
  const entry = await readShareEntry(dbPath, token);
  if (!entry) {
    return null;
  }
  const sql = `
    SELECT id, author, body, created_at
    FROM share_comments
    WHERE token = ${sqlString(token)}
    ORDER BY created_at DESC
    LIMIT 200;
  `;
  const stdout = await runSqlite(dbPath, sql, { json: true });
  const rows = parseSqliteJson(stdout);
  return rows.map((row) => ({
    id: Number(row.id),
    author: row.author || '',
    body: row.body || '',
    createdAt: Number(row.created_at) || null
  }));
}

async function insertShareComment(dbPath, token, comment) {
  const entry = await readShareEntry(dbPath, token);
  if (!entry) {
    return null;
  }
  const createdAt = Date.now();
  const sql = `
    INSERT INTO share_comments (token, author, body, created_at)
    VALUES (${sqlString(token)}, ${sqlString(comment.author || '')}, ${sqlString(comment.body)}, ${createdAt});
  `;
  await runSqlite(dbPath, sql);
  return {
    id: null,
    author: comment.author || '',
    body: comment.body,
    createdAt
  };
}

function normalizeVocabList(items, { defaultAddedAt } = {}) {
  if (!Array.isArray(items)) {
    return [];
  }
  const fallbackAddedAt = Number.isFinite(defaultAddedAt) ? defaultAddedAt : Date.now();
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const word = typeof item.word === 'string' ? item.word : '';
      const reading = typeof item.reading === 'string' ? item.reading : '';
      const meaning = typeof item.meaning === 'string' ? item.meaning : '';
      const addedAt = Number.isFinite(item.addedAt) ? Math.trunc(item.addedAt) : fallbackAddedAt;
      if (!word && !reading && !meaning) {
        return null;
      }
      return {
        word,
        reading,
        meaning,
        addedAt
      };
    })
    .filter(Boolean);
}

function normalizeVocabDeleteTargets(body) {
  const rawItems = Array.isArray(body?.items)
    ? body.items
    : [body?.entry ?? body];
  return rawItems
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const word = typeof item.word === 'string' ? item.word : '';
      const reading = typeof item.reading === 'string' ? item.reading : '';
      const meaning = typeof item.meaning === 'string' ? item.meaning : '';
      const addedAt = Number.isFinite(item.addedAt) ? Math.trunc(item.addedAt) : null;
      if (!word && !reading) {
        return null;
      }
      return {
        word,
        reading,
        meaning,
        addedAt
      };
    })
    .filter(Boolean);
}

function isSameVocabEntry(entry, target) {
  if (!entry || !target) {
    return false;
  }
  if ((entry.word || '') !== target.word) {
    return false;
  }
  if ((entry.reading || '') !== target.reading) {
    return false;
  }
  if (Number.isFinite(target.addedAt)) {
    return Number.isFinite(entry.addedAt) && entry.addedAt === target.addedAt;
  }
  return true;
}

async function deleteVocabEntries(dbPath, targets) {
  const items = await readVocabState(dbPath);
  if (!targets.length || !items.length) {
    return { items, removed: 0 };
  }
  let next = items;
  targets.forEach((target) => {
    next = next.filter((entry) => !isSameVocabEntry(entry, target));
  });
  const removed = items.length - next.length;
  if (removed) {
    await writeVocabState(dbPath, next);
  }
  return { items: next, removed };
}

async function readVocabState(dbPath) {
  const sql = 'SELECT payload FROM vocab_state WHERE id = 1;';
  const stdout = await runSqlite(dbPath, sql, { json: true });
  if (!stdout.trim()) {
    return [];
  }
  try {
    const rows = JSON.parse(stdout);
    const payload = rows?.[0]?.payload;
    if (typeof payload !== 'string') {
      return [];
    }
    const parsed = JSON.parse(payload);
    return normalizeVocabList(parsed, { defaultAddedAt: 0 });
  } catch (error) {
    return [];
  }
}

async function writeVocabState(dbPath, items) {
  const payload = JSON.stringify(items);
  const updatedAt = Date.now();
  const sql = `
    INSERT INTO vocab_state (id, payload, updated_at)
    VALUES (1, ${sqlString(payload)}, ${updatedAt})
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  `;
  await runSqlite(dbPath, sql);
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
