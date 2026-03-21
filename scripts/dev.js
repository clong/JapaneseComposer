import http from 'node:http';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ASK_SYSTEM_PROMPT,
  PROOFREAD_SYSTEM_PROMPT,
  SYNTHETIC_DOCUMENT_SYSTEM_PROMPT,
  VOCAB_RESOLUTION_SYSTEM_PROMPT
} from './openai-prompts.js';
import {
  buildDictionaryMeaning,
  buildFallbackVocabEntry,
  formatDictionaryCandidatesForPrompt,
  normalizeLookupText,
  parseVocabResolutionOutput,
  resolveSelectionVocabEntry
} from './vocab-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const dataDir = path.join(root, 'data');
const localEntriesPath = process.env.JMDICT_ENTRIES_PATH || path.join(dataDir, 'jmdict-entries.json');
const localIndexPath = process.env.JMDICT_INDEX_PATH || path.join(dataDir, 'jmdict-index.json');
const vocabDbPath = process.env.VOCAB_DB_PATH || path.join(dataDir, 'vocab.sqlite');
const workspaceDbPath = process.env.WORKSPACE_DB_PATH || path.join(dataDir, 'workspace.sqlite');
const DEFAULT_OPENAI_MODEL = 'gpt-4.1';

const SYNTHETIC_DIFFICULTIES = ['N5', 'N4', 'N3', 'N2', 'N1'];
const SYNTHETIC_CATEGORIES = [
  'News Article',
  'Fiction Novel',
  'Technical Writing',
  'Poetry',
  'Essay',
  'Diary'
];

const debugEnabled = process.env.DEV_DEBUG === '1';
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';
const BASIC_AUTH_REALM = process.env.BASIC_AUTH_REALM || 'Japanese Composer';
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';
const REQUIRE_GOOGLE_AUTH = process.env.REQUIRE_GOOGLE_AUTH === '1';
const ALLOWED_GOOGLE_EMAILS = new Set(
  String(process.env.ALLOWED_GOOGLE_EMAILS || '')
    .split(',')
    .map((value) => normalizeEmail(value))
    .filter(Boolean)
);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'jc_session';
const OAUTH_STATE_COOKIE_NAME = 'jc_oauth_state';
const SESSION_MAX_AGE_MS = Math.max(60 * 60 * 1000, Number(process.env.SESSION_MAX_AGE_MS) || (1000 * 60 * 60 * 24 * 30));
const WORKFLOW_ROLES = new Set(['student', 'teacher']);
const WORKFLOW_STATUSES = new Set(['draft', 'submitted', 'reviewed', 'revision_requested', 'final']);
const WORKFLOW_TRANSITION_ACTIONS = new Set(['submit', 'return_review', 'mark_final']);
const WORKFLOW_EVENT_ACTIONS = new Set(['share_start', 'share_update', 'submit', 'return_review', 'mark_final']);
const STUDENT_WORKFLOW_ACTIONS = new Set(['submit', 'mark_final']);
const TEACHER_WORKFLOW_ACTIONS = new Set(['return_review']);
const MAX_IMAGES_PER_DOCUMENT = 8;
const MAX_DOCUMENT_IMAGE_SOURCE_LENGTH = 500000;
const AUTH_AUDIT_THROTTLE_MS = Math.max(1000, Number(process.env.AUTH_AUDIT_THROTTLE_MS || '5000'));
const NOISY_AUTH_PATHS = new Set(['/api/auth/session', '/api/workspace']);
const authAuditEventLogState = new Map();

function debug(...args) {
  if (!debugEnabled) {
    return;
  }
  console.log('[dev]', ...args);
}

