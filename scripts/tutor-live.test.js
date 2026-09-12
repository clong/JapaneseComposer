import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDiagnosticBlueprint, createInitialActivityState } from '../src/tutor-v2.js';
import { createTutorLiveHandoff, createTutorLiveSessionConfig, createTutorLiveTranscript, tutorLiveAppends, waitForTutorLiveClose } from '../src/tutor-live.js';
import { createTutorLiveCall, createTutorLiveDirector, createTutorLiveAudioBuffer, createTutorLiveGreeting, tutorLiveSidebandUrl } from './tutor-live-server.js';
import { createTutorV2Service, isTutorSameOriginRequest } from './tutor-v2-server.js';
import { connectTutorV2WebRtc } from '../src/tutor-v2-transport.js';

const fragment = (role, id, delta, start, end) => ({
  type: `session.${role === 'user' ? 'input' : 'output'}_transcript.delta`,
  event_id: id, delta, start_ms: start, end_ms: end
});
const delegation = (id, offset = 1000) => ({ type: 'session.delegation.created', offset_ms: offset,
  delegation: { id, type: 'delegation', target: 'client' } });

test('Tutor rejects cross-origin requests before authentication, storage, or model calls', async () => {
  assert.equal(isTutorSameOriginRequest({ headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } }), true);
  assert.equal(isTutorSameOriginRequest({ headers: { host: 'localhost:5173' } }), true);
  const rejected = [
    { host: 'localhost:5173', origin: 'https://unrelated.example' },
    { host: 'localhost:5173', origin: 'http://localhost:5174' },
    { host: 'localhost:5173', origin: 'null' },
    { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' }
  ];
  const service = createTutorV2Service({
    workspaceDbPath: 'unused', audioDirectory: 'unused',
    runSqlite: () => assert.fail('Cross-origin requests must not reach storage'),
    sqlString: () => assert.fail('Cross-origin requests must not build SQL'),
    fetchImpl: () => assert.fail('Cross-origin requests must not call a model'),
    getActor: () => assert.fail('Cross-origin requests must not reach authentication'),
    writeJson: (res, status, body) => Object.assign(res, { status, body })
  });
  for (const headers of rejected) {
    assert.equal(isTutorSameOriginRequest({ headers }), false);
    const res = {};
    assert.equal(await service.handleRequest({ headers, method: 'POST' }, res,
      new URL('http://localhost:5173/api/tutor/v2/diagnostic')), true);
    assert.equal(res.status, 403);
  }
});

test('Live starts with client delegation and no Realtime-only configuration', async () => {
  const blueprint = buildDiagnosticBlueprint({});
  const config = createTutorLiveSessionConfig({ blueprint, activityState: createInitialActivityState(blueprint),
    preferences: { speechRate: 0.5, voice: 'cedar', transcriptionMode: 'ja' } });
  assert.equal(config.model, 'gpt-live-1');
  assert.deepEqual(config.delegation, { type: 'client' });
  assert.deepEqual(config.audio, { output: { voice: 'cedar' } });
  for (const key of ['type', 'reasoning', 'tools', 'tool_choice', 'max_output_tokens']) assert.equal(key in config, false);
  assert.match(config.instructions, /A1\/N5/);
  assert.match(config.instructions, /Never ask the learner to practice English/);
  assert.match(config.instructions, /one brief English explanation/);
  assert.match(config.instructions, /very slowly/);
  let sent;
  const result = await createTutorLiveCall({ apiKey: 'test-secret', safetyIdentifier: 'hashed-user', offerSdp: 'offer',
    options: { blueprint, activityState: createInitialActivityState(blueprint) },
    fetchImpl: async (url, request) => {
      sent = { url, request, payload: JSON.parse(request.body) };
      return new Response(JSON.stringify({ session: { id: 'live_opaque/id' }, transport: { type: 'webrtc', sdp: 'answer' } }), { status: 201 });
    } });
  assert.equal(sent.url, 'https://api.openai.com/v1/live/sessions');
  assert.deepEqual(sent.payload.transport, { type: 'webrtc', sdp: 'offer' });
  assert.equal(sent.request.headers['OpenAI-Safety-Identifier'], 'hashed-user');
  assert.deepEqual(result, { callId: 'live_opaque/id', answerSdp: 'answer' });
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
  assert.equal(tutorLiveSidebandUrl(result.callId), 'wss://api.openai.com/v1/live/sessions/live_opaque%2Fid/attach');
});

