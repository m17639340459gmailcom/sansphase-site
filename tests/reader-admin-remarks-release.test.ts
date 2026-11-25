import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const execute = promisify(execFile);
// Last committed version immediately before the private-remark feature. Read
// this actual Git revision rather than fabricating an approximate old schema/API.
const rollbackRevision = '3d213699172f00ba054bb9d118635ed99f4493c6';
const enabled = process.env.ADMIN_REMARKS_RELEASE_DRILL === '1';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function inspect(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    return {
      columns: db.prepare('PRAGMA table_info(readers)').all().map(row => String(row.name)),
      accounts: db.prepare('SELECT id,email,nickname,phone,signature,avatar,_verified,disabled,vip_started_at,vip_until,hash,salt FROM readers ORDER BY id').all(),
      authors: db.prepare('SELECT id,email,first_name,role,hash,salt FROM authors ORDER BY id').all(),
      uids: db.prepare('SELECT reader_id,uid FROM reader_uids ORDER BY uid').all(),
      articles: db.prepare('SELECT id,title,slug,status,body,attachments FROM articles ORDER BY id').all(),
      profile: db.prepare('SELECT id,name,signature FROM site_profile ORDER BY id').all(),
      media: db.prepare('SELECT id,filename FROM media ORDER BY id').all(),
    };
  } finally { db.close(); }
}

