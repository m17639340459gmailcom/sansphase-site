import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { readerProfileAdviceSchema, readerProfileRequestSchema, readerProfileWorkflowReady } from './reader-profile-workflow-migration.ts';

type RegistrationInput = { email: string; nickname: string; phone: string; password: string };
type RegistrationRow = { id: string; email: string; nickname: string; phone: string; password_cipher: string; token_hash: string; failed_attempts: number; created_at: string; expires_at: string };
type ExpiredRegistrationRow = { id: string; email: string; createdAt: string; expiresAt: string };
export type ProfileKind = 'avatar' | 'signature' | 'nickname';
export type ProfileAdviceRow = { id: string; profile_id: string; reader_id: string; kind: ProfileKind; decision: 'approve'|'reject'; reason: string; by_kind: 'reader'|'owner'; by_id: string; created_at: string };
type ProfileRow = { id: string; reader_id: string; kind: ProfileKind; proposed_value: string; created_at: string };
type CleanupFileRow = { id: string; filename: string; reason: string; created_at: string; last_error: string | null };
type CleanupAccountRow = { reader_id: string; avatar: string | null; action: string; created_at: string; last_error: string | null };

export const registrationLifetimeMs = 5 * 60 * 1000;
const nowIso = () => new Date().toISOString();
const avatarIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// These short-lived requests are deliberately separate from Payload's readers
// collection: no reader, session, or UID exists until email verification succeeds.
export function createReaderWorkflow(directory: string, secret: string) {
  if (!directory || typeof secret !== 'string' || secret.length < 32) throw Error('Reader workflow requires private storage and the Payload secret.');
  // Private profile proposals and retry jobs have their own durable snapshot;
  // backup excludes the transient registration/authentication tables.
  const dbPath = resolve(directory, 'reader-workflow.db');
  const key = createHash('sha256').update('sansphase-reader-registration-v1\0').update(secret).digest();
  const withDb = <T>(operation: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(dbPath);
    try { db.exec('PRAGMA busy_timeout = 5000'); return operation(db); }
    finally { db.close(); }
  };
  const profileMutation = <T>(operation: (db: DatabaseSync) => T): T => withDb(db => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(db); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  withDb(db => {
    const hadProfiles = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reader_profile_requests'").get());
    db.exec(`
    CREATE TABLE IF NOT EXISTS reader_registration_requests (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL,
      phone TEXT NOT NULL, password_cipher TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reader_registration_expires_idx ON reader_registration_requests(expires_at);
    CREATE TABLE IF NOT EXISTS reader_file_cleanup (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, reason TEXT NOT NULL,
      created_at TEXT NOT NULL, last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS reader_account_cleanup (
      reader_id TEXT PRIMARY KEY, avatar TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL, last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS reader_auth_attempts (
      id INTEGER PRIMARY KEY, attempt_key TEXT NOT NULL, happened_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reader_auth_attempts_key_time_idx ON reader_auth_attempts(attempt_key,happened_at);
  `);
    if (!hadProfiles) db.exec(readerProfileRequestSchema + readerProfileAdviceSchema);
    if (!db.prepare('PRAGMA table_info(reader_registration_requests)').all().some(row => row.name === 'failed_attempts'))
      db.exec('ALTER TABLE reader_registration_requests ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0');
  });
  // Keep the existing column for a compatible workflow upgrade. It now stores
  // an email/request-scoped HMAC, never a six-digit code or an old link token.
  const codeDigest = (email: string, id: string, code: string) => createHmac('sha256', key).update(`email-code-v1\0${email}\0${id}\0${code}`).digest('hex');
  const encrypt = (value: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
  };
  const decrypt = (value: string) => {
    const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  };
  const registration = (row: RegistrationRow | undefined) => row ? ({ id: row.id, email: row.email, nickname: row.nickname, phone: row.phone,
    password: decrypt(row.password_cipher), createdAt: row.created_at, expiresAt: row.expires_at }) : null;
  return {
    putRegistration({ email, nickname, phone, password }: RegistrationInput, now = Date.now()) {
      let code = randomInt(1000000).toString().padStart(6, '0');
      const value = { id: randomUUID(), email, nickname, phone, cipher: encrypt(password),
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + registrationLifetimeMs).toISOString() };
      withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const previous = db.prepare('SELECT id,token_hash FROM reader_registration_requests WHERE email=?').get(email) as Pick<RegistrationRow, 'id' | 'token_hash'> | undefined;
          while (previous && previous.token_hash === codeDigest(email, previous.id, code)) code = randomInt(1000000).toString().padStart(6, '0');
          db.prepare('DELETE FROM reader_registration_requests WHERE email=?').run(email);
          db.prepare(`INSERT INTO reader_registration_requests
            (id,email,nickname,phone,password_cipher,token_hash,created_at,expires_at)
            VALUES (?,?,?,?,?,?,?,?)`).run(value.id, email, nickname, phone, value.cipher, codeDigest(email, value.id, code), value.createdAt, value.expiresAt);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
      return { id: value.id, code, expiresAt: value.expiresAt };
    },
    registrationByCode(email: string, requestId: string, code: string, now = Date.now()) {
      return withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const row = db.prepare('SELECT * FROM reader_registration_requests WHERE email=? AND id=? AND expires_at>? AND failed_attempts<5')
            .get(email, requestId, new Date(now).toISOString()) as RegistrationRow | undefined;
          if (!row) { db.exec('COMMIT'); return null; }
          const supplied = Buffer.from(codeDigest(email, row.id, code), 'hex'), stored = Buffer.from(row.token_hash, 'hex');
          if (!/^\d{6}$/.test(code) || stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
            db.prepare('UPDATE reader_registration_requests SET failed_attempts=failed_attempts+1 WHERE id=?').run(row.id);
            db.exec('COMMIT'); return null;
          }
          const pending = registration(row);
          db.exec('COMMIT'); return pending;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
    },
    registrationByEmail(email: string, now = Date.now()) {
      return withDb(db => registration(db.prepare('SELECT * FROM reader_registration_requests WHERE email=? AND expires_at>?')
        .get(email, new Date(now).toISOString()) as RegistrationRow | undefined));
    },
    consumeAuthLimits(limits: ReadonlyArray<{ key: string; limit: number; windowMs: number }>, now = Date.now()) {
      return withDb(db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM reader_auth_attempts WHERE happened_at<=?').run(now - 86400000);
          const keys = limits.map(rule => ({ ...rule, digest: createHmac('sha256', key).update(`auth-rate-v1\0${rule.key}`).digest('hex') }));
          for (const rule of keys) {
            const count = Number(db.prepare('SELECT COUNT(*) AS n FROM reader_auth_attempts WHERE attempt_key=? AND happened_at>?').get(rule.digest, now - rule.windowMs)?.n);
            if (count >= rule.limit) { db.exec('COMMIT'); return false; }
          }
          for (const rule of keys) db.prepare('INSERT INTO reader_auth_attempts(attempt_key,happened_at) VALUES (?,?)').run(rule.digest, now);
          db.exec('COMMIT'); return true;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
    },
    removeRegistration(id: string) { return withDb(db => db.prepare('DELETE FROM reader_registration_requests WHERE id=?').run(id).changes === 1); },
    expiredRegistrations(now = Date.now(), limit = 100): ExpiredRegistrationRow[] {
      return withDb(db => db.prepare('SELECT id,email,created_at AS createdAt,expires_at AS expiresAt FROM reader_registration_requests WHERE expires_at<=? ORDER BY expires_at LIMIT ?')
        .all(new Date(now).toISOString(), Math.min(1000, Math.max(1, limit))) as ExpiredRegistrationRow[]);
    },
    cleanupRegistrations(now = Date.now(), limit = 1000) {
      const expired = this.expiredRegistrations(now, limit);
      return expired.map(row => ({ ...row, deleted: this.removeRegistration(row.id) }));
    },
    putProfile(readerId: string, kind: ProfileKind, proposedValue: string) {
      if (!['avatar', 'signature', 'nickname'].includes(kind)) throw Error('Invalid profile review kind');
      if (kind === 'avatar' && !avatarIdPattern.test(proposedValue)) throw Error('Invalid pending avatar');
      return profileMutation(db => {
        if (kind === 'nickname' && !readerProfileWorkflowReady(db)) throw Object.assign(Error('资料审核尚未迁移，请联系站长。'), { status: 503 });
        const previous = db.prepare('SELECT * FROM reader_profile_requests WHERE reader_id=? AND kind=?').get(readerId, kind) as ProfileRow | undefined;
        const id = randomUUID();
        db.prepare(`INSERT INTO reader_profile_requests (id,reader_id,kind,proposed_value,created_at) VALUES (?,?,?,?,?)
          ON CONFLICT(reader_id,kind) DO UPDATE SET id=excluded.id,proposed_value=excluded.proposed_value,created_at=excluded.created_at`)
          .run(id, readerId, kind, proposedValue, nowIso());
        if (previous && readerProfileWorkflowReady(db)) db.prepare('DELETE FROM reader_profile_advice WHERE profile_id=?').run(previous.id);
        return { id, previous };
      });
    },
    profile(id: string) { return withDb(db => (db.prepare('SELECT * FROM reader_profile_requests WHERE id=?').get(id) as ProfileRow | undefined) || null); },
    profileFor(readerId: string, kind: ProfileKind) { return withDb(db => (db.prepare('SELECT * FROM reader_profile_requests WHERE reader_id=? AND kind=?').get(readerId, kind) as ProfileRow | undefined) || null); },
    profileByAvatar(avatarId: string) { return withDb(db => (db.prepare("SELECT id FROM reader_profile_requests WHERE kind='avatar' AND proposed_value=? LIMIT 1").get(avatarId) as Pick<ProfileRow, 'id'> | undefined) || null); },
    profiles(limit = 100) { return withDb(db => db.prepare('SELECT * FROM reader_profile_requests ORDER BY created_at LIMIT ?').all(Math.min(1000, Math.max(1, limit))) as ProfileRow[]); },
    profileAdvice(id: string): ProfileAdviceRow[] { return withDb(db => readerProfileWorkflowReady(db)
      ? db.prepare('SELECT * FROM reader_profile_advice WHERE profile_id=? ORDER BY created_at,id').all(id) as ProfileAdviceRow[] : []); },
    putProfileAdvice(id: string, decision: 'approve'|'reject', reason: string, actor: {kind:'reader'|'owner';id:string}) {
      return profileMutation(db => {
        if (!readerProfileWorkflowReady(db)) throw Object.assign(Error('资料审核尚未迁移，请联系站长。'), { status: 503 });
        const proposal = db.prepare('SELECT * FROM reader_profile_requests WHERE id=?').get(id) as ProfileRow | undefined;
        if (!proposal) throw Object.assign(Error('申请已被更新或处理。'), { status: 404 });
        const adviceId = randomUUID(), createdAt = nowIso();
        db.prepare(`INSERT INTO reader_profile_advice(id,profile_id,reader_id,kind,decision,reason,by_kind,by_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(profile_id,by_kind,by_id) DO UPDATE SET id=excluded.id,decision=excluded.decision,reason=excluded.reason,created_at=excluded.created_at`)
          .run(adviceId, id, proposal.reader_id, proposal.kind, decision, reason, actor.kind, actor.id, createdAt);
        return { id: adviceId, decision, reason, by: actor, createdAt };
      });
    },
    removeProfile(id: string) { return profileMutation(db => {
      if (readerProfileWorkflowReady(db)) db.prepare('DELETE FROM reader_profile_advice WHERE profile_id=?').run(id);
      return db.prepare('DELETE FROM reader_profile_requests WHERE id=?').run(id).changes === 1;
    }); },
    removeProfilesFor(readerId: string) { return withDb(db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const rows = db.prepare('SELECT * FROM reader_profile_requests WHERE reader_id=?').all(readerId) as ProfileRow[];
        for (const row of rows) if (row.kind === 'avatar' && avatarIdPattern.test(row.proposed_value)) {
          db.prepare(`INSERT INTO reader_file_cleanup (id,filename,reason,created_at) VALUES (?,?,?,?)
            ON CONFLICT(filename) DO NOTHING`).run(randomUUID(), `pending-reader-avatar-${row.proposed_value}.webp`, 'reader-deleted', nowIso());
        }
        db.prepare('DELETE FROM reader_profile_requests WHERE reader_id=?').run(readerId);
        if (readerProfileWorkflowReady(db)) db.prepare("DELETE FROM reader_profile_advice WHERE reader_id=? OR (by_kind='reader' AND by_id=?)").run(readerId, readerId);
        db.exec('COMMIT'); return rows;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }); },
    queueFile(filename: string, reason: string) {
      if (!/^(?:reader-avatar|pending-reader-avatar|community-image|community-thumb)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(filename)) throw Error('Invalid reader cleanup filename');
      withDb(db => db.prepare(`INSERT INTO reader_file_cleanup (id,filename,reason,created_at) VALUES (?,?,?,?)
        ON CONFLICT(filename) DO NOTHING`).run(randomUUID(), filename, reason, nowIso()));
    },
    cleanupFiles(limit = 100) { return withDb(db => db.prepare('SELECT * FROM reader_file_cleanup ORDER BY created_at LIMIT ?').all(Math.min(1000, Math.max(1, limit))) as CleanupFileRow[]); },
    fileCleaned(id: string) { withDb(db => db.prepare('DELETE FROM reader_file_cleanup WHERE id=?').run(id)); },
    fileFailed(id: string, error: unknown) { withDb(db => db.prepare('UPDATE reader_file_cleanup SET last_error=? WHERE id=?').run(String(error).slice(0, 300), id)); },
    queueAccount(readerId: string, avatar: string | null, action: string) {
      withDb(db => db.prepare(`INSERT INTO reader_account_cleanup (reader_id,avatar,action,created_at) VALUES (?,?,?,?)
        ON CONFLICT(reader_id) DO NOTHING`).run(readerId, avatar, action, nowIso()));
    },
    cleanupAccounts(limit = 100) {
      return withDb(db => db.prepare('SELECT * FROM reader_account_cleanup ORDER BY created_at LIMIT ?').all(Math.min(1000, Math.max(1, limit))) as CleanupAccountRow[]);
    },
    accountCleaned(readerId: string) { withDb(db => db.prepare('DELETE FROM reader_account_cleanup WHERE reader_id=?').run(readerId)); },
    accountFailed(readerId: string, error: unknown) { withDb(db => db.prepare('UPDATE reader_account_cleanup SET last_error=? WHERE reader_id=?').run(String(error).slice(0, 300), readerId)); },
  };
}