test('Live creation surfaces model access errors and rejects incomplete answers', async () => {
  const options = { blueprint: buildDiagnosticBlueprint({}) };
  await assert.rejects(createTutorLiveCall({ options,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'No model access' } }), { status: 403 })
  }), { message: 'No model access', status: 403 });
  await assert.rejects(createTutorLiveCall({ options,
    fetchImpl: async () => new Response('{}')
  }), { status: 502 });
});

test('Live captions preserve overlap, repeated words, late fragments and earlier speech after interruption', () => {
  const transcript = createTutorLiveTranscript();
  const first = transcript.append(fragment('assistant', 'a1', '最近', 0, 500));
  transcript.append(fragment('user', 'u1', 'えっと', 400, 800));
  const next = transcript.append(fragment('assistant', 'a2', '何をしましたか？', 900, 1500));
  assert.notEqual(first.id, next.id);
  transcript.append(fragment('assistant', 'a0', 'は', 300, 400));
  assert.equal(first.transcript, '最近は');
  assert.equal(next.transcript, '何をしましたか？');
  assert.equal(transcript.append(fragment('assistant', 'a2', 'duplicate', 900, 1500)), null);
  const user = transcript.append(fragment('user', 'u2', 'I I ', 2000, 2400));
  transcript.append(fragment('user', 'u3', 'went.', 2450, 2700));
  assert.equal(user.transcript, 'I I went.');
  assert.deepEqual(transcript.rows.map((row) => row.id), [first.id, 'live_user_u1', next.id, user.id]);
});

test('Live context appends preserve text and fit the per-append token bound', () => {
  const text = '日本語をゆっくり話してください。'.repeat(60);
  const events = tutorLiveAppends('session.instructions.append', text, 'opaque-delegation');
  assert.equal(events.map((event) => event.content).join(''), text);
  for (const event of events) {
    assert.ok(Buffer.byteLength(event.content) <= 450);
    assert.equal(event.delegation_id, 'opaque-delegation');
  }
});

test('Live greeting begins once and only after its instructions are acknowledged', () => {
  const sent = [];
  const greeting = createTutorLiveGreeting((event) => sent.push(event));
  greeting.start();
  greeting.start();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'session.instructions.append');
  greeting.handle({ type: 'session.instructions.appended', client_event_id: 'unrelated' });
  assert.equal(sent.length, 1);
  const accepted = { type: 'session.instructions.appended', client_event_id: sent[0].event_id };
  greeting.handle(accepted);
  greeting.handle(accepted);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'session.commentary.append');
});

function directorHarness(assess = async () => ({ correction: { required: false } })) {
  const sent = []; const rows = []; const fragments = []; const usage = [];
  const director = createTutorLiveDirector({ send: (event) => { sent.push(event); return true; }, assess,
    context: () => 'Current activity: a short Japanese question.', persistRow: async (row) => rows.push(row),
    persistFragment: async (event) => fragments.push(event), status: () => {}, usage: (...args) => usage.push(args),
    logError: () => {}, transcriptDelayMs: 0 });
  return { director, sent, rows, fragments, usage };
}