test('push:false remark migration and actual pre-remark code rollback preserve the current database',
  { skip: !enabled, timeout: 180000 }, async t => {
    const root = resolve('.'), local = resolve(root, '.local');
    await mkdir(local, { recursive: true });
    const directory = await mkdtemp(resolve(local, 'reader-remarks-release-drill-'));
    const rollback = resolve(directory, 'rollback-code'), data = resolve(directory, 'data');
    const file = resolve(data, 'content.db'), helper = resolve(root, 'tests/helpers/reader-remarks-runtime.ts');
    const config = resolve(directory, 'synthetic-config.json');
    const env = { ...process.env, NODE_ENV: 'production', SITE_ORIGIN: 'https://remarks-runtime.example.test', PAYLOAD_CONFIG_FILE: config };
    const run = (args: string[], timeout = 45000) => execute(process.execPath, args, { cwd: root, env, windowsHide: true, timeout, maxBuffer: 2 * 1024 ** 2 });
    const phase = async (name: string, source = root) => {
      const result = await execute(process.execPath, [helper, name, directory, source], {
        cwd: root, env: { ...env, NODE_ENV: name === 'seed' ? 'test' : 'production' },
        windowsHide: true, timeout: 45000, maxBuffer: 2 * 1024 ** 2,
      });
      assert.match(result.stdout, new RegExp(`"phase":"${name}","status":"passed"`));
      t.diagnostic(`${name}: passed in an isolated process`);
    };
    try {
      const actual = (await execute('git', ['rev-parse', `${rollbackRevision}^{commit}`], { cwd: root, windowsHide: true })).stdout.trim();
      assert.equal(actual, rollbackRevision);
      await mkdir(rollback);
      const archive = resolve(directory, 'rollback-source.tar');
      await execute('git', ['archive', '--format=tar', `--output=${archive}`, rollbackRevision, 'server', 'src', 'server.mjs', 'package.json'], { cwd: root, windowsHide: true });
      await execute('tar', ['-xf', archive, '-C', rollback], { cwd: root, windowsHide: true });
      const oldConfig = (await execute('git', ['show', `${rollbackRevision}:server/payload/config.ts`], { cwd: root, windowsHide: true })).stdout;
      assert.equal(hash(await readFile(resolve(rollback, 'server/payload/config.ts'))), hash(Buffer.from(oldConfig)));
      assert.doesNotMatch(oldConfig, /admin_remark/);
      const oldPackage = JSON.parse(await readFile(resolve(rollback, 'package.json'), 'utf8'));
      const currentPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
      assert.equal(oldPackage.dependencies.payload, currentPackage.dependencies.payload, 'code rollback must retain the current patched authentication dependency');
      await phase('seed');
      const before = inspect(file), originalBytes = await readFile(file);
      assert.ok(!before.columns.includes('admin_remark'));
      await phase('missing-column');
      assert.deepEqual(await readFile(file), originalBytes, 'readiness rejection must not mutate the account database');
      const backup = resolve(directory, 'before-upgrade-backup');
      await run(['scripts/backup-payload.mjs', backup]);
      const manifest = JSON.parse(await readFile(resolve(backup, 'backup-manifest.json'), 'utf8')) as { files: { path: string; sha256: string }[] };
      for (const item of manifest.files) {
        const path = resolve(backup, item.path);
        assert.ok(path.startsWith(backup + sep));
        assert.equal(hash(await readFile(path)), item.sha256);
      }
      assert.deepEqual(inspect(resolve(backup, 'content.db')), before);
      const restored = resolve(directory, 'restored-backup'), restoredConfig = resolve(directory, 'restored-config.json');
      await run(['scripts/restore-payload.mjs', backup, restored, restoredConfig]);
      assert.deepEqual(inspect(resolve(restored, 'content.db')), before, 'restore verification targets a new directory, never the working database');
      const migration = JSON.parse((await run(['scripts/migrate-reader-accounts.mjs', data])).stdout);
      assert.equal(migration.migrated, true);
      assert.ok(resolve(migration.backupPath).startsWith(data + sep));
      assert.deepEqual(inspect(migration.backupPath), before);
      const afterMigration = inspect(file);
      assert.deepEqual({ ...afterMigration, columns: before.columns }, before);
      assert.ok(afterMigration.columns.includes('admin_remark'));
      assert.equal(JSON.parse((await run(['scripts/migrate-reader-accounts.mjs', data])).stdout).migrated, false);
      await phase('new');
      const afterNew = inspect(file);
      assert.equal(afterNew.accounts.length, 2);
      const currentBackup = resolve(directory, 'after-upgrade-backup');
      await run(['scripts/backup-payload.mjs', currentBackup]);
      assert.deepEqual(inspect(resolve(currentBackup, 'content.db')), afterNew);
      const remarkBackup = new DatabaseSync(resolve(currentBackup, 'content.db'), { readOnly: true });
      try { assert.equal(remarkBackup.prepare('SELECT admin_remark FROM readers WHERE email=?').get('reader@example.test')?.admin_remark, '迁移演练私有备注：不得丢失'); }
      finally { remarkBackup.close(); }
      await phase('rollback', rollback);
      const afterRollback = inspect(file);
      assert.deepEqual(afterRollback.columns, afterMigration.columns);
      assert.deepEqual(afterRollback.uids, afterNew.uids);
      assert.deepEqual(afterRollback.authors, before.authors);
      assert.deepEqual(afterRollback.articles, before.articles);
      assert.deepEqual(afterRollback.profile, before.profile);
      assert.deepEqual(afterRollback.media, before.media);
      for (const reader of afterRollback.accounts) {
        const prior = afterNew.accounts.find(row => row.id === reader.id); assert.ok(prior);
        assert.deepEqual({ ...reader, vip_until: prior.vip_until }, { ...prior });
      }
      await phase('return');
      const final = inspect(file);
      assert.deepEqual(final, afterRollback, 'restarting the current code does not revert valid writes made while running old code');
      const db = new DatabaseSync(file, { readOnly: true });
      try { assert.equal(db.prepare('SELECT admin_remark FROM readers WHERE email=?').get('reader@example.test')?.admin_remark, '迁移演练私有备注：不得丢失'); }
      finally { db.close(); }
      for (const item of manifest.files.filter(item => item.path.startsWith('uploads/'))) {
        assert.equal(hash(await readFile(resolve(data, item.path))), item.sha256, `upload preserved: ${item.path}`);
      }
      t.diagnostic(`Verified old code ${rollbackRevision}, real explicit migration/backup/restore scripts, same live synthetic DB, no data rollback.`);
    } finally {
      assert.equal(resolve(local, basename(directory)), directory);
      assert.match(basename(directory), /^reader-remarks-release-drill-/);
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  });
