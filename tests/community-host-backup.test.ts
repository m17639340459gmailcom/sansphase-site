import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityHostStore, prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { backupCommunity, restoreCommunity, verifyCommunityBackup } from '../server/community-host-backup.ts';
import { createCommunityStore } from '../server/community-store.ts';

const execute = promisify(execFile);
const scheduledScript = fileURLToPath(new URL('../scripts/scheduled-community-backup.mjs', import.meta.url));

let template: string;
test.before(async () => { template = await mkdtemp(resolve(tmpdir(), 'host-backup-template-')); await prepareCommunityHostDirectory(template); });
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(resolve(tmpdir(), 'host-backup-'));
  const directory = resolve(root, 'private-data'), publicRoot = resolve(root, 'public'), configPath = resolve(root, 'community.json');
  await mkdir(directory); await mkdir(publicRoot); await mkdir(resolve(directory, 'uploads')); await mkdir(resolve(directory, 'schema-backups'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  await copyFile(resolve(template, 'community-host.db'), resolve(directory, 'community-host.db'));
  await writeFile(resolve(directory, 'uploads', 'unknown-artwork.keep'), 'unknown file is preserved');
  await writeFile(resolve(directory, 'community-words.txt'), '保留私有词表');
  await writeFile(resolve(directory, 'community-admin-audit.jsonl'), '{"action":"test"}\n');
  await writeFile(resolve(directory, 'schema-backups', 'before-community-test.db'), 'old migration backup');
  await writeFile(configPath, JSON.stringify({ directory, siteOrigin: 'https://community.sansphase.com', mainSiteOrigin: 'https://www.sansphase.com', authorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bridgeSecret: 'private-test-bridge-secret-at-least-32-characters' }), { mode: 0o600 });
  await chmod(configPath, 0o600);
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { root, directory, publicRoot, configPath, target: resolve(root, 'backup') };
}

test('independent backup verifies both files of approved and pending personal backgrounds', async t => {
  const env = await fixture(t), store = createCommunityStore(env.directory);
  const reader = { kind: 'reader' as const, id: 'reader-background' }, owner = { kind: 'owner' as const, id: 'owner' };
  const approved = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pending = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  try {
    for (const id of [approved, pending]) {
      store.addImage({ id, uploader: reader, width: 1200, height: 400, purpose: 'profile' });
      for (const kind of ['image', 'thumb']) await writeFile(resolve(env.directory, 'uploads', `community-${kind}-${id}.webp`), `background-${kind}`);
    }
    store.profileBackgrounds.submit(reader, approved);
    store.profileBackgrounds.review(reader, approved, true, owner, '');
    store.profileBackgrounds.submit(reader, pending);
  } finally { store.close(); }
  await backupCommunity(env);
  const saved = await verifyCommunityBackup(env.target);
  for (const id of [approved, pending]) for (const kind of ['image', 'thumb']) assert.ok(saved.manifest.files.some(file => file.path === `uploads/community-${kind}-${id}.webp`));
  await rm(resolve(env.directory, 'uploads', `community-thumb-${pending}.webp`));
  await assert.rejects(backupCommunity({ ...env, target: resolve(env.root, 'missing-background-backup') }), /ENOENT|absent/i);
});

test('pre-migration community data can be backed up and restored before optional profile background tables exist', async t => {
  const env = await fixture(t);
  const db = new DatabaseSync(resolve(env.directory, 'content.db'));
  try { db.exec('DROP TABLE community_profile_backgrounds; DROP TABLE community_profile_background_reviews;'); } finally { db.close(); }
  await backupCommunity(env);
  assert.ok((await verifyCommunityBackup(env.target)).files > 0);
  const restored = resolve(env.root, 'restored-old-data');
  await restoreCommunity({ backupPath: env.target, target: restored, configPath: resolve(env.root, 'restored-old.json'), publicRoot: env.publicRoot });
  const restoredDb = new DatabaseSync(resolve(restored, 'content.db'), { readOnly: true });
  try { assert.equal(restoredDb.prepare("SELECT 1 FROM sqlite_master WHERE name='community_profile_backgrounds'").get(), undefined); } finally { restoredDb.close(); }
});

test('independent backup preserves both SQLite databases, all uploads, private config and maintenance metadata', async t => {
  const env = await fixture(t);
  const oldStore = createCommunityHostStore(env.directory);
  const oldToken = oldStore.createSession('opaque-main-ref', { kind: 'reader', id: 'reader-before-restore' });
  oldStore.consumeEntry('127.0.0.1');
  oldStore.consumeNonce('replay-before-restore', Date.now() + 120_000);
  oldStore.queueFile('community-image-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', 'persisted-retry');
  oldStore.markReaderDeleted('deleted-before-backup');
  oldStore.close();
  const result = await backupCommunity(env);
  assert.equal(result.manifest.provider, 'sansphase-community');
  assert.ok(result.manifest.files.some(file => file.path === 'community-host.db'));
  assert.ok(result.manifest.files.some(file => file.path === 'uploads/unknown-artwork.keep'));
  assert.ok(result.manifest.files.some(file => file.path === 'schema-backups/before-community-test.db'));
  assert.equal((await verifyCommunityBackup(env.target)).files, result.manifest.files.length);
  const restored = resolve(env.root, 'restored'), restoredConfig = resolve(env.root, 'restored-config.json');
  await restoreCommunity({ backupPath: env.target, target: restored, configPath: restoredConfig, publicRoot: env.publicRoot });
  const restoredStore = createCommunityHostStore(restored);
  try {
    assert.equal(restoredStore.session(oldToken), null);
    assert.equal(restoredStore.consumeNonce('replay-before-restore', Date.now() + 120_000), false);
    assert.equal(restoredStore.fileQueue()[0]?.reason, 'persisted-retry');
    assert.equal(restoredStore.readerDeleted('deleted-before-backup'), true);
  } finally { restoredStore.close(); }
  assert.equal(JSON.parse(await readFile(restoredConfig, 'utf8')).directory, restored);
  assert.equal(await readFile(resolve(restored, 'uploads', 'unknown-artwork.keep'), 'utf8'), 'unknown file is preserved');
  const db = new DatabaseSync(resolve(restored, 'content.db'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok'); assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='readers'").get()); }
  finally { db.close(); }
  await assert.rejects(restoreCommunity({ backupPath: env.target, target: restored, configPath: restoredConfig, publicRoot: env.publicRoot }), /exist|overwrite/i);
});

test('backup cannot overwrite or enter data/public directories and refuses symlinks without touching source', async t => {
  const env = await fixture(t);
  await assert.rejects(backupCommunity({ ...env, target: resolve(env.directory, 'nested-backup') }), /separate|inside/i);
  await assert.rejects(backupCommunity({ ...env, target: resolve(env.publicRoot, 'backup') }), /public|separate/i);
  await mkdir(env.target);
  await assert.rejects(backupCommunity(env), /exist|overwrite/i);
  try { await symlink(env.configPath, resolve(env.directory, 'uploads', 'config-link'), 'file'); }
  catch (error) { if (process.platform === 'win32' && error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') return; throw error; }
  await assert.rejects(backupCommunity({ ...env, target: resolve(env.root, 'backup-with-link') }), /symlink/i);
  assert.ok((await readFile(env.configPath, 'utf8')).includes('private-test-bridge-secret'));
});

test('restore verifies all checksums and paths before creating a new destination', async t => {
  const env = await fixture(t);
  await backupCommunity(env);
  await writeFile(resolve(env.target, 'uploads', 'unknown-artwork.keep'), 'tampered');
  const target = resolve(env.root, 'rejected'), configPath = resolve(env.root, 'rejected.json');
  await assert.rejects(restoreCommunity({ backupPath: env.target, target, configPath, publicRoot: env.publicRoot }), /checksum|size/i);
  await assert.rejects(readFile(configPath), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(target, 'content.db')), { code: 'ENOENT' });
  const manifest = JSON.parse(await readFile(resolve(env.target, 'backup-manifest.json'), 'utf8'));
  manifest.files[0].path = '../private-data/content.db';
  await writeFile(resolve(env.target, 'backup-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyCommunityBackup(env.target), /path/i);
});

test('scheduled backup creates a new verified copy on each run and preserves earlier backups', async t => {
  const env = await fixture(t);
  await mkdir(resolve(env.root, 'dist'));
  const parent = resolve(env.root, 'scheduled-backups');
  const options = { cwd: env.root, env: { ...process.env, COMMUNITY_CONFIG_FILE: env.configPath, COMMUNITY_BACKUP_DIRECTORY: parent } };
  const first = JSON.parse((await execute(process.execPath, [scheduledScript], options)).stdout);
  const firstManifest = await readFile(resolve(parent, first.name, 'backup-manifest.json'), 'utf8');
  const second = JSON.parse((await execute(process.execPath, [scheduledScript], options)).stdout);
  assert.equal(first.verified, true);
  assert.equal(second.verified, true);
  assert.notEqual(first.name, second.name);
  assert.equal((await readdir(parent)).length, 2);
  assert.equal(await readFile(resolve(parent, first.name, 'backup-manifest.json'), 'utf8'), firstManifest);
  await verifyCommunityBackup(resolve(parent, first.name));
  await verifyCommunityBackup(resolve(parent, second.name));
});

test('scheduled backup rejects nested data and public parents before creating directories', async t => {
  const env = await fixture(t);
  const publicRoot = resolve(env.root, 'dist');
  await mkdir(publicRoot);
  for (const parent of [resolve(env.directory, 'must-not-create', 'backup'), resolve(publicRoot, 'must-not-create', 'backup')]) {
    await assert.rejects(execute(process.execPath, [scheduledScript], {
      cwd: env.root,
      env: { ...process.env, COMMUNITY_CONFIG_FILE: env.configPath, COMMUNITY_BACKUP_DIRECTORY: parent },
    }), /separate from data and public directories/);
    await assert.rejects(lstat(resolve(parent, '..')), { code: 'ENOENT' });
  }
  assert.equal(await readFile(resolve(env.directory, 'uploads', 'unknown-artwork.keep'), 'utf8'), 'unknown file is preserved');
});
