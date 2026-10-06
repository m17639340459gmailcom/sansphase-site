import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { migrateCommunity } from './payload/community-migration.ts';
import type { CommunityAuthor } from './community-db.ts';

export const hostSessionIdleMs = 30 * 60_000;
export const hostSessionMaximumMs = 12 * 60 * 60_000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const imageFilename = /^community-(?:image|thumb)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;
export type HostSession = { tokenHash: string; sessionRef: string; kind: 'reader' | 'owner'; id: string; createdAt: number; touchedAt: number };
type SessionRow = { token_hash: string; session_ref: string; subject_kind: 'reader' | 'owner'; subject_id: string; created_at: number; touched_at: number };
type FileRow = { filename: string; reason: string; attempts: number };
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const schema = `
CREATE TABLE IF NOT EXISTS community_host_sessions (
  token_hash TEXT PRIMARY KEY, session_ref TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('reader','owner')), subject_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS community_host_subject ON community_host_sessions(subject_kind,subject_id);
CREATE TABLE IF NOT EXISTS community_host_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS community_host_file_queue (
  filename TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at INTEGER);
CREATE TABLE IF NOT EXISTS community_host_entry_rates (
  address_hash TEXT PRIMARY KEY, bucket_start INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS community_host_deleted_readers (
  reader_id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL);
`;

// Preparation is an explicit maintenance command. Normal startup only opens
// existing databases and refuses to create accounts or migrate silently.
export async function prepareCommunityHostDirectory(directory: string) {
  if (!isAbsolute(directory)) throw Error('Community directory must be absolute.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw Error('Community directory must be a real directory.');
  for (const filename of ['content.db', 'community-host.db', 'uploads']) {
    const path = resolve(directory, filename);
    if (existsSync(path) && (await lstat(path)).isSymbolicLink()) throw Error('Community storage cannot contain symlinks.');
  }
  await mkdir(resolve(directory, 'uploads'), { recursive: true, mode: 0o700 });
  const content = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    if (content.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('readers','authors')").get()) throw Error('Independent community storage must not contain main-site accounts.');
  } finally { content.close(); }
  const migration = await migrateCommunity(directory);
  const host = new DatabaseSync(resolve(directory, 'community-host.db'));
  try { host.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'); host.exec(schema); }
  finally { host.close(); }
  if (process.platform !== 'win32') for (const filename of ['content.db', 'community-host.db']) await chmod(resolve(directory, filename), 0o600);
  return { prepared: true, migration };
}

export function createCommunityHostStore(directory: string) {
  const path = resolve(directory, 'community-host.db');
  if (!existsSync(path)) throw Error('Community host preparation is required.');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000');
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_host_entry_rates'").get()
    || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_host_deleted_readers'").get()) {
    db.close(); throw Error('Community host preparation is required.');
  }
  const oneSession = db.prepare('SELECT * FROM community_host_sessions WHERE token_hash=?');
  const revoke = db.prepare('DELETE FROM community_host_sessions WHERE token_hash=?');
  const deleted = db.prepare('SELECT 1 FROM community_host_deleted_readers WHERE reader_id=?');
  return {
    tokenHash: hashToken,
    createSession(sessionRef: string, subject: CommunityAuthor, now = Date.now()) {
      if (!sessionRef || sessionRef.length > 256 || !['reader', 'owner'].includes(subject.kind) || !subject.id) throw Error('Invalid community host session.');
      if (subject.kind === 'reader' && deleted.get(subject.id)) throw Object.assign(Error('请从主站重新进入社区。'), { status: 401 });
      db.prepare('DELETE FROM community_host_sessions WHERE created_at<=? OR touched_at<=?').run(now - hostSessionMaximumMs, now - hostSessionIdleMs);
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO community_host_sessions VALUES(?,?,?,?,?,?)').run(hashToken(token), sessionRef, subject.kind, subject.id, now, now);
      return token;
    },
    session(token: string, now = Date.now()): HostSession | null {
      if (!tokenPattern.test(token)) return null;
      const row = oneSession.get(hashToken(token)) as SessionRow | undefined;
      if (!row) return null;
      if (row.subject_kind === 'reader' && deleted.get(row.subject_id) || row.created_at > now || row.touched_at > now || now - row.created_at >= hostSessionMaximumMs || now - row.touched_at >= hostSessionIdleMs) {
        revoke.run(row.token_hash); return null;
      }
      return { tokenHash: row.token_hash, sessionRef: row.session_ref, kind: row.subject_kind, id: row.subject_id, createdAt: row.created_at, touchedAt: row.touched_at };
    },
    touchSession(token: string, now = Date.now()) {
      if (tokenPattern.test(token)) db.prepare('UPDATE community_host_sessions SET touched_at=? WHERE token_hash=?').run(now, hashToken(token));
    },
    revokeSession(token: string) { if (tokenPattern.test(token)) revoke.run(hashToken(token)); },
    revokeReader(id: string) { db.prepare("DELETE FROM community_host_sessions WHERE subject_kind='reader' AND subject_id=?").run(id); },
    readerDeleted(id: string) { return Boolean(deleted.get(id)); },
    markReaderDeleted(id: string, now = Date.now()) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT OR IGNORE INTO community_host_deleted_readers VALUES(?,?)').run(id, now);
        db.prepare("DELETE FROM community_host_sessions WHERE subject_kind='reader' AND subject_id=?").run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    consumeNonce(nonce: string, expiresAt: number) {
      const now = Date.now();
      db.prepare('DELETE FROM community_host_nonces WHERE expires_at<?').run(now);
      return Number(db.prepare('INSERT OR IGNORE INTO community_host_nonces VALUES(?,?)').run(nonce, expiresAt).changes) === 1;
    },
    consumeEntry(address: string, now = Date.now()) {
      const key = hashToken(address);
      db.prepare('DELETE FROM community_host_entry_rates WHERE bucket_start<?').run(now - 60_000);
      db.prepare(`INSERT INTO community_host_entry_rates VALUES(?,?,1) ON CONFLICT(address_hash) DO UPDATE SET attempts=attempts+1`).run(key, now);
      const state = db.prepare('SELECT attempts FROM community_host_entry_rates WHERE address_hash=?').get(key) as { attempts: number };
      return state.attempts <= 30;
    },
    queueFile(filename: string, reason: string) {
      if (!imageFilename.test(filename)) throw Error('Unknown cleanup filename; preserving file.');
      db.prepare('INSERT OR IGNORE INTO community_host_file_queue(filename,reason,created_at) VALUES(?,?,?)').run(filename, reason, Date.now());
    },
    fileQueue() { return db.prepare('SELECT filename,reason,attempts FROM community_host_file_queue ORDER BY created_at LIMIT 1000').all() as FileRow[]; },
    retryFile(filename: string) { db.prepare('UPDATE community_host_file_queue SET attempts=attempts+1,last_attempt_at=? WHERE filename=?').run(Date.now(), filename); },
    completeFile(filename: string) { db.prepare('DELETE FROM community_host_file_queue WHERE filename=?').run(filename); },
    imageId(filename: string) { return imageFilename.exec(filename)?.[1] || null; },
    healthCheck() {
      if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw Error('Community host database check failed.');
    },
    close() { db.close(); },
  };
}
export type CommunityHostStore = ReturnType<typeof createCommunityHostStore>;
