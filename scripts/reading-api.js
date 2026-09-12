import { createReadingSource } from './reading-source.js';
import { createReadingStore } from './reading-store.js';
import { createReadingAi } from './reading-ai.js';
import { ReadingError } from '../src/reading-model.js';
import { createReadAloudApi } from './read-aloud-api.js';

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_500_000) throw new ReadingError('Reading request is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ReadingError('Invalid JSON request.'); }
}
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

export function createReadingApi({ dbPath, runSqlite, getUser, isDbReady, source = createReadingSource(), ai = createReadingAi(), aloud }) {
  const store = createReadingStore({ dbPath, runSqlite });
  const aloudApi = createReadAloudApi({ dbPath, runSqlite, isDbReady, source, aloud });
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/reading/')) return false;
    try {
      const route = url.pathname.slice('/api/reading/'.length);
      if (await aloudApi(req, res, route, readBody, send)) return true;
      if (route === 'articles' && req.method === 'GET') send(res, 200, await source.list());
      else if (route.startsWith('articles/') && req.method === 'GET') send(res, 200, { article: await source.article(route.slice(9)) });
      else if (route === 'reverse' && req.method === 'POST') send(res, 200, await ai.reverse(await readBody(req)));
      else if (route === 'grade' && req.method === 'POST') send(res, 200, await ai.grade(await readBody(req)));
      else if (route === 'sessions' || route.startsWith('sessions/')) {
        if (!isDbReady()) throw new ReadingError('Reading session storage is unavailable.', 503);
        const user = await getUser(req, res);
        if (!user) return true;
        const id = route.slice(9);
        if (route === 'sessions' && req.method === 'GET') send(res, 200, { records: await store.list(user.id) });
        else if (id && req.method === 'GET') {
          const record = await store.get(user.id, id);
          if (!record || record.deleted) throw new ReadingError('Session not found.', 404);
          send(res, 200, record);
        } else if (id && ['PUT', 'DELETE'].includes(req.method)) {
          const body = await readBody(req);
          send(res, 200, await store.write(user.id, id, body?.session, body?.expectedRevision, req.method === 'DELETE'));
        } else throw new ReadingError('Method not allowed.', 405);
      } else throw new ReadingError('Reading route or method not found.', 404);
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 502, { error: error instanceof ReadingError ? error.message : 'Reading request failed. Please retry.', ...(error.status === 409 ? { current: error.current } : {}) });
    }
    return true;
  };
}
