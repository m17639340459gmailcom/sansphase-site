import { randomUUID } from 'node:crypto';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

export const readerProfileRequestSchema = `CREATE TABLE IF NOT EXISTS reader_profile_requests (
  id TEXT PRIMARY KEY, reader_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('avatar','signature','nickname')),
  proposed_value TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(reader_id,kind)
); CREATE INDEX IF NOT EXISTS reader_profile_created_idx ON reader_profile_requests(created_at);`;
export const readerProfileAdviceSchema = `CREATE TABLE IF NOT EXISTS reader_profile_advice (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, reader_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('avatar','signature','nickname')),
  decision TEXT NOT NULL CHECK(decision IN ('approve','reject')), reason TEXT NOT NULL,
  by_kind TEXT NOT NULL CHECK(by_kind IN ('reader','owner')), by_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(profile_id,by_kind,by_id)
); CREATE INDEX IF NOT EXISTS reader_profile_advice_profile_idx ON reader_profile_advice(profile_id);`;
const legacyCheck = /CHECK\s*\(\s*kind\s+IN\s*\(\s*'avatar'\s*,\s*'signature'\s*\)\s*\)/i;
export function readerProfileWorkflowReady(db: DatabaseSync) {
  const schema = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reader_profile_requests'").get() as { sql: string } | undefined)?.sql || '';
  const columns = new Set((db.prepare('PRAGMA table_info(reader_profile_advice)').all() as Array<{ name: string }>).map(row => row.name));
  return /CHECK\s*\(\s*kind\s+IN\s*\(\s*'avatar'\s*,\s*'signature'\s*,\s*'nickname'\s*\)\s*\)/i.test(schema)
    && ['id','profile_id','reader_id','kind','decision','reason','by_kind','by_id','created_at'].every(name => columns.has(name));
}

/** Explicit maintenance command. Startup never rebuilds an existing workflow. */
export async function migrateReaderProfileWorkflow(directory: string) {
  const path = resolve(directory, 'reader-workflow.db'); await stat(path);
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (readerProfileWorkflowReady(db)) return { changed: false };
    const source = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reader_profile_requests'").get() as { sql: string } | undefined;
    if (source && !legacyCheck.test(source.sql) && !source.sql.includes("'nickname'")) throw Error('Unknown profile workflow schema; preserving it unchanged.');
    const root = resolve(directory, 'schema-backups'); await mkdir(root, { recursive: true, mode: 0o700 });
    const snapshot = resolve(root, `before-reader-profile-${Date.now()}-${randomUUID()}.db`); await backup(db, snapshot);
    if (process.platform !== 'win32') await chmod(snapshot, 0o600);
    // SQLite's documented table rebuild sequence keeps dependent rows intact.
    // Leaving FK enforcement on would run ON DELETE CASCADE while dropping the
    // replaced table, even though the replacement retains the same primary keys.
    const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys);
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!source) db.exec(readerProfileRequestSchema);
      else if (legacyCheck.test(source.sql)) {
        const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='reader_profile_requests' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
        const sql = source.sql.replace(/CREATE TABLE\s+["`\[]?reader_profile_requests["`\]]?/i, 'CREATE TABLE reader_profile_requests_upgrade')
          .replace(legacyCheck, "CHECK(kind IN ('avatar','signature','nickname'))");
        if (sql === source.sql || !sql.includes('reader_profile_requests_upgrade')) throw Error('Profile workflow cannot be upgraded safely.');
        const names = (db.prepare('PRAGMA table_info(reader_profile_requests)').all() as Array<{ name: string }>).map(row => `"${row.name.replaceAll('"','""')}"`).join(',');
        db.exec(sql); db.exec(`INSERT INTO reader_profile_requests_upgrade(${names}) SELECT ${names} FROM reader_profile_requests;
          DROP TABLE reader_profile_requests; ALTER TABLE reader_profile_requests_upgrade RENAME TO reader_profile_requests;`);
        for (const object of objects) db.exec(object.sql);
      }
      db.exec(readerProfileAdviceSchema);
      if (!readerProfileWorkflowReady(db) || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Profile workflow migration validation failed.');
      db.exec('COMMIT'); return { changed: true, snapshot };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.exec(`PRAGMA foreign_keys=${foreignKeys ? 'ON' : 'OFF'}`); }
  } finally { db.close(); }
}