test('Live handover redirects an open session, deduplicates clicks and waits for its own acknowledgment', () => {
  let ready = false;
  const sent = [];
  const handoff = createTutorLiveHandoff({ canSend: () => ready, send: (event) => { sent.push(event); return true; } });
  try {
    assert.equal(handoff.request(), false);
    assert.equal(sent.length, 0);
    ready = true;
    assert.equal(handoff.request(), true);
    assert.equal(handoff.request(), false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'session.instructions.append');
    assert.equal(sent[0].delegation_id, null);
    assert.match(sent[0].content, /has finished speaking/);
    assert.match(sent[0].content, /If assessment is pending/);
    assert.equal(handoff.pending, true);
    handoff.handle({ type: 'session.instructions.appended', client_event_id: 'unrelated' });
    assert.equal(handoff.pending, true);
    handoff.handle({ type: 'session.instructions.appended', client_event_id: sent[0].event_id });
    assert.equal(handoff.pending, false);
    assert.equal(handoff.request(), true);
    assert.notEqual(sent[0].event_id, sent[1].event_id);
    handoff.handle({ type: 'session.closed' });
    assert.equal(handoff.pending, false);
  } finally { handoff.reset(); }
});

test('Live handover releases the button on send failure, rejection, timeout and cleanup', async () => {
  let errors = 0;
  let sendResult = false;
  let lastEvent;
  const handoff = createTutorLiveHandoff({ canSend: () => true,
    send: (event) => { lastEvent = event; return sendResult; }, onError: () => { errors += 1; }, timeoutMs: 5 });
  try {
    assert.equal(handoff.request(), false);
    assert.equal(handoff.pending, false);
    assert.equal(errors, 1);
    sendResult = true;
    handoff.request();
    handoff.handle({ type: 'error', error: { event_id: lastEvent.event_id } });
    assert.equal(handoff.pending, false);
    assert.equal(errors, 2);
    handoff.request();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(handoff.pending, false);
    assert.equal(errors, 3);
    handoff.request();
    handoff.reset();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(errors, 3);
  } finally { handoff.reset(); }
});

test('Live delegates once using accumulated captions without manufacturing completed voice turns', async () => {
  const assessments = [];
  const h = directorHarness(async (turn) => { assessments.push(turn); return { correction: { required: false } }; });
  h.director.handle(fragment('user', 'u1', '日本に', 10, 500));
  h.director.handle(fragment('user', 'u2', '行きました。', 510, 990));
  await h.director.drain();
  assert.equal(assessments.length, 0);
  h.director.handle(delegation('d1'));
  h.director.handle(delegation('d1'));
  await h.director.drain();
  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].transcript, '日本に行きました。');
  assert.equal(h.fragments.length, 2);
  assert.ok(h.sent.every((event) => event.delegation_id === 'd1'));
  assert.ok(h.sent.every((event) => event.type.startsWith('session.')));
  assert.equal(h.sent.some((event) => event.type === 'response.create'), false);
});

