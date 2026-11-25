import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const fields = ['invitation_code', 'invited_by', 'invitation_bound'];
function columns(db: DatabaseSync) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='readers'").get();
  if (!definition || /^CREATE\s+VIRTUAL\s+TABLE/i.test(String(definition.sql))) throw Error('Unexpected reader invitation source schema.');
  const values = db.prepare('PRAGMA table_info(readers)').all();
  for (const name of fields) {
    const value = values.find(column => column.name === name);
    if (value && String(value.type).toUpperCase() !== (name === 'invitation_bound' ? 'INTEGER' : 'TEXT')) throw Error(`Unexpected reader invitation column: ${name}`);
  }
  return values;
}
function ready(db: DatabaseSync) {
  const values = columns(db);
  if (!fields.every(field => values.some(column => column.name === field))) throw Error('Apply the explicit reader invitation migration before startup.');
  const indexes = db.prepare('PRAGMA index_list(readers)').all();
  if (!indexes.some(index => {
    const indexed = db.prepare('SELECT name FROM pragma_index_info(?)').all(String(index.name));
    return index.unique === 1 && index.partial === 0 && indexed.length === 1 && indexed[0].name === 'invitation_code';
  })) {
    throw Error('Reader invitation migration requires a unique invitation code index.');
  }
}
function integrity(db: DatabaseSync) {
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Reader invitation database integrity failed.');
}
export function assertReaderInvitationsReady(directory: string) {
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { ready(db); } finally { db.close(); }
}
export async function migrateReaderInvitations(directory: string): Promise<{ migrated: boolean; backupPath?: string }> {
  const root = resolve(directory), path = resolve(root, 'content.db');
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink()) throw Error('Reader invitation source must be a regular database file.');
  const manifest: unknown = JSON.parse(await readFile(resolve(root, 'migration-complete.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !('provider' in manifest) || manifest.provider !== 'payload') throw Error('Expected a validated Payload manifest.');
  const db = new DatabaseSync(path);
  try {
    const values = columns(db);
    for (const column of ['id', '_verified', 'disabled', 'created_at']) if (!values.some(value => value.name === column)) throw Error('Reader invitation prerequisites are missing.');
    integrity(db);
    try { ready(db); return { migrated: false }; } catch { /* Explicit migration below. */ }
    const dataVersion = db.prepare('PRAGMA data_version').get()?.data_version;
    const schemaVersion = db.prepare('PRAGMA schema_version').get()?.schema_version;
    await mkdir(resolve(root, 'schema-backups'), { recursive: true });
    const backupPath = resolve(root, 'schema-backups', `before-reader-invitations-${Date.now()}-${randomUUID()}.db`);
    await backup(db, backupPath);
    const snapshot = new DatabaseSync(backupPath, { readOnly: true });
    try { integrity(snapshot); } finally { snapshot.close(); }
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('PRAGMA data_version').get()?.data_version !== dataVersion || db.prepare('PRAGMA schema_version').get()?.schema_version !== schemaVersion) throw Error('Source changed during invitation backup; retry in a quiet window.');
      if (!values.some(column => column.name === 'invitation_code')) db.exec('ALTER TABLE readers ADD COLUMN invitation_code TEXT');
      if (!values.some(column => column.name === 'invited_by')) db.exec('ALTER TABLE readers ADD COLUMN invited_by TEXT');
      if (!values.some(column => column.name === 'invitation_bound')) db.exec('ALTER TABLE readers ADD COLUMN invitation_bound INTEGER NOT NULL DEFAULT 0');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS readers_invitation_code_idx ON readers(invitation_code); CREATE INDEX IF NOT EXISTS readers_invited_by_idx ON readers(invited_by)');
      ready(db); integrity(db); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { migrated: true, backupPath };
  } finally { db.close(); }
}