function getRequestPath(req) {
  if (!req || typeof req.url !== 'string') {
    return '/';
  }
  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch (error) {
    return req.url || '/';
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function parseBasicAuth(header) {
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, encoded] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) {
    return null;
  }
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (error) {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    return { username: '', password: decoded };
  }
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

function auditAuthEvent({ ok, reason, username, req }) {
  const now = Date.now();
  const path = getRequestPath(req);
  const method = req?.method || 'UNKNOWN';
  const user = username || 'unknown';
  if (ok && reason === 'ok' && NOISY_AUTH_PATHS.has(path)) {
    const throttleKey = `${method}:${path}:${user}`;
    const lastLog = authAuditEventLogState.get(throttleKey) || 0;
    if (now - lastLog < AUTH_AUDIT_THROTTLE_MS) {
      return;
    }
    authAuditEventLogState.set(throttleKey, now);
  }

  const timestamp = new Date().toISOString();
  const ip = getClientIp(req);
  const userAgent = typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent']
    : '';
  const statusLabel = ok ? 'allow' : 'deny';
  const details = [
    `time=${timestamp}`,
    `ip=${ip}`,
    `method=${method}`,
    `path=${path}`,
    `user=${username || 'unknown'}`,
    `reason=${reason || 'ok'}`,
    userAgent ? `ua="${userAgent.replace(/"/g, '\\"')}"` : null
  ].filter(Boolean).join(' ');
  console.log(`[auth] ${statusLabel} ${details}`);
}

function requireBasicAuth(req, res) {
  if (!BASIC_AUTH_PASSWORD) {
    return true;
  }

  const credentials = parseBasicAuth(req.headers.authorization);
  if (!credentials || credentials.password !== BASIC_AUTH_PASSWORD) {
    res.writeHead(401, {
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`
    });
    res.end('Authentication required.');
    auditAuthEvent({
      ok: false,
      reason: credentials ? 'invalid_password' : 'missing_header',
      username: credentials?.username || '',
      req
    });
    return false;
  }

  auditAuthEvent({ ok: true, reason: 'ok', username: credentials.username, req });
  return true;
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

let workspaceDbReady = false;
try {
  debug('Initializing workspace DB:', workspaceDbPath);
  await ensureWorkspaceDb(workspaceDbPath);
  workspaceDbReady = true;
  debug('Workspace DB ready.');
} catch (error) {
  console.error('Failed to initialize workspace database:', error);
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
  if (!requireBasicAuth(req, res)) {
    return;
  }
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const isPublicAuthRoute = requestUrl.pathname === '/api/auth/session'
    || requestUrl.pathname === '/api/auth/google/start'
    || requestUrl.pathname === '/api/auth/google/callback'
    || requestUrl.pathname === '/api/auth/logout';
  if (REQUIRE_GOOGLE_AUTH && requestUrl.pathname.startsWith('/api/') && !isPublicAuthRoute) {
    if (!isGoogleOauthConfigured()) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Google OAuth is not configured' }));
      return;
    }
    if (!workspaceDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Workspace database unavailable' }));
      return;
    }
    const user = await requireAuthenticatedUser(workspaceDbPath, req, res);
    if (!user) {
      return;
    }
  }
  if (requestUrl.pathname === '/api/auth/session') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    let user = null;
    if (workspaceDbReady) {
      try {
        user = await readSessionUserFromRequest(workspaceDbPath, req);
      } catch (error) {
        user = null;
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Vary: 'Cookie'
    });
    res.end(JSON.stringify({
      enabled: isGoogleOauthConfigured() && workspaceDbReady,
      required: REQUIRE_GOOGLE_AUTH,
      authenticated: Boolean(user),
      user: user ? {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      } : null
    }));
    return;
  }
  if (requestUrl.pathname === '/api/auth/google/start') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    if (!isGoogleOauthConfigured()) {
      res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Google OAuth is not configured' }));
      return;
    }
    if (!workspaceDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Workspace database unavailable' }));
      return;
    }
    const state = createOauthStateToken();
    const location = buildGoogleOauthUrl(state);
    const secure = shouldUseSecureCookies(req);
    res.writeHead(302, {
      Location: location,
      'Set-Cookie': serializeCookie(OAUTH_STATE_COOKIE_NAME, state, {
        httpOnly: true,
        secure,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 10
      })
    });
    res.end();
    return;
  }
  if (requestUrl.pathname === '/api/auth/google/callback') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    if (!isGoogleOauthConfigured()) {
      res.writeHead(302, { Location: buildAppUrlWithQuery(req, { auth: 'disabled' }) });
      res.end();
      return;
    }
    if (!workspaceDbReady) {
      res.writeHead(302, { Location: buildAppUrlWithQuery(req, { auth: 'db_unavailable' }) });
      res.end();
      return;
    }
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');
    const cookies = parseCookies(req);
    const expectedState = cookies[OAUTH_STATE_COOKIE_NAME] || '';
    if (!code || !state || !expectedState || state !== expectedState) {
      const secure = shouldUseSecureCookies(req);
      res.writeHead(302, {
        Location: buildAppUrlWithQuery(req, { auth: 'state_mismatch' }),
        'Set-Cookie': serializeCookie(OAUTH_STATE_COOKIE_NAME, '', {
          httpOnly: true,
          secure,
          sameSite: 'Lax',
          path: '/',
          maxAge: 0
        })
      });
      res.end();
      return;
    }

    try {
      const tokenData = await exchangeGoogleOauthCode(code);
      const profile = await fetchGoogleUserProfile(tokenData.access_token);
      const user = normalizeGoogleUserProfile(profile);
      if (!user) {
        throw new Error('Missing Google profile');
      }
      if (!isAllowedGoogleUser(user)) {
        throw new Error('Google account not allowed');
      }
      await upsertUser(workspaceDbPath, user);
      const sessionToken = createSessionToken();
      const sessionExpiry = Date.now() + SESSION_MAX_AGE_MS;
      await createUserSession(workspaceDbPath, user.id, sessionToken, sessionExpiry);
      const secure = shouldUseSecureCookies(req);
      const cookiesToSet = [
        serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
          httpOnly: true,
          secure,
          sameSite: 'Lax',
          path: '/',
          maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000)
        }),
        serializeCookie(OAUTH_STATE_COOKIE_NAME, '', {
          httpOnly: true,
          secure,
          sameSite: 'Lax',
          path: '/',
          maxAge: 0
        })
      ];
      res.writeHead(302, {
        Location: buildAppUrlWithQuery(req, { auth: 'success' }),
        'Set-Cookie': cookiesToSet
      });
      res.end();
      return;
    } catch (error) {
      const oauthFailure = classifyOauthCallbackError(error);
      console.error('[oauth] callback_failed', {
        reason: oauthFailure.reason,
        message: oauthFailure.message
      });
      const secure = shouldUseSecureCookies(req);
      res.writeHead(302, {
        Location: buildAppUrlWithQuery(req, { auth: 'failed', reason: oauthFailure.reason }),
        'Set-Cookie': serializeCookie(OAUTH_STATE_COOKIE_NAME, '', {
          httpOnly: true,
          secure,
          sameSite: 'Lax',
          path: '/',
          maxAge: 0
        })
      });
      res.end();
      return;
    }
  }
  if (requestUrl.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const secure = shouldUseSecureCookies(req);
    const currentToken = getSessionTokenFromRequest(req);
    if (workspaceDbReady && currentToken) {
      try {
        await deleteUserSession(workspaceDbPath, currentToken);
      } catch (error) {
        // Ignore logout cleanup failures.
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': serializeCookie(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        secure,
        sameSite: 'Lax',
        path: '/',
        maxAge: 0
      })
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (requestUrl.pathname === '/api/workspace') {
    if (!workspaceDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Workspace database unavailable' }));
      return;
    }
    const user = await requireAuthenticatedUser(workspaceDbPath, req, res);
    if (!user) {
      return;
    }
    if (req.method === 'GET') {
      try {
        const workspace = await readUserWorkspace(workspaceDbPath, user.id);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          Vary: 'Cookie'
        });
        res.end(JSON.stringify({ workspace }));
        return;
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Workspace lookup failed' }));
        return;
      }
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const workspace = normalizeWorkspacePayload(body?.workspace ?? body);
      if (!workspace) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Missing workspace' }));
        return;
      }
      try {
        const result = await writeUserWorkspace(workspaceDbPath, user.id, workspace);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, updatedAt: result.updatedAt }));
        return;
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Workspace update failed' }));
        return;
      }
    }
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
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
  if (requestUrl.pathname === '/api/share-user') {
    if (!workspaceDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Workspace database unavailable' }));
      return;
    }
    const sender = await requireAuthenticatedUser(workspaceDbPath, req, res);
    if (!sender) {
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const body = await readJsonBody(req);
    const request = normalizeUserShareRequest(body);
    if (!request) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing recipient or document' }));
      return;
    }
    if (normalizeEmail(sender.email) === request.recipientEmail) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'You cannot share to your own account' }));
      return;
    }
    const recipient = await findUserByEmail(workspaceDbPath, request.recipientEmail);
    if (!recipient) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: 'Recipient not found. They need to sign in at least once first.'
      }));
      return;
    }
    try {
      const result = await shareDocumentWithGoogleUser(workspaceDbPath, {
        sender,
        recipient,
        sourceDocumentId: request.sourceDocumentId,
        document: request.document
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        sharedDocumentId: result.sharedDocumentId,
        workflowId: result.workflowId,
        status: result.status,
        senderDocument: result.senderDocument,
        updatedAt: result.updatedAt,
        recipient: {
          id: recipient.id,
          email: recipient.email,
          name: recipient.name
        }
      }));
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Share failed' }));
      return;
    }
  }
  if (requestUrl.pathname === '/api/workflow-transition') {
    if (!workspaceDbReady) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Workspace database unavailable' }));
      return;
    }
    const actor = await requireAuthenticatedUser(workspaceDbPath, req, res);
    if (!actor) {
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const body = await readJsonBody(req);
    const request = normalizeWorkflowTransitionRequest(body);
    if (!request) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing workflow action or document' }));
      return;
    }
    try {
      const result = await transitionSharedWorkflow(workspaceDbPath, {
        actor,
        action: request.action,
        sourceDocumentId: request.sourceDocumentId,
        document: request.document
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        status: result.status,
        updatedAt: result.updatedAt,
        document: result.actorDocument
      }));
      return;
    } catch (error) {
      const statusCode = Number.isFinite(error?.status) ? Math.trunc(error.status) : 502;
      res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error?.message || 'Workflow update failed' }));
      return;
    }
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
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ data: localResults }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ data: [] }));
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Lookup failed' }));
      return;
    }
  }
  if (requestUrl.pathname === '/api/vocab-resolve') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const body = await readJsonBody(req);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const lookupTarget = typeof body?.lookupTarget === 'string' ? body.lookupTarget.trim() : '';

    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing text' }));
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

    try {
      const dictionaryEntries = collectDictionaryCandidates([lookupTarget, text]);
      const resolved = await resolveSelectionVocabEntry({
        text,
        lookupText: lookupTarget,
        dictionaryEntries,
        resolveWithModel: apiKey
          ? ({ text: selectedText, lookupText: resolvedLookupText, dictionaryEntries: candidates }) => {
              return requestOpenAiVocabResolution({
                apiKey,
                model,
                text: selectedText,
                lookupText: resolvedLookupText,
                dictionaryEntries: candidates
              });
            }
          : null
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        entry: resolved?.entry || buildFallbackVocabEntry(text),
        source: resolved?.source || 'fallback',
        model: resolved?.source === 'model' ? model : null
      }));
      return;
    } catch (error) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        entry: buildFallbackVocabEntry(text),
        source: 'fallback',
        model: null
      }));
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

  if (requestUrl.pathname === '/api/synthetic-document') {
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
    const readingDifficulty = typeof body?.readingDifficulty === 'string'
      ? body.readingDifficulty.trim()
      : '';
    const textCategory = typeof body?.textCategory === 'string'
      ? body.textCategory.trim()
      : '';
    const vocabularyEntries = Array.isArray(body?.vocabulary)
      ? body.vocabulary
      : [];

    const vocabulary = vocabularyEntries
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const word = typeof entry.word === 'string' ? entry.word.trim() : '';
        const reading = typeof entry.reading === 'string' ? entry.reading.trim() : '';
        const meaning = typeof entry.meaning === 'string' ? entry.meaning.trim() : '';
        const source = typeof entry.source === 'string' ? entry.source.trim() : '';
        const sourceDocumentId = typeof entry.sourceDocumentId === 'string'
          ? entry.sourceDocumentId.trim()
          : '';
        if (!word && !reading && !meaning) {
          return null;
        }
        return {
          id: String(index),
          word,
          reading,
          meaning,
          source,
          sourceDocumentId
        };
      })
      .filter(Boolean);

    if (!vocabulary.length) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing vocabulary' }));
      return;
    }

    const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    const safeReadingDifficulty = SYNTHETIC_DIFFICULTIES.includes(readingDifficulty)
      ? readingDifficulty
      : SYNTHETIC_DIFFICULTIES[0];
    const safeTextCategory = SYNTHETIC_CATEGORIES.includes(textCategory)
      ? textCategory
      : SYNTHETIC_CATEGORIES[0];

    const vocabularyText = vocabulary
      .map((item, index) => `${index + 1}. ${item.word} ${item.reading ? `(${item.reading})` : ''} — ${item.meaning}`)
      .join('\n');

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          max_output_tokens: 850,
          instructions: SYNTHETIC_DOCUMENT_SYSTEM_PROMPT,
          input: [
            `Reading difficulty: ${safeReadingDifficulty}`,
            `Text category: ${safeTextCategory}`,
            'Target vocabulary:',
            vocabularyText
          ].join('\n\n')
        })
      });

      const data = await response.json();
      if (!response.ok) {
        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: data?.error?.message || 'Synthetic document generation failed' }));
        return;
      }

      const output = extractOpenAiText(data);
      if (!output) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Synthetic document generation failed' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        output,
        model,
        readingDifficulty: safeReadingDifficulty,
        textCategory: safeTextCategory
      }));
      return;
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Synthetic document generation failed' }));
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
    console.log('Local JMdict lookup not found.');
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

async function safeParseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function isGoogleOauthConfigured() {
  return Boolean(
    GOOGLE_OAUTH_CLIENT_ID
      && GOOGLE_OAUTH_CLIENT_SECRET
      && GOOGLE_OAUTH_REDIRECT_URI
  );
}

function createOauthStateToken() {
  return randomBytes(18).toString('hex');
}

function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || !header.trim()) {
    return {};
  }
  const cookies = {};
  const parts = header.split(';');
  parts.forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      return;
    }
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1);
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch (error) {
      cookies[key] = rawValue;
    }
  });
  return cookies;
}

function serializeCookie(name, value, {
  maxAge = null,
  path = '/',
  httpOnly = true,
  secure = false,
  sameSite = 'Lax'
} = {}) {
  const parts = [
    `${name}=${encodeURIComponent(String(value))}`,
    `Path=${path}`,
    `SameSite=${sameSite}`
  ];
  if (Number.isFinite(maxAge)) {
    parts.push(`Max-Age=${Math.max(0, Math.trunc(maxAge))}`);
  }
  if (httpOnly) {
    parts.push('HttpOnly');
  }
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function shouldUseSecureCookies(req) {
  if (process.env.FORCE_SECURE_COOKIES === '1') {
    return true;
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.toLowerCase().includes('https')) {
    return true;
  }
  return Boolean(req.socket?.encrypted);
}

function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req);
  return typeof cookies[SESSION_COOKIE_NAME] === 'string'
    ? cookies[SESSION_COOKIE_NAME]
    : '';
}

function buildAppUrlWithQuery(_req, params = {}) {
  const url = new URL('http://localhost/');
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
}

function buildGoogleOauthUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'select_account'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleOauthCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    grant_type: 'authorization_code'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || 'OAuth token exchange failed');
  }
  if (typeof data?.access_token !== 'string' || !data.access_token) {
    throw new Error('Missing OAuth access token');
  }
  return data;
}

async function fetchGoogleUserProfile(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await safeParseJson(response);
  if (!response.ok) {
    throw new Error(data?.error || 'OAuth user profile failed');
  }
  return data;
}

function normalizeEmail(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';
}

function normalizeGoogleUserProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  const id = typeof profile.sub === 'string' ? profile.sub.trim().slice(0, 200) : '';
  const email = normalizeEmail(profile.email).slice(0, 320);
  const emailVerified = profile.email_verified === true || profile.email_verified === 'true';
  const name = typeof profile.name === 'string' ? profile.name.trim().slice(0, 160) : '';
  const picture = typeof profile.picture === 'string' ? profile.picture.trim().slice(0, 1000) : '';
  if (!id || !email || !emailVerified) {
    return null;
  }
  return {
    id,
    email,
    emailVerified,
    name,
    picture
  };
}

function isAllowedGoogleUser(user) {
  if (!user || !user.email) {
    return false;
  }
  if (!ALLOWED_GOOGLE_EMAILS.size) {
    return true;
  }
  return ALLOWED_GOOGLE_EMAILS.has(normalizeEmail(user.email));
}

function classifyOauthCallbackError(error) {
  const rawMessage = typeof error?.message === 'string'
    ? error.message
    : 'OAuth callback failed';
  const message = rawMessage.slice(0, 300);
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes('invalid_grant')) {
    return { reason: 'invalid_grant', message };
  }
  if (normalized.includes('redirect_uri')) {
    return { reason: 'redirect_uri_mismatch', message };
  }
  if (normalized.includes('oauth token exchange')) {
    return { reason: 'token_exchange_failed', message };
  }
  if (normalized.includes('oauth user profile')) {
    return { reason: 'profile_fetch_failed', message };
  }
  if (normalized.includes('missing google profile')) {
    return { reason: 'profile_missing', message };
  }
  if (normalized.includes('google account not allowed')) {
    return { reason: 'not_allowed', message };
  }
  if (normalized.includes('sqlite3')) {
    return { reason: 'db_error', message };
  }
  return { reason: 'failed', message };
}

async function requireAuthenticatedUser(dbPath, req, res) {
  let user = null;
  try {
    user = await readSessionUserFromRequest(dbPath, req);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Authentication lookup failed' }));
    return null;
  }
  if (user) {
    return user;
  }
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Authentication required' }));
  return null;
}

async function readSessionUserFromRequest(dbPath, req) {
  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const now = Date.now();
  const sql = `
    SELECT u.id, u.email, u.name, u.picture
    FROM user_sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sqlString(tokenHash)}
      AND s.expires_at > ${now}
    LIMIT 1;
  `;
  const stdout = await runSqlite(dbPath, sql, { json: true });
  const rows = parseSqliteJson(stdout);
  if (!rows.length) {
    return null;
  }
  const row = rows[0] || {};
  const user = {
    id: typeof row.id === 'string' ? row.id : '',
    email: typeof row.email === 'string' ? row.email : '',
    name: typeof row.name === 'string' ? row.name : '',
    picture: typeof row.picture === 'string' ? row.picture : ''
  };
  if (!isAllowedGoogleUser(user)) {
    try {
      await deleteUserSession(dbPath, token);
    } catch (error) {
      // Ignore cleanup failures and treat the session as unauthenticated.
    }
    return null;
  }
  return user;
}

async function upsertUser(dbPath, user) {
  const now = Date.now();
  const sql = `
    INSERT INTO users (id, email, name, picture, created_at, updated_at)
    VALUES (
      ${sqlString(user.id)},
      ${sqlString(user.email || '')},
      ${sqlString(user.name || '')},
      ${sqlString(user.picture || '')},
      ${now},
      ${now}
    )
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      picture = excluded.picture,
      updated_at = excluded.updated_at;
  `;
  await runSqlite(dbPath, sql);
}

async function createUserSession(dbPath, userId, sessionToken, expiresAt) {
  const now = Date.now();
  const sessionHash = hashToken(sessionToken);
  const sql = `
    DELETE FROM user_sessions WHERE expires_at <= ${now};
    INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at)
    VALUES (
      ${sqlString(sessionHash)},
      ${sqlString(userId)},
      ${now},
      ${Math.max(now + 1, Math.trunc(expiresAt))}
    )
    ON CONFLICT(token_hash) DO UPDATE SET
      user_id = excluded.user_id,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at;
  `;
  await runSqlite(dbPath, sql);
}

async function deleteUserSession(dbPath, sessionToken) {
  if (!sessionToken) {
    return;
  }
  const sessionHash = hashToken(sessionToken);
  const sql = `
    DELETE FROM user_sessions
    WHERE token_hash = ${sqlString(sessionHash)};
  `;
  await runSqlite(dbPath, sql);
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

async function requestOpenAiVocabResolution({
  apiKey,
  model,
  text,
  lookupText,
  dictionaryEntries
}) {
  if (!apiKey) {
    return null;
  }

  const input = [
    `Selected text: ${text}`,
    lookupText ? `Lookup target: ${lookupText}` : '',
    `Dictionary candidates:\n${formatDictionaryCandidatesForPrompt(dictionaryEntries, 6)}`
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 180,
        instructions: VOCAB_RESOLUTION_SYSTEM_PROMPT,
        input
      })
    });
    const data = await safeParseJson(response);
    if (!response.ok) {
      debug('OpenAI vocab resolution failed:', response.status, data?.error?.message || '');
      return null;
    }
    return parseVocabResolutionOutput(extractOpenAiText(data), text);
  } catch (error) {
    debug('OpenAI vocab resolution request errored:', error);
    return null;
  }
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

async function ensureWorkspaceDb(dbPath) {
  const sql = `
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      picture TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS user_workspaces (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `;
  await runSqlite(dbPath, sql);
}

function normalizeShareVocabList(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const now = Date.now();
  return items
    .slice(0, 500)
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const word = typeof item.word === 'string' ? item.word.slice(0, 120) : '';
      const reading = typeof item.reading === 'string' ? item.reading.slice(0, 120) : '';
      const meaning = typeof item.meaning === 'string' ? item.meaning.slice(0, 400) : '';
      const addedAt = Number.isFinite(item.addedAt) ? Math.trunc(item.addedAt) : now;
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

function normalizeShareQuestionList(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const now = Date.now();
  return items
    .slice(0, 500)
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const selectedText = typeof item.selectedText === 'string' ? item.selectedText.slice(0, 4000) : '';
      const question = typeof item.question === 'string' ? item.question.slice(0, 2000) : '';
      const answer = typeof item.answer === 'string' ? item.answer.slice(0, 20000) : '';
      const createdAt = Number.isFinite(item.createdAt) ? Math.trunc(item.createdAt) : now;
      if (!selectedText && !question && !answer) {
        return null;
      }
      return {
        selectedText,
        question,
        answer,
        createdAt
      };
    })
    .filter(Boolean);
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeWorkflowRole(role, fallback = '') {
  if (typeof role !== 'string') {
    return fallback;
  }
  const normalized = role.trim();
  if (WORKFLOW_ROLES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeWorkflowStatus(status, fallback = 'draft') {
  if (typeof status !== 'string') {
    return fallback;
  }
  const normalized = status.trim();
  if (WORKFLOW_STATUSES.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeWorkflowAction(action, fallback = '') {
  if (typeof action !== 'string') {
    return fallback;
  }
  const normalized = action.trim();
  if (WORKFLOW_TRANSITION_ACTIONS.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeWorkflowEventAction(action, fallback = '') {
  if (typeof action !== 'string') {
    return fallback;
  }
  const normalized = action.trim();
  if (WORKFLOW_EVENT_ACTIONS.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeWorkflowEvents(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  return entries
    .slice(-80)
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const action = normalizeWorkflowEventAction(entry.action);
      if (!action) {
        return null;
      }
      const createdAt = Number.isFinite(entry.createdAt)
        ? Math.trunc(entry.createdAt)
        : now;
      return {
        id: typeof entry.id === 'string' && entry.id.trim()
          ? entry.id.trim().slice(0, 80)
          : `event_${createdAt}_${index}`,
        action,
        status: normalizeWorkflowStatus(entry.status, 'draft'),
        actorUserId: typeof entry.actorUserId === 'string'
          ? entry.actorUserId.trim().slice(0, 200)
          : '',
        actorEmail: normalizeEmail(entry.actorEmail).slice(0, 320),
        actorName: typeof entry.actorName === 'string'
          ? entry.actorName.trim().slice(0, 160)
          : '',
        actorRole: normalizeWorkflowRole(entry.actorRole, ''),
        createdAt
      };
    })
    .filter(Boolean);
}

function normalizeDocumentWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object') {
    return null;
  }
  const id = typeof workflow.id === 'string'
    ? workflow.id.trim().slice(0, 120)
    : '';
  if (!id) {
    return null;
  }
  const lastTransitionAt = Number.isFinite(workflow.lastTransitionAt)
    ? Math.trunc(workflow.lastTransitionAt)
    : null;
  const version = Number.isFinite(workflow.version)
    ? Math.max(1, Math.trunc(workflow.version))
    : 1;
  return {
    id,
    role: normalizeWorkflowRole(workflow.role, ''),
    status: normalizeWorkflowStatus(workflow.status, 'draft'),
    ownerUserId: typeof workflow.ownerUserId === 'string'
      ? workflow.ownerUserId.trim().slice(0, 200)
      : '',
    ownerEmail: normalizeEmail(workflow.ownerEmail).slice(0, 320),
    ownerName: typeof workflow.ownerName === 'string'
      ? workflow.ownerName.trim().slice(0, 160)
      : '',
    partnerUserId: typeof workflow.partnerUserId === 'string'
      ? workflow.partnerUserId.trim().slice(0, 200)
      : '',
    partnerEmail: normalizeEmail(workflow.partnerEmail).slice(0, 320),
    partnerName: typeof workflow.partnerName === 'string'
      ? workflow.partnerName.trim().slice(0, 160)
      : '',
    lastTransitionAt,
    lastActorUserId: typeof workflow.lastActorUserId === 'string'
      ? workflow.lastActorUserId.trim().slice(0, 200)
      : '',
    lastActorEmail: normalizeEmail(workflow.lastActorEmail).slice(0, 320),
    lastActorName: typeof workflow.lastActorName === 'string'
      ? workflow.lastActorName.trim().slice(0, 160)
      : '',
    lastActorRole: normalizeWorkflowRole(workflow.lastActorRole, ''),
    version,
    events: normalizeWorkflowEvents(workflow.events)
  };
}

function createWorkflowId(leftUserId, rightUserId, sourceDocumentId) {
  const users = [String(leftUserId || ''), String(rightUserId || '')].sort();
  const digest = createHash('sha256')
    .update(`${users[0]}:${users[1]}:${String(sourceDocumentId || '')}`)
    .digest('hex');
  return `workflow_${digest.slice(0, 24)}`;
}

function createWorkflowParticipantDocumentId(workflowId, userId) {
  const digest = createHash('sha256')
    .update(`${String(workflowId || '')}:${String(userId || '')}`)
    .digest('hex');
  return `shared_${digest.slice(0, 24)}`;
}

function createWorkflowEvent({
  action,
  status,
  actor,
  actorRole,
  createdAt
}) {
  const now = Number.isFinite(createdAt) ? Math.trunc(createdAt) : Date.now();
  return {
    id: `event_${randomBytes(6).toString('hex')}`,
    action: normalizeWorkflowEventAction(action),
    status: normalizeWorkflowStatus(status, 'draft'),
    actorUserId: typeof actor?.id === 'string' ? actor.id.slice(0, 200) : '',
    actorEmail: normalizeEmail(actor?.email).slice(0, 320),
    actorName: typeof actor?.name === 'string' ? actor.name.slice(0, 160) : '',
    actorRole: normalizeWorkflowRole(actorRole, ''),
    createdAt: now
  };
}

function appendWorkflowEvent(existingEvents, event) {
  const events = normalizeWorkflowEvents(existingEvents);
  if (!event || !event.action) {
    return events;
  }
  const next = [...events, event];
  return next.slice(-80);
}

function resolveWorkflowStatusForAction(action) {
  if (action === 'submit') {
    return 'submitted';
  }
  if (action === 'return_review') {
    return 'reviewed';
  }
  if (action === 'mark_final') {
    return 'final';
  }
  return 'draft';
}

function createWorkspaceDocumentId() {
  return `doc_${Date.now().toString(36)}_${randomBytes(8).toString('hex')}`;
}

function createWorkspaceAssetId(prefix = 'asset') {
  const safePrefix = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : 'asset';
  return `${safePrefix}_${Date.now().toString(36)}_${randomBytes(8).toString('hex')}`;
}

function normalizeWorkspaceDocumentImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }
  const now = Date.now();
  const seenIds = new Set();
  return images
    .slice(0, MAX_IMAGES_PER_DOCUMENT)
    .map((image) => {
      if (!image || typeof image !== 'object') {
        return null;
      }
      let id = typeof image.id === 'string' ? image.id.trim().slice(0, 160) : '';
      if (!id || seenIds.has(id)) {
        id = createWorkspaceAssetId('img');
      }
      seenIds.add(id);
      const src = typeof image.src === 'string'
        ? image.src.trim()
        : (typeof image.dataUrl === 'string' ? image.dataUrl.trim() : '');
      if (!src.startsWith('data:image/') || src.length > MAX_DOCUMENT_IMAGE_SOURCE_LENGTH) {
        return null;
      }
      const name = typeof image.name === 'string' ? image.name.trim().slice(0, 180) : '';
      const width = Number.isFinite(image.width) ? Math.max(1, Math.trunc(image.width)) : null;
      const height = Number.isFinite(image.height) ? Math.max(1, Math.trunc(image.height)) : null;
      const addedAt = Number.isFinite(image.addedAt) ? Math.trunc(image.addedAt) : now;
      return {
        id,
        name,
        src,
        width,
        height,
        addedAt
      };
    })
    .filter(Boolean);
}

function normalizeWorkspaceDocumentList(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = Date.now();
  const seenIds = new Set();
  return entries
    .slice(0, 300)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      let id = typeof entry.id === 'string' ? entry.id.trim().slice(0, 120) : '';
      if (!id || seenIds.has(id)) {
        id = createWorkspaceDocumentId();
      }
      seenIds.add(id);
      const title = typeof entry.title === 'string' ? entry.title.slice(0, 200) : '';
      const text = typeof entry.text === 'string' ? entry.text.slice(0, 20000) : '';
      const images = normalizeWorkspaceDocumentImages(entry.images);
      const vocab = normalizeShareVocabList(entry.vocab);
      const questions = normalizeShareQuestionList(entry.questions);
      const correctionsBaseText = typeof entry.correctionsBaseText === 'string'
        ? entry.correctionsBaseText.slice(0, 20000)
        : text;
      const proofreadContent = typeof entry.proofreadContent === 'string'
        ? entry.proofreadContent.slice(0, 120000)
        : '';
      const proofreadUpdatedAt = Number.isFinite(entry.proofreadUpdatedAt)
        ? Math.trunc(entry.proofreadUpdatedAt)
        : null;
      const workflow = normalizeDocumentWorkflow(entry.workflow);
      const sharedByUserId = typeof entry.sharedByUserId === 'string'
        ? entry.sharedByUserId.trim().slice(0, 200)
        : '';
      const sharedByEmail = normalizeEmail(entry.sharedByEmail).slice(0, 320);
      const sharedByName = typeof entry.sharedByName === 'string'
        ? entry.sharedByName.trim().slice(0, 160)
        : '';
      const sharedSourceId = typeof entry.sharedSourceId === 'string'
        ? entry.sharedSourceId.trim().slice(0, 120)
        : '';
      const sharedAt = Number.isFinite(entry.sharedAt)
        ? Math.trunc(entry.sharedAt)
        : null;
      const createdAt = Number.isFinite(entry.createdAt) ? Math.trunc(entry.createdAt) : now;
      const updatedAt = Number.isFinite(entry.updatedAt) ? Math.trunc(entry.updatedAt) : createdAt;
      return {
        id,
        title,
        text,
        images,
        vocab,
        questions,
        correctionsBaseText,
        proofreadContent,
        proofreadUpdatedAt,
        workflow,
        sharedByUserId,
        sharedByEmail,
        sharedByName,
        sharedSourceId,
        sharedAt,
        createdAt,
        updatedAt
      };
    })
    .filter(Boolean);
}

function normalizeWorkspacePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const documents = normalizeWorkspaceDocumentList(payload.documents);
  const requestedActiveId = typeof payload.activeDocumentId === 'string'
    ? payload.activeDocumentId.trim()
    : '';
  const activeDocumentId = requestedActiveId && documents.some((doc) => doc.id === requestedActiveId)
    ? requestedActiveId
    : (documents[0]?.id || '');
  const updatedAt = Number.isFinite(payload.updatedAt)
    ? Math.trunc(payload.updatedAt)
    : Date.now();
  return {
    documents,
    activeDocumentId,
    updatedAt
  };
}

function normalizeUserShareRequest(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const recipientEmail = normalizeEmail(body.recipientEmail).slice(0, 320);
  const sourceDocumentId = typeof body.sourceDocumentId === 'string'
    ? body.sourceDocumentId.trim().slice(0, 120)
    : '';
  const documentInput = body.document;
  if (!recipientEmail || !documentInput || typeof documentInput !== 'object') {
    return null;
  }
  const normalizedDocument = normalizeWorkspaceDocumentList([
    {
      ...documentInput,
      id: sourceDocumentId || documentInput.id || createWorkspaceDocumentId()
    }
  ])[0];
  if (!normalizedDocument) {
    return null;
  }
  return {
    recipientEmail,
    sourceDocumentId: sourceDocumentId || normalizedDocument.id,
    document: normalizedDocument
  };
}

function normalizeWorkflowTransitionRequest(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const action = normalizeWorkflowAction(body.action);
  const sourceDocumentId = typeof body.sourceDocumentId === 'string'
    ? body.sourceDocumentId.trim().slice(0, 120)
    : '';
  const documentInput = body.document;
  if (!action || !sourceDocumentId || !documentInput || typeof documentInput !== 'object') {
    return null;
  }
  const normalizedDocument = normalizeWorkspaceDocumentList([
    {
      ...documentInput,
      id: sourceDocumentId
    }
  ])[0];
  if (!normalizedDocument) {
    return null;
  }
  return {
    action,
    sourceDocumentId,
    document: normalizedDocument
  };
}

function createSharedDocumentId(senderUserId, recipientUserId, sourceDocumentId) {
  const digest = createHash('sha256')
    .update(`${senderUserId}:${recipientUserId}:${sourceDocumentId}`)
    .digest('hex');
  return `shared_${digest.slice(0, 24)}`;
}

async function findUserByEmail(dbPath, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }
  const sql = `
    SELECT id, email, name, picture
    FROM users
    WHERE lower(email) = ${sqlString(normalizedEmail)}
    LIMIT 1;
  `;
  const stdout = await runSqlite(dbPath, sql, { json: true });
  const rows = parseSqliteJson(stdout);
  if (!rows.length) {
    return null;
  }
  return {
    id: typeof rows[0]?.id === 'string' ? rows[0].id : '',
    email: typeof rows[0]?.email === 'string' ? rows[0].email : '',
    name: typeof rows[0]?.name === 'string' ? rows[0].name : '',
    picture: typeof rows[0]?.picture === 'string' ? rows[0].picture : ''
  };
}

async function findUserById(dbPath, id) {
  const userId = typeof id === 'string' ? id.trim() : '';
  if (!userId) {
    return null;
  }
  const sql = `
    SELECT id, email, name, picture
    FROM users
    WHERE id = ${sqlString(userId)}
    LIMIT 1;
  `;
  const stdout = await runSqlite(dbPath, sql, { json: true });
  const rows = parseSqliteJson(stdout);
  if (!rows.length) {
    return null;
  }
  return {
    id: typeof rows[0]?.id === 'string' ? rows[0].id : '',
    email: typeof rows[0]?.email === 'string' ? rows[0].email : '',
    name: typeof rows[0]?.name === 'string' ? rows[0].name : '',
    picture: typeof rows[0]?.picture === 'string' ? rows[0].picture : ''
  };
}

async function shareDocumentWithGoogleUser(dbPath, {
  sender,
  recipient,
  sourceDocumentId,
  document
}) {
  const now = Date.now();
  const normalizedDocument = normalizeWorkspaceDocumentList([
    { ...document, id: sourceDocumentId }
  ])[0];
  if (!normalizedDocument) {
    throw createHttpError(400, 'Invalid document payload');
  }

  const incomingWorkflow = normalizeDocumentWorkflow(normalizedDocument.workflow);
  const workflowId = incomingWorkflow?.id || createWorkflowId(sender.id, recipient.id, sourceDocumentId);
  const ownerUserId = incomingWorkflow?.ownerUserId || sender.id;
  const ownerEmail = (incomingWorkflow?.ownerEmail || normalizeEmail(sender.email)).slice(0, 320);
  const ownerName = (incomingWorkflow?.ownerName || (typeof sender.name === 'string' ? sender.name : '')).slice(0, 160);
  const senderRole = ownerUserId === sender.id ? 'student' : 'teacher';
  const recipientRole = senderRole === 'student' ? 'teacher' : 'student';
  const nextStatus = senderRole === 'student'
    ? 'submitted'
    : normalizeWorkflowStatus(incomingWorkflow?.status, 'reviewed');
  const nextVersion = Number.isFinite(incomingWorkflow?.version)
    ? Math.max(1, Math.trunc(incomingWorkflow.version) + 1)
    : 1;
  const workflowEvent = createWorkflowEvent({
    action: incomingWorkflow?.id ? 'share_update' : 'share_start',
    status: nextStatus,
    actor: sender,
    actorRole: senderRole,
    createdAt: now
  });
  const workflowEvents = appendWorkflowEvent(incomingWorkflow?.events, workflowEvent);

  const senderWorkflow = normalizeDocumentWorkflow({
    id: workflowId,
    role: senderRole,
    status: nextStatus,
    ownerUserId,
    ownerEmail,
    ownerName,
    partnerUserId: recipient.id,
    partnerEmail: normalizeEmail(recipient.email).slice(0, 320),
    partnerName: typeof recipient.name === 'string' ? recipient.name.slice(0, 160) : '',
    lastTransitionAt: now,
    lastActorUserId: sender.id,
    lastActorEmail: normalizeEmail(sender.email).slice(0, 320),
    lastActorName: typeof sender.name === 'string' ? sender.name.slice(0, 160) : '',
    lastActorRole: senderRole,
    version: nextVersion,
    events: workflowEvents
  });

  const recipientWorkflow = normalizeDocumentWorkflow({
    ...senderWorkflow,
    role: recipientRole,
    partnerUserId: sender.id,
    partnerEmail: normalizeEmail(sender.email).slice(0, 320),
    partnerName: typeof sender.name === 'string' ? sender.name.slice(0, 160) : ''
  });

  const senderWorkspace = await readUserWorkspace(dbPath, sender.id);
  const senderDocuments = normalizeWorkspaceDocumentList(senderWorkspace?.documents);
  const senderIndex = senderDocuments.findIndex((entry) => entry.id === sourceDocumentId);
  const senderCreatedAt = senderIndex >= 0 && Number.isFinite(senderDocuments[senderIndex]?.createdAt)
    ? Math.trunc(senderDocuments[senderIndex].createdAt)
    : now;
  const senderDocument = {
    ...normalizedDocument,
    id: sourceDocumentId,
    workflow: senderWorkflow,
    sharedSourceId: sourceDocumentId,
    sharedAt: now,
    createdAt: senderCreatedAt,
    updatedAt: now
  };
  if (senderRole === 'student') {
    senderDocument.correctionsBaseText = senderDocument.text;
  }
  if (senderIndex === -1) {
    senderDocuments.unshift(senderDocument);
  } else {
    senderDocuments.splice(senderIndex, 1, senderDocument);
  }

  const senderActiveDocumentId = typeof senderWorkspace?.activeDocumentId === 'string'
    ? senderWorkspace.activeDocumentId
    : '';
  await writeUserWorkspace(dbPath, sender.id, {
    documents: senderDocuments,
    activeDocumentId: senderActiveDocumentId && senderDocuments.some((entry) => entry.id === senderActiveDocumentId)
      ? senderActiveDocumentId
      : sourceDocumentId,
    updatedAt: now
  });

  const recipientWorkspace = await readUserWorkspace(dbPath, recipient.id);
  const recipientDocuments = normalizeWorkspaceDocumentList(recipientWorkspace?.documents);
  const recipientIndex = recipientDocuments.findIndex((entry) => entry.workflow?.id === workflowId);
  const sharedDocumentId = recipientIndex >= 0
    ? recipientDocuments[recipientIndex].id
    : createWorkflowParticipantDocumentId(workflowId, recipient.id);
  const recipientCreatedAt = recipientIndex >= 0 && Number.isFinite(recipientDocuments[recipientIndex]?.createdAt)
    ? Math.trunc(recipientDocuments[recipientIndex].createdAt)
    : now;
  const sharedDocument = {
    ...normalizedDocument,
    id: sharedDocumentId,
    workflow: recipientWorkflow,
    sharedByUserId: sender.id,
    sharedByEmail: normalizeEmail(sender.email).slice(0, 320),
    sharedByName: typeof sender.name === 'string' ? sender.name.slice(0, 160) : '',
    sharedSourceId: sourceDocumentId,
    sharedAt: now,
    createdAt: recipientCreatedAt,
    updatedAt: now
  };
  if (senderRole === 'student') {
    sharedDocument.correctionsBaseText = sharedDocument.text;
  }

  if (recipientIndex === -1) {
    recipientDocuments.unshift(sharedDocument);
  } else {
    recipientDocuments.splice(recipientIndex, 1, sharedDocument);
  }

  const recipientActiveDocumentId = typeof recipientWorkspace?.activeDocumentId === 'string'
    ? recipientWorkspace.activeDocumentId
    : '';
  await writeUserWorkspace(dbPath, recipient.id, {
    documents: recipientDocuments,
    activeDocumentId: recipientActiveDocumentId && recipientDocuments.some((entry) => entry.id === recipientActiveDocumentId)
      ? recipientActiveDocumentId
      : (recipientDocuments[0]?.id || ''),
    updatedAt: now
  });

  return {
    sharedDocumentId,
    workflowId,
    status: nextStatus,
    senderDocument,
    updatedAt: now
  };
}

async function transitionSharedWorkflow(dbPath, {
  actor,
  action,
  sourceDocumentId,
  document
}) {
  const now = Date.now();
  const normalizedAction = normalizeWorkflowAction(action);
  if (!normalizedAction) {
    throw createHttpError(400, 'Invalid workflow action');
  }
  const actorInputDocument = normalizeWorkspaceDocumentList([
    { ...document, id: sourceDocumentId }
  ])[0];
  if (!actorInputDocument) {
    throw createHttpError(400, 'Invalid document payload');
  }

  const actorWorkspace = await readUserWorkspace(dbPath, actor.id);
  const actorDocuments = normalizeWorkspaceDocumentList(actorWorkspace?.documents);
  const actorIndex = actorDocuments.findIndex((entry) => entry.id === sourceDocumentId);
  const existingActorDocument = actorIndex >= 0 ? actorDocuments[actorIndex] : null;
  if (!existingActorDocument) {
    throw createHttpError(404, 'Document not found');
  }

  const actorDocument = {
    ...existingActorDocument,
    ...actorInputDocument,
    id: sourceDocumentId,
    createdAt: actorIndex >= 0 && Number.isFinite(existingActorDocument?.createdAt)
      ? Math.trunc(existingActorDocument.createdAt)
      : now,
    updatedAt: now
  };
  const workflow = normalizeDocumentWorkflow(existingActorDocument?.workflow || actorInputDocument.workflow);
  if (!workflow || !workflow.id) {
    throw createHttpError(400, 'This document is not in a shared workflow');
  }

  const declaredActorRole = normalizeWorkflowRole(workflow.role, '');
  let actorIsOwner = workflow.ownerUserId && workflow.ownerUserId === actor.id;
  let actorIsPartner = workflow.partnerUserId && workflow.partnerUserId === actor.id;
  if (!actorIsOwner && !actorIsPartner && declaredActorRole === 'student') {
    actorIsOwner = true;
  }
  if (!actorIsOwner && !actorIsPartner && declaredActorRole === 'teacher') {
    actorIsPartner = true;
  }
  if (!actorIsOwner && !actorIsPartner && actorInputDocument) {
    const sharedByUserId = actorInputDocument.sharedByUserId || workflow.lastActorUserId || '';
    if (sharedByUserId) {
      if (sharedByUserId === actor.id) {
        actorIsPartner = true;
      } else if (!declaredActorRole) {
        actorIsOwner = true;
      }
    }
  }
  if (!actorIsOwner && !actorIsPartner) {
    throw createHttpError(403, 'You are not part of this workflow');
  }

  const actorRole = actorIsOwner ? 'student' : 'teacher';
  if (actorRole === 'student' && !STUDENT_WORKFLOW_ACTIONS.has(normalizedAction)) {
    throw createHttpError(403, 'Only submit/finalize actions are allowed for students');
  }
  if (actorRole === 'teacher' && !TEACHER_WORKFLOW_ACTIONS.has(normalizedAction)) {
    throw createHttpError(403, 'Only teacher return action is allowed');
  }

  const partnerUserId = actorIsOwner
    ? (workflow.partnerUserId || workflow.lastActorUserId || actorInputDocument?.sharedByUserId || '')
    : (workflow.ownerUserId || actorInputDocument?.sharedByUserId || '');
  if (!partnerUserId) {
    throw createHttpError(400, 'Workflow partner is missing');
  }
  const partner = await findUserById(dbPath, partnerUserId);
  if (!partner) {
    throw createHttpError(404, 'Workflow partner not found');
  }

  const ownerUserId = actorRole === 'student'
    ? actor.id
    : (workflow.ownerUserId || partner.id);
  const ownerEmail = actorRole === 'student'
    ? normalizeEmail(actor.email).slice(0, 320)
    : (workflow.ownerEmail || normalizeEmail(partner.email)).slice(0, 320);
  const ownerName = actorRole === 'student'
    ? (typeof actor.name === 'string' ? actor.name.slice(0, 160) : '')
    : (workflow.ownerName || (typeof partner.name === 'string' ? partner.name.slice(0, 160) : '')).slice(0, 160);
  const nextStatus = resolveWorkflowStatusForAction(normalizedAction);
  const nextVersion = Number.isFinite(workflow.version)
    ? Math.max(1, Math.trunc(workflow.version) + 1)
    : 1;
  const workflowEvent = createWorkflowEvent({
    action: normalizedAction,
    status: nextStatus,
    actor,
    actorRole,
    createdAt: now
  });
  const workflowEvents = appendWorkflowEvent(workflow.events, workflowEvent);

  const actorWorkflow = normalizeDocumentWorkflow({
    id: workflow.id,
    role: actorRole,
    status: nextStatus,
    ownerUserId,
    ownerEmail,
    ownerName,
    partnerUserId: partner.id,
    partnerEmail: normalizeEmail(partner.email).slice(0, 320),
    partnerName: typeof partner.name === 'string' ? partner.name.slice(0, 160) : '',
    lastTransitionAt: now,
    lastActorUserId: actor.id,
    lastActorEmail: normalizeEmail(actor.email).slice(0, 320),
    lastActorName: typeof actor.name === 'string' ? actor.name.slice(0, 160) : '',
    lastActorRole: actorRole,
    version: nextVersion,
    events: workflowEvents
  });

  const partnerRole = actorRole === 'student' ? 'teacher' : 'student';
  const partnerWorkflow = normalizeDocumentWorkflow({
    ...actorWorkflow,
    role: partnerRole,
    partnerUserId: actor.id,
    partnerEmail: normalizeEmail(actor.email).slice(0, 320),
    partnerName: typeof actor.name === 'string' ? actor.name.slice(0, 160) : ''
  });

  actorDocument.workflow = actorWorkflow;
  actorDocument.sharedByUserId = actorRole === 'teacher' ? actor.id : (actorDocument.sharedByUserId || '');
  actorDocument.sharedByEmail = actorRole === 'teacher'
    ? normalizeEmail(actor.email).slice(0, 320)
    : (actorDocument.sharedByEmail || '');
  actorDocument.sharedByName = actorRole === 'teacher'
    ? (typeof actor.name === 'string' ? actor.name.slice(0, 160) : '')
    : (actorDocument.sharedByName || '');
  actorDocument.sharedSourceId = sourceDocumentId;
  actorDocument.sharedAt = now;
  if (actorRole === 'student') {
    actorDocument.correctionsBaseText = actorDocument.text;
  }

  if (actorIndex === -1) {
    actorDocuments.unshift(actorDocument);
  } else {
    actorDocuments.splice(actorIndex, 1, actorDocument);
  }

  const actorActiveDocumentId = typeof actorWorkspace?.activeDocumentId === 'string'
    ? actorWorkspace.activeDocumentId
    : '';
  await writeUserWorkspace(dbPath, actor.id, {
    documents: actorDocuments,
    activeDocumentId: actorActiveDocumentId && actorDocuments.some((entry) => entry.id === actorActiveDocumentId)
      ? actorActiveDocumentId
      : sourceDocumentId,
    updatedAt: now
  });

  const partnerWorkspace = await readUserWorkspace(dbPath, partner.id);
  const partnerDocuments = normalizeWorkspaceDocumentList(partnerWorkspace?.documents);
  const partnerIndex = partnerDocuments.findIndex((entry) => entry.workflow?.id === workflow.id);
  const partnerDocumentId = partnerIndex >= 0
    ? partnerDocuments[partnerIndex].id
    : createWorkflowParticipantDocumentId(workflow.id, partner.id);
  const partnerCreatedAt = partnerIndex >= 0 && Number.isFinite(partnerDocuments[partnerIndex]?.createdAt)
    ? Math.trunc(partnerDocuments[partnerIndex].createdAt)
    : now;
  const partnerDocument = {
    ...actorDocument,
    id: partnerDocumentId,
    workflow: partnerWorkflow,
    sharedByUserId: actor.id,
    sharedByEmail: normalizeEmail(actor.email).slice(0, 320),
    sharedByName: typeof actor.name === 'string' ? actor.name.slice(0, 160) : '',
    sharedSourceId: sourceDocumentId,
    sharedAt: now,
    createdAt: partnerCreatedAt,
    updatedAt: now
  };
  if (actorRole === 'student') {
    partnerDocument.correctionsBaseText = partnerDocument.text;
  }

  if (partnerIndex === -1) {
    partnerDocuments.unshift(partnerDocument);
  } else {
    partnerDocuments.splice(partnerIndex, 1, partnerDocument);
  }

  const partnerActiveDocumentId = typeof partnerWorkspace?.activeDocumentId === 'string'
    ? partnerWorkspace.activeDocumentId
    : '';
  await writeUserWorkspace(dbPath, partner.id, {
    documents: partnerDocuments,
    activeDocumentId: partnerActiveDocumentId && partnerDocuments.some((entry) => entry.id === partnerActiveDocumentId)
      ? partnerActiveDocumentId
      : (partnerDocuments[0]?.id || ''),
    updatedAt: now
  });

  return {
    status: nextStatus,
    updatedAt: now,
    actorDocument
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

async function readUserWorkspace(dbPath, userId) {
  const sql = `
    SELECT payload, updated_at
    FROM user_workspaces
    WHERE user_id = ${sqlString(userId)}
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
  let parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    parsed = null;
  }
  const normalized = normalizeWorkspacePayload(parsed);
  if (!normalized) {
    return null;
  }
  const rowUpdatedAt = Number(rows[0]?.updated_at);
  if (Number.isFinite(rowUpdatedAt)) {
    normalized.updatedAt = Math.trunc(rowUpdatedAt);
  }
  return normalized;
}

async function writeUserWorkspace(dbPath, userId, workspace) {
  const normalized = normalizeWorkspacePayload(workspace);
  if (!normalized) {
    throw new Error('Invalid workspace payload');
  }
  const now = Date.now();
  const updatedAt = Number.isFinite(normalized.updatedAt)
    ? Math.trunc(normalized.updatedAt)
    : now;
  const payload = JSON.stringify({
    ...normalized,
    updatedAt
  });
  const sql = `
    INSERT INTO user_workspaces (user_id, payload, created_at, updated_at)
    VALUES (
      ${sqlString(userId)},
      ${sqlString(payload)},
      ${now},
      ${updatedAt}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  `;
  await runSqlite(dbPath, sql);
  return { updatedAt };
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
const kanjiRegex = /[\u3400-\u9fff]/;

function normalizeKeyword(keyword) {
  return normalizeLookupText(keyword);
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
  if (!entryIds && normalized.length > 1 && !kanjiRegex.test(normalized)) {
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

function collectDictionaryCandidates(queries, limit = 8) {
  const seen = new Set();
  const items = [];

  queries
    .map((query) => normalizeKeyword(query || ''))
    .filter(Boolean)
    .forEach((query) => {
      const entries = lookupLocalDictionary(query);
      entries.forEach((entry) => {
        if (items.length >= limit) {
          return;
        }
        const key = buildDictionaryCandidateKey(entry);
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        items.push(entry);
      });
    });

  return items;
}

function buildDictionaryCandidateKey(entry) {
  const forms = (Array.isArray(entry?.japanese) ? entry.japanese : [])
    .map((form) => `${form?.word || ''}:${form?.reading || ''}`)
    .join('|');
  return `${forms}::${buildDictionaryMeaning(entry)}`;
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