test('Live discards stale assessment results when the learner changes the answer', async () => {
  let request;
  let resolveAssessment;
  const h = directorHarness((turn) => { request = turn; return new Promise((resolve) => { resolveAssessment = resolve; }); });
  h.director.handle(fragment('user', 'u1', '京都', 0, 600));
  h.director.handle(delegation('d1'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(request.isCurrent(), true);
  h.director.handle(fragment('user', 'u2', 'ではなく東京。', 650, 950));
  assert.equal(request.isCurrent(), false);
  resolveAssessment({ correction: { required: false } });
  await h.director.drain();
  assert.equal(h.sent.some((event) => event.type === 'session.commentary.append'), false);
  assert.ok(h.sent.some((event) => event.type === 'session.instructions.append' && /clarification/.test(event.content)));
  assert.equal(h.sent.some((event) => /assessment is complete/.test(event.content)), false);
});

test('Live retries a discarded assessment with late captions without waiting for a second delegation', async () => {
  const assessments = [];
  const h = directorHarness(async (turn) => {
    assessments.push(turn.transcript);
    if (assessments.length === 1) {
      h.director.handle(fragment('user', 'u2', '行きました。', 510, 990));
      assert.equal(turn.isCurrent(), false);
      return null; // assessTurn does not commit a result when isCurrent() is false.
    }
    return { correction: { required: true, corrected: '日本に行きました。' } };
  });
  h.director.handle(fragment('user', 'u1', '日本に', 10, 500));
  h.director.handle(delegation('d1'));
  await h.director.drain();
  assert.deepEqual(assessments, ['日本に', '日本に行きました。']);
  assert.ok(h.sent.some((event) => /assessment is complete/.test(event.content)));
  assert.ok(h.sent.every((event) => event.delegation_id === 'd1'));
});

test('Live bounds stale retries and gives a spoken clarification instruction instead of going quiet', async () => {
  let attempts = 0;
  const h = directorHarness(async () => {
    attempts += 1;
    h.director.handle(fragment('user', `late${attempts}`, 'えっと', attempts * 1100, attempts * 1100 + 100));
    return null;
  });
  h.director.handle(fragment('user', 'u1', '京都', 0, 600));
  h.director.handle(delegation('d1'));
  await h.director.drain();
  assert.equal(attempts, 2);
  assert.ok(h.sent.some((event) => event.type === 'session.instructions.append' && /clarification/.test(event.content)));
  assert.ok(h.sent.every((event) => event.delegation_id === 'd1'));
});

test('Live does not request repetition when a retry already satisfied a queued delegation', async () => {
  let attempts = 0;
  const h = directorHarness(async () => {
    attempts += 1;
    if (attempts === 1) {
      h.director.handle(fragment('user', 'u2', '行きました。', 510, 990));
      h.director.handle(delegation('d2'));
      return null;
    }
    return { correction: { required: false } };
  });
  h.director.handle(fragment('user', 'u1', '日本に', 10, 500));
  h.director.handle(delegation('d1'));
  await h.director.drain();
  await h.director.drain(); // The second delegation is enqueued during the first assessment.
  assert.equal(attempts, 2);
  assert.equal(h.sent.filter((event) => event.type === 'session.instructions.append').length, 1);
  assert.ok(h.sent.some((event) => event.delegation_id === 'd2' && /already assessed/.test(event.content)));
});

test('Live still requests clarification when no transcript is available for assessment', async () => {
  const h = directorHarness(() => assert.fail('Missing captions must not be assessed'));
  h.director.handle(delegation('d1'));
  await h.director.drain();
  assert.ok(h.sent.some((event) => event.type === 'session.instructions.append' && /repeat/.test(event.content)));
});

test('Live requests a follow-up when assessment returns no result or fails', async () => {
  for (const assess of [async () => null, async () => { throw new Error('Assessment timed out'); }]) {
    const h = directorHarness(assess);
    h.director.handle(fragment('user', 'u1', '京都', 0, 600));
    h.director.handle(delegation('d1'));
    await h.director.drain();
    assert.ok(h.sent.some((event) => event.type === 'session.instructions.append' && /assessment is unavailable/.test(event.content)));
  }
});

test('Live duration snapshots are not summed and close waits for finalization', async () => {
  const h = directorHarness();
  h.director.handle({ type: 'session.usage.updated', usage: { seconds: 10 } });
  h.director.handle({ type: 'session.usage.updated', usage: { seconds: 15 } });
  const closing = h.director.close(100);
  h.director.handle({ type: 'session.closed', usage: { seconds: 16 }, reason: 'close_requested' });
  assert.equal(await closing, true);
  assert.deepEqual(h.usage.at(-1), [{ seconds: 16 }, true, 'close_requested']);
  const channel = new EventTarget();
  channel.readyState = 'open';
  channel.send = (payload) => {
    assert.equal(JSON.parse(payload).type, 'session.close');
    channel.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'session.closed', usage: { seconds: 3 } }) }));
  };
  assert.equal((await waitForTutorLiveClose(channel)).finalized, true);
  channel.send = () => {};
  assert.equal((await waitForTutorLiveClose(channel, { timeoutMs: 1 })).finalized, false);
});

