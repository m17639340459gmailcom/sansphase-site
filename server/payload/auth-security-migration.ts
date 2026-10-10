import { DatabaseSync, backup } from 'node:sqlite';
import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

type AuthTable = 'authors' | 'readers';
const authTables: AuthTable[] = ['authors', 'readers'];
const timestampColumn = 'reset_password_requested_at';
const legacyColumns = ['id', 'email', 'salt', 'hash', 'reset_password_token', 'reset_password_expiration', 'login_attempts', 'lock_until'];

function authSchema(db: DatabaseSync, table: AuthTable) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!definition || /^CREATE\s+VIRTUAL\s+TABLE/i.test(String(definition.sql))) throw new Error(`Unexpected Payload auth schema: ${table}`);
  const fields = db.prepare(`PRAGMA table_xinfo(${table})`).all();
  for (const field of legacyColumns) if (!fields.some(column => column.name === field)) throw new Error(`Incomplete Payload auth schema: ${table}.${field}`);
  const timestamp = fields.find(column => column.name === timestampColumn);
  if (timestamp && (String(timestamp.type).toUpperCase() !== 'TEXT' || timestamp.notnull !== 0 || timestamp.dflt_value !== null || timestamp.hidden !== 0)) {
    throw new Error(`Unexpected Payload reset timestamp column: ${table}.${timestampColumn}`);
  }
  return Boolean(timestamp);
}

function ready(db: DatabaseSync, tables: AuthTable[]) {
  for (const table of tables) if (!authSchema(db, table)) throw new Error(`Apply the explicit Payload auth security migration before startup: ${table}.${timestampColumn}`);
}

function integrity(db: DatabaseSync) {
  const result = db.prepare('PRAGMA integrity_check').all();
  if (result.length !== 1 || result[0]?.integrity_check !== 'ok') throw new Error('Payload database integrity check failed; no auth migration is allowed.');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Payload database has invalid foreign-key references; no auth migration is allowed.');
}

const schema = (db: DatabaseSync) => JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all());
const version = (db: DatabaseSync, kind: 'data_version' | 'schema_version') => db.prepare(`PRAGMA ${kind}`).get()?.[kind];

/** Read-only startup guard. Production startup never creates or pushes a schema. */
export function assertPayloadAuthSchemaReady(directory: string, { includeReaders = true }: { includeReaders?: boolean } = {}) {
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { ready(db, includeReaders ? authTables : ['authors']); }
  finally { db.close(); }
}

/** Payload 3.90 adds this nullable date field to the existing local auth tables. */
export async function migratePayloadAuthSecurity(directory: string) {
  const root = resolve(directory), database = resolve(root, 'content.db');
  const manifest: unknown = JSON.parse(await readFile(resolve(root, 'migration-complete.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !('provider' in manifest) || manifest.provider !== 'payload') throw new Error('Expected the earlier validated Payload provider manifest.');
  await access(database);
  const db = new DatabaseSync(database);
  try {
    const missing = authTables.filter(table => !authSchema(db, table));
    integrity(db);
    if (!missing.length) return { migrated: false, reason: 'already-present' };
    const dataVersion = version(db, 'data_version'), schemaVersion = version(db, 'schema_version'), originalSchema = schema(db);
    const backups = resolve(root, 'schema-backups');
    await mkdir(backups, { recursive: true });
    const backupPath = resolve(backups, `before-payload-auth-3-90-${Date.now()}-${randomUUID()}.db`);
    await backup(db, backupPath);
    const snapshot = new DatabaseSync(backupPath, { readOnly: true });
    try {
      integrity(snapshot);
      // SQLite backup can assign the destination a different schema cookie.
      // Compare actual definitions; source cookies below detect concurrent writes.
      if (schema(snapshot) !== originalSchema) throw new Error('Payload backup schema changed during the auth snapshot; retry in a quiet window.');
    } finally { snapshot.close(); }
    db.exec('BEGIN IMMEDIATE');
    try {
      // A different connection must not change the source between its verified
      // backup and the write lock. A retry will take a fresh snapshot.
      if (version(db, 'data_version') !== dataVersion || version(db, 'schema_version') !== schemaVersion) throw new Error('Payload database changed during the auth snapshot; retry in a quiet window.');
      for (const table of missing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${timestampColumn} TEXT`);
      ready(db, authTables);
      integrity(db);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { migrated: true, backupPath, reason: 'payload-auth-security-upgrade', tables: missing };
  } finally { db.close(); }
}
