import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pbkdf2Sync, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { legacyAuthFixture } from './fixtures/payload-auth-3-89.mjs';
import { migratePayloadAuthSecurity, assertPayloadAuthSchemaReady } from '../server/payload/auth-security-migration.ts';

const exec = promisify(execFile);
const fields = Object.fromEntries(Object.entries(legacyAuthFixture.accounts).map(([table, rows]) => [table, Object.keys(rows[0])]));
function records(db) {
  return Object.fromEntries(['authors', 'readers', 'reader_uids', 'protected_content'].map(table => [table,
    db.prepare(`SELECT ${fields[table]?.join(',') || '*'} FROM ${table} ORDER BY ${table === 'reader_uids' ? 'uid' : 'id'}`).all(),
  ]));
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-auth-security-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  for (const type of ['table', 'index', 'trigger']) for (const entry of legacyAuthFixture.schema.filter(row => row.type === type)) db.exec(entry.sql);
  for (const [table, rows] of Object.entries(legacyAuthFixture.accounts)) for (const row of rows) {
    const names = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row));
  }
  db.exec("CREATE TABLE protected_content(id TEXT PRIMARY KEY, body TEXT, upload TEXT); INSERT INTO protected_content VALUES ('post', '模拟正文与JSON保持原样', 'fixture.bin');");
  db.close();
  await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
  await mkdir(resolve(directory, 'uploads'));
  await writeFile(resolve(directory, 'uploads/fixture.bin'), Buffer.from('isolated immutable upload bytes'));
  return directory;
}

test('the saved actual 3.89 fixture has old hashes that authenticate without inventing an upgrade vector', () => {
  assert.equal(legacyAuthFixture.version, '3.89.0');
  for (const rows of Object.values(legacyAuthFixture.accounts)) {
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.hash.length, 1024);
    assert.equal(pbkdf2Sync(legacyAuthFixture.password, row.salt, 25000, 512, 'sha256').toString('hex'), row.hash);
  }
});