test('Live reflected audio produces bounded replayable WAV data', () => {
  const audio = createTutorLiveAudioBuffer({ maxBytes: 4800, now: () => 0 });
  const pcm = Buffer.alloc(4800, 10);
  audio.append({ type: 'session.output_audio.delta', delta: pcm.toString('base64'), start_ms: 0, end_ms: 100 });
  audio.append({ type: 'session.output_audio.delta', delta: pcm.toString('base64'), start_ms: 100, end_ms: 200 });
  const wav = audio.wav('assistant', 10, 90);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.length, 44 + 80 * 48);
  assert.equal(audio.wav('assistant', 110, 200), null);
  const partial = createTutorLiveAudioBuffer({ maxBytes: 2400, now: () => 0 });
  partial.append({ type: 'session.input_audio.append', audio: pcm.toString('base64') });
  assert.equal(partial.wav('user', 0, 100).length, 2444);
  audio.clear();
  assert.equal(audio.wav('assistant', 0, 100), null);
});

test('Live browser connection waits for session.started and releases media on failure', async () => {
  const calls = [];
  let stopped = 0;
  const track = { stop() { stopped += 1; } };
  const mediaDevices = { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) };
  class Peer extends EventTarget {
    constructor() { super(); this.iceGatheringState = 'complete'; }
    createDataChannel() {
      const channel = new EventTarget(); channel.readyState = 'open';
      channel.send = () => assert.fail('The browser must not trigger a Realtime response or send session.start');
      channel.close = () => channel.dispatchEvent(new Event('close'));
      this.channel = channel;
      return channel;
    }
    addTrack() {}
    createOffer() { return { sdp: 'offer' }; }
    setLocalDescription(offer) { this.localDescription = offer; }
    setRemoteDescription(answer) {
      assert.equal(answer.sdp, 'answer');
      this.channel.dispatchEvent(new Event('open'));
      queueMicrotask(() => this.channel.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ type: 'session.started', session: { id: 'live_1' } })
      })));
    }
    close() { calls.push('closed'); }
  }
  const options = { sessionId: 'tutor1', model: 'gpt-live-1', mediaDevices, PeerConnection: Peer,
    connectSdp: async () => 'answer', onDataChannelOpen: () => calls.push('open'),
    onSessionStarted: () => calls.push('started') };
  const connection = await connectTutorV2WebRtc(options);
  assert.deepEqual(calls, ['open', 'started']);
  connection.close();
  assert.equal(stopped, 1);
  await assert.rejects(connectTutorV2WebRtc({ ...options, connectSdp: async () => { throw new Error('Model unavailable'); } }), /Model unavailable/);
  assert.equal(stopped, 2);
});

