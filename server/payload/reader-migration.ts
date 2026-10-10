import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readerUidsTableSql, readerUidsTriggerSql } from '../reader-uids.ts';

const required = ['authors', 'authors_sessions', 'site_profile', 'library_entries', '_library_entries_v', 'payload_locked_documents_rels', 'payload_preferences_rels'];
const column = (db:DatabaseSync, table:string, name:string) => db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === name);
const table = (db:DatabaseSync, name:string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const trigger = (db:DatabaseSync, name:string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name));
const missingUid = (db:DatabaseSync) => !table(db, 'reader_uids') || Boolean(db.prepare('SELECT 1 FROM readers r WHERE NOT EXISTS (SELECT 1 FROM reader_uids u WHERE u.reader_id=r.id) LIMIT 1').get());
const ensureUids = (db:DatabaseSync) => {
  if (!table(db, 'reader_uids')) db.exec(readerUidsTableSql);
  db.exec('INSERT INTO reader_uids (reader_id) SELECT r.id FROM readers r WHERE NOT EXISTS (SELECT 1 FROM reader_uids u WHERE u.reader_id=r.id) ORDER BY r.created_at, r.id');
  if (!trigger(db, 'reader_uids_on_insert')) db.exec(readerUidsTriggerSql);
};
export const loginEventsSchema = `CREATE TABLE login_events (
  id text PRIMARY KEY NOT NULL,
  happened_at text NOT NULL,
  actor_type text NOT NULL CHECK(actor_type IN ('reader', 'owner')),
  actor_id text NOT NULL,
  email text NOT NULL,
  ip text NOT NULL,
  peer_ip text NOT NULL,
  source text NOT NULL,
  user_agent text NOT NULL
);
CREATE INDEX login_events_actor_time_idx ON login_events(actor_type, actor_id, happened_at DESC);`;

export async function migrateReaderAccounts(directory:string) {
  const root = resolve(directory);
  const dbPath = resolve(root, 'content.db');
  await access(resolve(root, 'migration-complete.json'));
  const db = new DatabaseSync(dbPath);
  try {
    for (const name of required) if (!table(db, name)) throw Error(`Missing prerequisite table: ${name}`);
    for (const [name, field] of [['site_profile','content_order'],['library_entries','showcase_cover'],['_library_entries_v','version_showcase_cover']])
      if (!column(db,name,field)) throw Error(`Apply the earlier site migration first: ${name}.${field}`);
    if (table(db, 'readers')) {
      for (const name of ['email', 'nickname', '_verified', 'disabled']) if (!column(db, 'readers', name)) throw Error(`Reader schema is incomplete: ${name}`);
      if (!column(db, 'readers', 'phone') || !column(db, 'readers', 'signature') || !column(db, 'readers', 'avatar') || !column(db, 'readers', 'vip_started_at') || !column(db, 'readers', 'vip_until') || !column(db, 'readers', 'reset_password_requested_at') || !table(db, 'login_events') || missingUid(db) || !trigger(db, 'reader_uids_on_insert')) {
        const backupDir = resolve(root, 'schema-backups');
        await mkdir(backupDir, { recursive: true });
        const backupPath = resolve(backupDir, `before-reader-schema-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`);
        await backup(db, backupPath);
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!column(db, 'readers', 'phone')) db.exec('ALTER TABLE readers ADD COLUMN phone text');
          if (!column(db, 'readers', 'signature')) db.exec('ALTER TABLE readers ADD COLUMN signature text');
          if (!column(db, 'readers', 'avatar')) db.exec('ALTER TABLE readers ADD COLUMN avatar text');
          if (!column(db, 'readers', 'vip_started_at')) db.exec('ALTER TABLE readers ADD COLUMN vip_started_at text');
          if (!column(db, 'readers', 'vip_until')) db.exec('ALTER TABLE readers ADD COLUMN vip_until text');
          if (!column(db, 'readers', 'reset_password_requested_at')) db.exec('ALTER TABLE readers ADD COLUMN reset_password_requested_at text');
          if (!table(db, 'login_events')) db.exec(loginEventsSchema);
          ensureUids(db);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return { migrated: true, backupPath, reason: 'reader-schema-upgrade' };
      }
      return { migrated: false, reason: 'already-present' };
    }
    const backupDir = resolve(root, 'schema-backups');
    await mkdir(backupDir, { recursive: true });
    const backupPath = resolve(backupDir, `before-readers-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.db`);
    await backup(db, backupPath);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE readers (
        id text(36) PRIMARY KEY NOT NULL,
        nickname text NOT NULL,
        phone text,
        signature text,
        avatar text,
        vip_started_at text,
        vip_until text,
        disabled integer DEFAULT false,
        updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
        created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
        email text NOT NULL,
        reset_password_token text,
        reset_password_expiration text,
        reset_password_requested_at text,
        salt text,
        hash text,
        _verified integer,
        _verificationtoken text,
        login_attempts numeric DEFAULT 0,
        lock_until text
      );
      CREATE TABLE readers_sessions (
        _order integer NOT NULL,
        _parent_id text(36) NOT NULL,
        id text PRIMARY KEY NOT NULL,
        created_at text,
        expires_at text NOT NULL,
        FOREIGN KEY (_parent_id) REFERENCES readers(id) ON UPDATE no action ON DELETE cascade
      );
      CREATE UNIQUE INDEX readers_email_idx ON readers(email);
      CREATE INDEX readers_created_at_idx ON readers(created_at);
      CREATE INDEX readers_updated_at_idx ON readers(updated_at);
      CREATE INDEX readers_sessions_order_idx ON readers_sessions(_order);
      CREATE INDEX readers_sessions_parent_id_idx ON readers_sessions(_parent_id);`);
      db.exec(loginEventsSchema);
      ensureUids(db);
      for (const relation of ['payload_locked_documents_rels', 'payload_preferences_rels']) {
        if (column(db, relation, 'readers_id')) throw Error(`${relation}.readers_id already exists without readers table`);
        db.exec(`ALTER TABLE ${relation} ADD COLUMN readers_id text(36) REFERENCES readers(id) ON UPDATE no action ON DELETE cascade`);
        db.exec(`CREATE INDEX ${relation}_readers_id_idx ON ${relation}(readers_id)`);
      }
      db.exec('COMMIT');
      return { migrated: true, backupPath };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
