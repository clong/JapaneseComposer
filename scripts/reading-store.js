import { ReadingError, readingId, validateSession } from '../src/reading-model.js';
import { ALOUD_REFERENCE_SQL } from './read-aloud-service.js';

export const READING_TABLE_SQL = `${ALOUD_REFERENCE_SQL}
  CREATE TABLE IF NOT EXISTS reading_sessions (
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, session_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );`;

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
function record(row) {
  return row ? { id: row.session_id, revision: row.revision, deleted: Boolean(row.deleted), session: row.deleted ? null : validateSession(JSON.parse(row.payload)) } : null;
}

export function createReadingStore({ dbPath, runSqlite }) {
  async function rows(sql) { return JSON.parse((await runSqlite(dbPath, sql, { json: true })) || '[]'); }
  async function get(userId, id) {
    return record((await rows(`SELECT * FROM reading_sessions WHERE user_id=${sqlString(userId)} AND session_id=${sqlString(readingId(id))};`))[0]);
  }
  return {
    get,
    async list(userId) {
      return (await rows(`SELECT * FROM reading_sessions WHERE user_id=${sqlString(userId)} ORDER BY updated_at DESC;`)).map(record);
    },
    async write(userId, id, session, expectedRevision, deleted = false) {
      readingId(id);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ReadingError('Missing session revision.');
      const normalized = deleted ? null : validateSession(session);
      if (normalized && normalized.id !== id) throw new ReadingError('Session IDs do not match.');
      const owner = sqlString(userId);
      const key = sqlString(id);
      const payload = sqlString(normalized ? JSON.stringify(normalized) : '{}');
      const mutation = expectedRevision === 0
        ? `INSERT INTO reading_sessions (user_id,session_id,payload,revision,deleted,updated_at)
           VALUES (${owner},${key},${payload},1,${deleted ? 1 : 0},${Date.now()}) ON CONFLICT DO NOTHING;`
        : `UPDATE reading_sessions SET payload=${payload},revision=revision+1,deleted=${deleted ? 1 : 0},updated_at=${Date.now()}
           WHERE user_id=${owner} AND session_id=${key} AND revision=${expectedRevision} AND deleted=0;`;
      // The revision check and mutation are atomic, including across server processes.
      const result = await rows(`BEGIN IMMEDIATE; ${mutation} SELECT changes() AS changed; COMMIT;`);
      if (!result[0]?.changed) {
        const error = new ReadingError('This session changed on another device.', 409);
        error.current = await get(userId, id);
        throw error;
      }
      return { id, session: normalized, deleted, revision: expectedRevision + 1 };
    }
  };
}