test('an explicit auth migration verifies its snapshot and preserves legacy hashes, UID, VIP, profile, unrelated content and uploads', async t => {
  const directory = await fixture(t), path = resolve(directory, 'content.db');
  const before = new DatabaseSync(path, { readOnly: true });
  const data = records(before);
  const otherSchema = before.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT IN ('authors','readers') ORDER BY type,name").all();
  before.close();
  const uploadHash = digest(await readFile(resolve(directory, 'uploads/fixture.bin')));
  assert.throws(() => assertPayloadAuthSchemaReady(directory), /reset_password_requested_at/);
  const result = await migratePayloadAuthSecurity(directory);
  assert.equal(result.migrated, true);
  assert.deepEqual(result.tables, ['authors', 'readers']);
  const backup = new DatabaseSync(result.backupPath, { readOnly: true });
  try {
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(backup.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(records(backup), data);
    for (const table of ['authors', 'readers']) assert.equal(backup.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'reset_password_requested_at'), false);
  } finally { backup.close(); }
  const after = new DatabaseSync(path, { readOnly: true });
  try {
    assert.deepEqual(records(after), data);
    assert.deepEqual(after.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT IN ('authors','readers') ORDER BY type,name").all(), otherSchema);
    for (const table of ['authors', 'readers']) {
      const column = after.prepare(`PRAGMA table_info(${table})`).all().find(row => row.name === 'reset_password_requested_at');
      assert.equal(column.type.toUpperCase(), 'TEXT'); assert.equal(column.notnull, 0); assert.equal(column.dflt_value, null);
      assert.equal(after.prepare(`SELECT reset_password_requested_at FROM ${table}`).get().reset_password_requested_at, null);
    }
    assert.equal(after.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { after.close(); }
  assert.doesNotThrow(() => assertPayloadAuthSchemaReady(directory));
  assert.equal(digest(await readFile(resolve(directory, 'uploads/fixture.bin'))), uploadHash);
  const again = await migratePayloadAuthSecurity(directory);
  assert.equal(again.migrated, false);
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1);
});

test('partial upgrades retain an existing reset timestamp and add only the missing account column', async t => {
  const directory = await fixture(t);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec("ALTER TABLE authors ADD COLUMN reset_password_requested_at TEXT; UPDATE authors SET reset_password_requested_at='2026-10-10T01:02:03.000Z'"); db.close();
  const result = await migratePayloadAuthSecurity(directory);
  assert.deepEqual(result.tables, ['readers']);
  const check = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { assert.equal(check.prepare('SELECT reset_password_requested_at FROM authors').get().reset_password_requested_at, '2026-10-10T01:02:03.000Z'); }
  finally { check.close(); }
});

test('malformed auth schemas fail before a snapshot or any additive write', async t => {
  for (const malformed of ['wrong-column-type', 'required-column', 'missing-legacy-column']) await t.test(malformed, async subt => {
    const directory = await fixture(subt), path = resolve(directory, 'content.db');
    const db = new DatabaseSync(path);
    if (malformed === 'wrong-column-type') db.exec('ALTER TABLE readers ADD COLUMN reset_password_requested_at INTEGER');
    else if (malformed === 'required-column') db.exec("ALTER TABLE readers ADD COLUMN reset_password_requested_at TEXT NOT NULL DEFAULT ''");
    else db.exec('ALTER TABLE readers DROP COLUMN salt');
    const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all(); db.close();
    await assert.rejects(migratePayloadAuthSecurity(directory), /schema|column|timestamp/i);
    const after = new DatabaseSync(path, { readOnly: true });
    try { assert.deepEqual(after.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all(), schema); }
    finally { after.close(); }
    await assert.rejects(access(resolve(directory, 'schema-backups')), { code: 'ENOENT' });
  });
});

test('an invalid foreign-key database or unusable backup destination cannot receive the new columns', async t => {
  for (const failure of ['foreign-key', 'backup-destination']) await t.test(failure, async subt => {
    const directory = await fixture(subt);
    if (failure === 'foreign-key') {
      const db = new DatabaseSync(resolve(directory, 'content.db'));
      db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE damaged_reference(id TEXT, reader_id TEXT REFERENCES readers(id)); INSERT INTO damaged_reference VALUES ('bad', 'absent-reader');"); db.close();
    } else await writeFile(resolve(directory, 'schema-backups'), 'a file is not a backup directory');
    await assert.rejects(migratePayloadAuthSecurity(directory));
    const check = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
    try { for (const table of ['authors', 'readers']) assert.equal(check.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === 'reset_password_requested_at'), false); }
    finally { check.close(); }
  });
});

test('migration requires the earlier provider manifest and an existing database; readiness never creates one', async t => {
  const directory = await fixture(t);
  await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'unknown' }));
  await assert.rejects(migratePayloadAuthSecurity(directory), /Payload|provider|manifest/);
  const missing = resolve(directory, 'not-a-database');
  await mkdir(missing);
  assert.throws(() => assertPayloadAuthSchemaReady(missing));
  await assert.rejects(access(resolve(missing, 'content.db')), { code: 'ENOENT' });
});

test('authors-only readiness skips readers only when explicitly configured', async t => {
  const directory = await fixture(t);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('ALTER TABLE authors ADD COLUMN reset_password_requested_at TEXT'); db.close();
  assert.doesNotThrow(() => assertPayloadAuthSchemaReady(directory, { includeReaders: false }));
  assert.throws(() => assertPayloadAuthSchemaReady(directory), /readers.*reset_password_requested_at/);
});

test('the explicit migration CLI reports the verified snapshot and safely becomes a no-op on its second run', async t => {
  const directory = await fixture(t);
  const command = resolve('scripts/migrate-payload-auth-security.mjs');
  const result = await exec(process.execPath, [command, directory]);
  const first = JSON.parse(result.stdout);
  assert.equal(first.migrated, true); await access(first.backupPath);
  const again = JSON.parse((await exec(process.execPath, [command, directory])).stdout);
  assert.equal(again.migrated, false);
  await assert.rejects(exec(process.execPath, [command]), /Usage:/);
});
