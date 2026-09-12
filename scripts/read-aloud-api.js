import { ReadingError } from '../src/reading-model.js';
import { createReadAloudService } from './read-aloud-service.js';

export async function readAudioBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 16_000_000) throw new ReadingError('Recording upload is too large.', 413); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 4) throw new ReadingError('Missing recording.');
  const length = bytes.readUInt32LE(0);
  if (length < 2 || length > 1_500_000 || length + 4 > bytes.length) throw new ReadingError('Invalid recording metadata.');
  let body; try { body = JSON.parse(bytes.subarray(4, length + 4).toString()); } catch { throw new ReadingError('Invalid recording metadata.'); }
  return { body, bytes: bytes.subarray(length + 4) };
}
export function audioRange(header, length) {
  if (!header) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new ReadingError('Invalid audio range.', 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= length) throw new ReadingError('Audio range is unavailable.', 416);
  return { start, end, partial: true };
}
export function createReadAloudApi(options) {
  const service = options.aloud || createReadAloudService(options);
  const callers = new Map();
  return async (req, res, route, readJson, send) => {
    const audioMatch = /^articles\/(nhkeasier-\d{1,12})\/audio$/.exec(route);
    if (!audioMatch && !route.startsWith('read-aloud/')) return false;
    if (req.headers?.origin) {
      let same = false; try { same = new URL(req.headers.origin).host === req.headers.host; } catch {}
      if (!same) throw new ReadingError('Use Read aloud from the app.', 403);
    }
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    req.on?.('aborted', cancel); res.on?.('close', cancel);
    const ip = req.socket?.remoteAddress || 'local';
    const now = Date.now();
    if (callers.size > 1000) for (const [id, value] of callers) if (!value.active && now - value.since > 60000) callers.delete(id);
    const caller = callers.get(ip) || { active: 0, count: 0, since: now };
    if (now - caller.since > 60000) { caller.count = 0; caller.since = now; }
    if (caller.active >= 3 || caller.count >= 30) throw new ReadingError('Too many audio requests. Please retry shortly.', 429);
    caller.active++; caller.count++; callers.set(ip, caller);
    try {
      if (audioMatch && ['GET', 'HEAD'].includes(req.method)) {
        const { bytes, version } = await service.audio(audioMatch[1], controller.signal);
        let range;
        try { range = audioRange(req.headers?.range, bytes.length); }
        catch (error) { res.setHeader?.('Content-Range', `bytes */${bytes.length}`); throw error; }
        res.writeHead(range.partial ? 206 : 200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=600',
          ETag: `"${version}"`, 'Content-Length': range.end - range.start + 1,
          ...(range.partial ? { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } : {}) });
        res.end(req.method === 'HEAD' ? undefined : bytes.subarray(range.start, range.end + 1));
      } else if (req.method !== 'POST') throw new ReadingError('Method not allowed.', 405);
      else if (route === 'read-aloud/reference') send(res, 200, await service.reference(await readJson(req), controller.signal));
      else if (route === 'read-aloud/transcription-session') { await readJson(req); send(res, 200, await service.transcriptionSession(controller.signal)); }
      else if (route === 'read-aloud/review') {
        const { body, bytes } = await readAudioBody(req);
        send(res, 200, await service.review(body, bytes, controller.signal));
      } else throw new ReadingError('Read aloud route not found.', 404);
      return true;
    } finally { caller.active--; req.off?.('aborted', cancel); res.off?.('close', cancel); }
  };
}
