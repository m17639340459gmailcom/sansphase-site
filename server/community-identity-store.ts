import { closeSync, openSync, chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createTransaction } from './community-db.ts';
import { identityHash, opaqueIdentityValue, validIdentityValue } from './community-identity-protocol.ts';

export type IdentitySourceSession = { kind: 'reader' | 'owner'; id: string; cookie: string };
type StoredSource = { state: string };
const fileOf = (directory: string) => resolve(directory, 'community-identity.db');
const idleMs = 30 * 60_000, absoluteMs = 12 * 60 * 60_000;
function entryStat(path: string) {
  try { return lstatSync(path); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error; }
}
function identityDirectory(directory: string) {
  if (!isAbsolute(directory)) throw Error('Identity data directory must be absolute.');
  const normalized = resolve(directory), root = parse(normalized).root;
  let current = root;
  // Inspect existing parents before mkdir: a new leaf below a linked parent
  // must never initialize or change a different private data directory.
  for (const part of relative(root, normalized).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const entry = entryStat(current);
    if (!entry) break;
    if (entry.isSymbolicLink()) throw Error('Identity storage must not contain symlinks.');
    if (!entry.isDirectory()) throw Error('Identity storage requires a real directory.');
  }
  return normalized;
}
function identityFile(directory: string) {
  const file = fileOf(directory), entry = entryStat(file);
  if (entry?.isSymbolicLink()) throw Error('Identity storage must not contain symlinks.');
  if (entry && !entry.isFile()) throw Error('Identity database must be a regular file.');
  return { file, exists: Boolean(entry) };
}
export function prepareIdentityStore(directory: string) {
  const normalized = identityDirectory(directory);
  const { file, exists } = identityFile(normalized);
  mkdirSync(normalized, { recursive: true, mode: 0o700 });
  if (!exists) closeSync(openSync(file, 'wx', 0o600));
  chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  try {
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version !== 0 && version.user_version !== 1) throw Error('Unsupported identity store schema.');
    if (version.user_version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length) throw Error('Identity preparation requires an empty dedicated database.');
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS identity_tickets(ticket_hash TEXT PRIMARY KEY,binding_hash TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS identity_sessions(session_hash TEXT PRIMARY KEY,state TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS identity_nonces(nonce_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS identity_limits(key_hash TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  } finally { db.close(); }
  return { file, version: 1 };
}
export function createIdentityStore({ directory, stateEncryptionKey }: { directory: string; stateEncryptionKey: string }) {
  if (Buffer.byteLength(stateEncryptionKey || '') < 32) throw Error('An authority-only encryption key is required.');
  const { file, exists } = identityFile(identityDirectory(directory));
  if (!exists) throw Error('Identity store must be explicitly prepared before startup.');
  const db = new DatabaseSync(file);
  try {
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version !== 1) throw Error('Identity store must be explicitly prepared before startup.');
    for (const table of ['identity_tickets', 'identity_sessions', 'identity_nonces', 'identity_limits']) db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL');
  } catch (error) { db.close(); throw error; }
  const key = createHash('sha256').update(stateEncryptionKey).digest(), tx = createTransaction(db);
  function encrypt(source: IdentitySourceSession) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(source), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  function decrypt(state: string): IdentitySourceSession {
    const bytes = Buffer.from(state, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const source: unknown = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    if (!source || typeof source !== 'object' || !('kind' in source) || !['reader', 'owner'].includes(String(source.kind)) || !('id' in source) || typeof source.id !== 'string' || !('cookie' in source) || typeof source.cookie !== 'string') throw Error('Invalid encrypted identity source.');
    return source as IdentitySourceSession;
  }
  const ticketRow = (ticket: string, binding: string, now: number) => validIdentityValue(ticket) && validIdentityValue(binding) ? db.prepare('SELECT state FROM identity_tickets WHERE ticket_hash=? AND binding_hash=? AND expires_at>?').get(identityHash(ticket), identityHash(binding), now) as StoredSource | undefined : undefined;
  return {
    issue(source: IdentitySourceSession, now: number) {
      const ticket = opaqueIdentityValue(), binding = opaqueIdentityValue(), expiresAt = now + 60_000;
      db.prepare('INSERT INTO identity_tickets(ticket_hash,binding_hash,state,expires_at) VALUES(?,?,?,?)').run(identityHash(ticket), identityHash(binding), encrypt(source), expiresAt);
      return { ticket, binding, expiresAt };
    },
    ticket(ticket: string, binding: string, now: number) { const row = ticketRow(ticket, binding, now); return row ? decrypt(row.state) : null; },
    exchange(ticket: string, binding: string, now: number) {
      return tx(() => {
        const row = ticketRow(ticket, binding, now); if (!row) return null;
        const sessionRef = opaqueIdentityValue();
        db.prepare('DELETE FROM identity_tickets WHERE ticket_hash=?').run(identityHash(ticket));
        db.prepare('INSERT INTO identity_sessions(session_hash,state,created_at,last_seen,expires_at) VALUES(?,?,?,?,?)').run(identityHash(sessionRef), row.state, now, now, now + absoluteMs);
        return sessionRef;
      });
    },
    session(sessionRef: string, now: number) {
      if (!validIdentityValue(sessionRef)) return null;
      return tx(() => {
        const row = db.prepare('SELECT state FROM identity_sessions WHERE session_hash=? AND expires_at>? AND last_seen>?').get(identityHash(sessionRef), now, now - idleMs) as StoredSource | undefined;
        if (!row) return null;
        db.prepare('UPDATE identity_sessions SET last_seen=? WHERE session_hash=?').run(now, identityHash(sessionRef));
        return decrypt(row.state);
      });
    },
    consumeNonce(nonce: string, expiresAt: number) { return db.prepare('INSERT OR IGNORE INTO identity_nonces(nonce_hash,expires_at) VALUES(?,?)').run(identityHash(nonce), expiresAt).changes === 1; },
    limit(keyValue: string, count: number, windowMs: number, now: number) {
      return tx(() => {
        const hash = identityHash(keyValue), row = db.prepare('SELECT count,expires_at FROM identity_limits WHERE key_hash=?').get(hash) as { count: number; expires_at: number } | undefined;
        if (!row || row.expires_at <= now) { db.prepare('INSERT INTO identity_limits(key_hash,count,expires_at) VALUES(?,1,?) ON CONFLICT(key_hash) DO UPDATE SET count=1,expires_at=excluded.expires_at').run(hash, now + windowMs); return true; }
        if (row.count >= count) return false;
        db.prepare('UPDATE identity_limits SET count=count+1 WHERE key_hash=?').run(hash); return true;
      });
    },
    prune(now: number) {
      tx(() => {
        for (const table of ['identity_tickets', 'identity_sessions', 'identity_nonces', 'identity_limits']) db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at<=? LIMIT 128)`).run(now);
        db.prepare('DELETE FROM identity_sessions WHERE rowid IN (SELECT rowid FROM identity_sessions WHERE last_seen<=? LIMIT 128)').run(now - idleMs);
      });
    },
    close() { db.close(); key.fill(0); },
  };
}
