import { validateSession } from './reading-model.js';

export const newReadingId = () => globalThis.crypto?.randomUUID?.() || `reading-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function requestReading(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`/api/reading/${path}`, {
    method, credentials: 'include', cache: 'no-store', signal: signal || AbortSignal.timeout(75000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Reading request failed. Please retry.');
    error.status = response.status;
    error.current = data.current;
    throw error;
  }
  return data;
}

export class ReadingSync {
  constructor({ storage = localStorage, request = requestReading, onChange = () => {}, uuid = newReadingId } = {}) {
    Object.assign(this, { storage, request, onChange, uuid });
    this.owner = null;
    this.epoch = 0;
    this.entries = {};
    this.error = '';
    this.storageFailed = false;
    this.activeId = '';
  }
  get key() { return `jc_reading_sessions:${this.owner}`; }
  get sessions() { return Object.values(this.entries).filter((record) => !record.deleted && record.session).map((record) => record.session).sort((a, b) => b.updatedAt - a.updatedAt); }
  get status() {
    if (this.storageFailed || this.error) return 'error';
    if (this.owner === 'guest') return 'local';
    if (this.busy || Object.values(this.entries).some((record) => record.dirty)) return 'saving';
    return 'saved';
  }
  setOwner(owner) {
    if (this.owner === owner) return;
    clearTimeout(this.timer);
    this.owner = owner;
    this.epoch += 1;
    this.busy = false;
    this.refreshing = false;
    this.error = '';
    this.storageFailed = false;
    this.entries = {};
    this.activeId = '';
    if (owner) {
      try {
        const saved = JSON.parse(this.storage.getItem(this.key) || '{}');
        for (const [id, record] of Object.entries(saved.entries || {})) {
          try {
            if (record.deleted) this.entries[id] = { ...record, session: null };
            else {
              const session = validateSession(record.session);
              if (session.id === id) this.entries[id] = { ...record, session };
            }
          } catch { /* A corrupt entry must not hide the remaining saved sessions. */ }
        }
        this.activeId = typeof saved.activeId === 'string' ? saved.activeId : '';
      } catch { this.storageFailed = true; }
    }
    this.onChange('owner');
    if (owner && owner !== 'guest') void this.refresh();
  }
  persist() {
    if (!this.owner) return;
    try {
      this.storage.setItem(this.key, JSON.stringify({ entries: this.entries, activeId: this.activeId }));
      this.storageFailed = false;
    } catch { this.storageFailed = true; }
  }
  activate(id) { this.activeId = id; this.persist(); }
  save(session) {
    if (!this.owner) return;
    const previous = this.entries[session.id];
    this.entries[session.id] = { session: validateSession(session), id: session.id, revision: previous?.revision || 0, deleted: false, dirty: true, change: (previous?.change || 0) + 1 };
    this.persist();
    this.onChange('save');
    this.schedule();
  }
  remove(id) {
    const record = this.entries[id];
    if (!record) return;
    this.entries[id] = { ...record, session: null, deleted: true, dirty: true, change: (record.change || 0) + 1 };
    if (this.activeId === id) this.activeId = '';
    this.persist();
    this.onChange('remove');
    this.schedule();
  }
  schedule(delay = 1200) {
    if (!this.owner || this.owner === 'guest') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  }
  async flush() {
    if (this.busy || !this.owner || this.owner === 'guest') return;
    const epoch = this.epoch;
    this.busy = true;
    this.error = '';
    this.onChange('status');
    try {
      for (const snapshot of Object.values(this.entries).filter((record) => record.dirty)) {
        if (epoch !== this.epoch) return;
        try {
          const result = await this.request(`sessions/${encodeURIComponent(snapshot.id)}`, {
            method: snapshot.deleted ? 'DELETE' : 'PUT',
            body: { session: snapshot.session, expectedRevision: snapshot.revision }
          });
          if (epoch !== this.epoch) return;
          const current = this.entries[snapshot.id];
          if (current) {
            current.revision = result.revision;
            current.dirty = current.change !== snapshot.change;
          }
        } catch (error) {
          if (epoch !== this.epoch) return;
          if (error.status !== 409) throw error;
          const current = this.entries[snapshot.id];
          if (current && !current.deleted && current.session) {
            const session = { ...current.session, id: this.uuid(), recovered: true, updatedAt: Date.now() };
            this.entries[session.id] = { id: session.id, session, revision: 0, deleted: false, dirty: true, change: 1 };
            if (this.activeId === snapshot.id) this.activeId = session.id;
          }
          if (error.current) this.entries[snapshot.id] = { ...error.current, dirty: false, change: 0 };
          else delete this.entries[snapshot.id];
          this.onChange('conflict');
        }
        this.persist();
      }
    } catch (error) {
      if (epoch === this.epoch) this.error = error.message;
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.persist();
        this.onChange('status');
        if (Object.values(this.entries).some((record) => record.dirty)) this.schedule(this.error ? 15000 : 1200);
      }
    }
  }
  async refresh() {
    if (this.refreshing || !this.owner || this.owner === 'guest') return;
    const epoch = this.epoch;
    this.refreshing = true;
    try {
      await this.flush();
      if (epoch !== this.epoch) return;
      const data = await this.request('sessions');
      if (epoch !== this.epoch) return;
      let changed = false;
      for (const remote of data.records || []) {
        const current = this.entries[remote.id];
        if (current?.dirty) continue;
        if (!current || remote.revision > current.revision) {
          const session = remote.deleted ? null : validateSession(remote.session);
          this.entries[remote.id] = { ...remote, session, dirty: false, change: 0 };
          changed = true;
        }
      }
      if (changed) { this.persist(); this.onChange('remote'); }
    } catch (error) {
      if (epoch === this.epoch) { this.error = error.message; this.onChange('status'); }
    } finally { if (epoch === this.epoch) this.refreshing = false; }
  }
  dispose() { clearTimeout(this.timer); this.epoch += 1; }
}
