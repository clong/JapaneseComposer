import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

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
});
