import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('private backups include approved reader avatars but omit temporary verification requests', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'sansphase-reader-backup-'));
  const directory = resolve(root, 'source'), target = resolve(root, 'backup');
  try {
    await mkdir(resolve(directory, 'uploads'), { recursive: true });
    const avatar = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const db = new DatabaseSync(resolve(directory, 'content.db'));
    try {
      db.exec('CREATE TABLE media (filename TEXT); CREATE TABLE readers (avatar TEXT);');
      db.prepare('INSERT INTO readers (avatar) VALUES (?)').run(avatar);
    } finally { db.close(); }
    const temporary = new DatabaseSync(resolve(directory, 'reader-workflow.db'));
    try { temporary.exec('CREATE TABLE reader_registration_requests (email TEXT);'); }
    finally { temporary.close(); }
    await writeFile(resolve(directory, 'uploads', `reader-avatar-${avatar}.webp`), 'approved-image');
    await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
    const config = resolve(root, 'settings.json');
    await writeFile(config, JSON.stringify({ directory }));
    await run(process.execPath, ['scripts/backup-payload.mjs', target], {
      cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, PAYLOAD_CONFIG_FILE: config },
    });
    assert.equal(await readFile(resolve(target, 'uploads', `reader-avatar-${avatar}.webp`), 'utf8'), 'approved-image');
    assert(!(await readFile(resolve(target, 'backup-manifest.json'), 'utf8')).includes('reader-workflow.db'));
    const restored = resolve(root, 'restored'), restoredConfig = resolve(root, 'restored-settings.json');
    const restoreArgs = ['scripts/restore-payload.mjs', target, restored, restoredConfig];
    await run(process.execPath, restoreArgs, { cwd: resolve(import.meta.dirname, '..') });
    assert.equal(await readFile(resolve(restored, 'uploads', `reader-avatar-${avatar}.webp`), 'utf8'), 'approved-image');
    const restoredDb = new DatabaseSync(resolve(restored, 'content.db'), { readOnly: true });
    try { assert.equal(restoredDb.prepare('SELECT avatar FROM readers').get().avatar, avatar); }
    finally { restoredDb.close(); }
    assert.equal(JSON.parse(await readFile(restoredConfig, 'utf8')).directory, restored);
    await assert.rejects(run(process.execPath, restoreArgs, { cwd: resolve(import.meta.dirname, '..') }), 'existing data cannot be overwritten');
  } finally { await rm(root, { recursive: true, force: true }); }
});
