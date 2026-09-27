import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

export const registrationLifetimeMs = 5 * 60 * 1000;
const tokenDigest = token => createHash('sha256').update(token).digest('hex');
const nowIso = () => new Date().toISOString();
const avatarIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// These short-lived requests are deliberately separate from Payload's readers
// collection: no reader, session, or UID exists until email verification succeeds.
export function createReaderWorkflow(directory, secret) {
  if (!directory || typeof secret !== 'string' || secret.length < 32) throw Error('Reader workflow requires private storage and the Payload secret.');
  // Temporary requests and cleanup jobs stay outside the durable content
  // snapshot, so a backup cannot resurrect an expired registration.
  const dbPath = resolve(directory, 'reader-workflow.db');
  const key = createHash('sha256').update('sansphase-reader-registration-v1\0').update(secret).digest();
  const withDb = operation => {
    const db = new DatabaseSync(dbPath);
    try { db.exec('PRAGMA busy_timeout = 5000'); return operation(db); }
    finally { db.close(); }
  };
  withDb(db => db.exec(`
    CREATE TABLE IF NOT EXISTS reader_registration_requests (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL,
      phone TEXT NOT NULL, password_cipher TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reader_registration_expires_idx ON reader_registration_requests(expires_at);
    CREATE TABLE IF NOT EXISTS reader_profile_requests (
      id TEXT PRIMARY KEY, reader_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('avatar','signature')),
      proposed_value TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(reader_id, kind)
    );
    CREATE INDEX IF NOT EXISTS reader_profile_created_idx ON reader_profile_requests(created_at);
    CREATE TABLE IF NOT EXISTS reader_file_cleanup (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, reason TEXT NOT NULL,
      created_at TEXT NOT NULL, last_error TEXT
    );
  `));
  const encrypt = value => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
  };
  const decrypt = value => {
    const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  };
  const registration = row => row ? ({ id: row.id, email: row.email, nickname: row.nickname, phone: row.phone,
    password: decrypt(row.password_cipher), createdAt: row.created_at, expiresAt: row.expires_at }) : null;
  return {
    putRegistration({ email, nickname, phone, password }, now = Date.now()) {
      const token = randomBytes(32).toString('base64url');
      const value = { id: randomUUID(), email, nickname, phone, cipher: encrypt(password), digest: tokenDigest(token),
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + registrationLifetimeMs).toISOString() };
      withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM reader_registration_requests WHERE email=?').run(email);
          db.prepare(`INSERT INTO reader_registration_requests
            (id,email,nickname,phone,password_cipher,token_hash,created_at,expires_at)
            VALUES (?,?,?,?,?,?,?,?)`).run(value.id, email, nickname, phone, value.cipher, value.digest, value.createdAt, value.expiresAt);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
      return { id: value.id, token, expiresAt: value.expiresAt };
    },
    registrationByToken(token, now = Date.now()) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 256) return null;
      return withDb(db => registration(db.prepare('SELECT * FROM reader_registration_requests WHERE token_hash=? AND expires_at>?')
        .get(tokenDigest(token), new Date(now).toISOString())));
    },
    registrationByEmail(email, now = Date.now()) {
      return withDb(db => registration(db.prepare('SELECT * FROM reader_registration_requests WHERE email=? AND expires_at>?')
        .get(email, new Date(now).toISOString())));
    },
    removeRegistration(id) { return withDb(db => db.prepare('DELETE FROM reader_registration_requests WHERE id=?').run(id).changes === 1); },
    expiredRegistrations(now = Date.now(), limit = 100) {
      return withDb(db => db.prepare('SELECT id,email,created_at AS createdAt,expires_at AS expiresAt FROM reader_registration_requests WHERE expires_at<=? ORDER BY expires_at LIMIT ?')
        .all(new Date(now).toISOString(), Math.min(1000, Math.max(1, limit))));
    },
    cleanupRegistrations(now = Date.now(), limit = 1000) {
      const expired = this.expiredRegistrations(now, limit);
      return expired.map(row => ({ ...row, deleted: this.removeRegistration(row.id) }));
    },
    putProfile(readerId, kind, proposedValue) {
      if (!['avatar', 'signature'].includes(kind)) throw Error('Invalid profile review kind');
      if (kind === 'avatar' && !avatarIdPattern.test(proposedValue)) throw Error('Invalid pending avatar');
      return withDb(db => {
        const previous = db.prepare('SELECT * FROM reader_profile_requests WHERE reader_id=? AND kind=?').get(readerId, kind);
        const id = randomUUID();
        db.prepare(`INSERT INTO reader_profile_requests (id,reader_id,kind,proposed_value,created_at) VALUES (?,?,?,?,?)
          ON CONFLICT(reader_id,kind) DO UPDATE SET id=excluded.id,proposed_value=excluded.proposed_value,created_at=excluded.created_at`)
          .run(id, readerId, kind, proposedValue, nowIso());
        return { id, previous };
      });
    },
    profile(id) { return withDb(db => db.prepare('SELECT * FROM reader_profile_requests WHERE id=?').get(id) || null); },
    profileFor(readerId, kind) { return withDb(db => db.prepare('SELECT * FROM reader_profile_requests WHERE reader_id=? AND kind=?').get(readerId, kind) || null); },
    profileByAvatar(avatarId) { return withDb(db => db.prepare("SELECT id FROM reader_profile_requests WHERE kind='avatar' AND proposed_value=? LIMIT 1").get(avatarId) || null); },
    profiles(limit = 100) { return withDb(db => db.prepare('SELECT * FROM reader_profile_requests ORDER BY created_at LIMIT ?').all(Math.min(1000, Math.max(1, limit)))); },
    removeProfile(id) { return withDb(db => db.prepare('DELETE FROM reader_profile_requests WHERE id=?').run(id).changes === 1); },
    removeProfilesFor(readerId) { return withDb(db => {
      const rows = db.prepare('SELECT * FROM reader_profile_requests WHERE reader_id=?').all(readerId);
      db.prepare('DELETE FROM reader_profile_requests WHERE reader_id=?').run(readerId);
      return rows;
    }); },
    queueFile(filename, reason) {
      if (!/^(?:reader-avatar|pending-reader-avatar)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(filename)) throw Error('Invalid reader cleanup filename');
      withDb(db => db.prepare(`INSERT INTO reader_file_cleanup (id,filename,reason,created_at) VALUES (?,?,?,?)
        ON CONFLICT(filename) DO NOTHING`).run(randomUUID(), filename, reason, nowIso()));
    },
    cleanupFiles(limit = 100) { return withDb(db => db.prepare('SELECT * FROM reader_file_cleanup ORDER BY created_at LIMIT ?').all(Math.min(1000, Math.max(1, limit)))); },
    fileCleaned(id) { withDb(db => db.prepare('DELETE FROM reader_file_cleanup WHERE id=?').run(id)); },
    fileFailed(id, error) { withDb(db => db.prepare('UPDATE reader_file_cleanup SET last_error=? WHERE id=?').run(String(error).slice(0, 300), id)); },
  };
}