test('Live migration persists raw captions and deletes them with the session', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tutor-live-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const query = (sql) => JSON.parse(execFileSync('sqlite3', ['-json', databasePath, sql], { encoding: 'utf8' }) || '[]');
  const db = { exec: query, prepare: (sql) => ({ all: () => query(sql), get: () => query(sql)[0] }) };
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, created_at INTEGER, updated_at INTEGER);');
  const sockets = [];
  class FakeSocket extends EventEmitter {
    constructor(url) {
      super(); this.url = url; this.readyState = 1; this.sent = []; sockets.push(this);
      queueMicrotask(() => this.emit('open'));
    }
    send(value) {
      this.sent.push(JSON.parse(value));
      if (JSON.parse(value).type === 'session.close') queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'session.closed', usage: { seconds: 2 } })));
    }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const service = createTutorV2Service({ apiKey: 'test-secret', workspaceDbPath: 'memory', audioDirectory: directory,
    runSqlite: async (_path, sql, options) => options?.json ? JSON.stringify(db.prepare(sql).all()) : db.exec(sql),
    sqlString: (value) => `'${String(value).replaceAll("'", "''")}'`, parseSqliteJson: (value) => JSON.parse(value || '[]'),
    writeJson: (res, statusCode, body) => { res.statusCode = statusCode; res.body = body; },
    getActor: async () => ({ id: 'local' }), WebSocketImpl: FakeSocket,
    fetchImpl: async (url) => url.endsWith('/live/sessions')
      ? new Response(JSON.stringify({ session: { id: 'live_test' }, transport: { sdp: 'answer' } }))
      : new Response('{}', { status: 503 }), logger: { warn() {}, error(error) { throw error; } } });
  const request = async (url, method, body = '') => {
    const req = Readable.from([Buffer.from(body)]); req.method = method; req.headers = {};
    const res = { writeHead(statusCode) { this.statusCode = statusCode; }, end(value) { this.body = value; } };
    await service.handleRequest(req, res, new URL(url, 'http://localhost'));
    return res;
  };
  try {
    await service.ensureSchema();
    await service.ensureSchema();
    const created = await request('/api/tutor/v2/diagnostic', 'POST', '{}');
    const id = created.body.session.id;
    assert.equal(created.body.session.model, 'gpt-live-1');
    const connection = await request(`/api/tutor/v2/sessions/${id}/connect`, 'POST', 'offer');
    assert.equal(connection.body, 'answer');
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(sockets[0].url, 'wss://api.openai.com/v1/live/sessions/live_test/attach');
    sockets[0].emit('message', JSON.stringify({ type: 'session.instructions.appended', client_event_id: 'tutor_greeting_0' }));
    assert.equal(sockets[0].sent.at(-1).type, 'session.commentary.append');
    const pcm = Buffer.alloc(48000, 10).toString('base64');
    sockets[0].emit('message', JSON.stringify({ type: 'session.input_audio.append', audio: pcm }));
    sockets[0].emit('message', JSON.stringify({ type: 'session.output_audio.delta', delta: pcm, start_ms: 0, end_ms: 1000 }));
    sockets[0].emit('message', JSON.stringify(fragment('user', 'u1', 'こんにちは。', 0, 1000)));
    sockets[0].emit('message', JSON.stringify(fragment('assistant', 'a1', 'こんにちは。', 0, 1000)));
    sockets[0].emit('message', JSON.stringify({ type: 'session.closed', usage: { seconds: 2 } }));
    await request(`/api/tutor/v2/sessions/${id}/end`, 'POST');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_tutor_live_fragments').get().n, 2);
    const history = await request('/api/tutor/v2/sessions', 'GET');
    assert.equal(history.body.sessions[0].audioClips.length, 2);
    assert.ok(history.body.sessions[0].turns.every((turn) => turn.audioClipIds.length === 1));
    const clips = db.prepare('SELECT storage_path FROM user_tutor_audio_v2').all();
    assert.equal((await readFile(clips[0].storage_path)).toString('ascii', 0, 4), 'RIFF');
    assert.equal(sockets[0].sent.some((event) => event.type === 'response.create'), false);
    await request(`/api/tutor/v2/sessions/${id}`, 'DELETE');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_tutor_live_fragments').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_tutor_audio_v2').get().n, 0);
    await assert.rejects(readFile(clips[0].storage_path), { code: 'ENOENT' });
    const active = (await request('/api/tutor/v2/diagnostic', 'POST', '{}')).body.session.id;
    await request(`/api/tutor/v2/sessions/${active}/connect`, 'POST', 'offer');
    await new Promise((resolve) => setTimeout(resolve, 280));
    await request(`/api/tutor/v2/sessions/${active}`, 'DELETE');
    sockets[1].emit('message', JSON.stringify(fragment('user', 'late', 'late caption', 0, 500)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_tutor_sessions_v2').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_tutor_live_fragments').get().n, 0);
  } finally {
    await service.close(); await rm(directory, { recursive: true, force: true });
  }
});
