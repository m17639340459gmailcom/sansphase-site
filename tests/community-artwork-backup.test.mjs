import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const full = `community-image-${image}.webp`;
const thumb = `community-thumb-${image}.webp`;
async function fixture(t, referenced, missing = '') {
  const root = await mkdtemp(resolve(tmpdir(), 'sansphase-artwork-backup-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const directory = resolve(root, 'data'), target = resolve(root, 'backup');
  await mkdir(resolve(directory, 'uploads'), { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    db.exec('CREATE TABLE media(filename TEXT); CREATE TABLE community_images(id TEXT, topic_id TEXT); CREATE TABLE community_banner_entries(cover TEXT);');
    if (referenced === 'profile') db.exec('CREATE TABLE community_profile_backgrounds(approved_image TEXT,pending_image TEXT)');
    db.exec(referenced === 'legacy-shop' ? 'CREATE TABLE community_shop_items(id TEXT)' : 'CREATE TABLE community_shop_items(image TEXT)');
    db.prepare('INSERT INTO community_images(id,topic_id) VALUES(?,NULL)').run(image);
    if (referenced === 'banner') db.prepare('INSERT INTO community_banner_entries(cover) VALUES(?)').run(image);
    else if (referenced === 'profile') db.prepare('INSERT INTO community_profile_backgrounds(approved_image) VALUES(?)').run(image);
    else if (referenced === 'shop') db.prepare('INSERT INTO community_shop_items(image) VALUES(?)').run(image);
  } finally { db.close(); }
  if (missing !== full && missing !== 'both') await writeFile(resolve(directory, 'uploads', full), 'original-cover');
  if (missing !== thumb && missing !== 'both') await writeFile(resolve(directory, 'uploads', thumb), 'thumbnail-cover');
  await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
  const config = resolve(root, 'synthetic-settings.json');
  await writeFile(config, JSON.stringify({ directory }));
  const backup = () => run(process.execPath, ['scripts/backup-payload.mjs', target], {
    cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, PAYLOAD_CONFIG_FILE: config },
  });
  return { root, target, backup };
}

for (const reference of ['banner', 'shop', 'profile']) {
  test(`backups retain and restore both files of referenced ${reference} artwork`, async t => {
    const { root, target, backup } = await fixture(t, reference);
    await backup();
    const manifest = JSON.parse(await readFile(resolve(target, 'backup-manifest.json'), 'utf8'));
    for (const file of [full, thumb]) assert.ok(manifest.files.some(entry => entry.path === `uploads/${file}`));
    const restored = resolve(root, 'restored'), restoredConfig = resolve(root, 'restored-settings.json');
    await run(process.execPath, ['scripts/restore-payload.mjs', target, restored, restoredConfig], { cwd: resolve(import.meta.dirname, '..') });
    assert.equal(await readFile(resolve(restored, 'uploads', full), 'utf8'), 'original-cover');
    assert.equal(await readFile(resolve(restored, 'uploads', thumb), 'utf8'), 'thumbnail-cover');
  });
  for (const missing of [full, thumb]) test(`a missing ${missing.startsWith('community-thumb') ? 'thumbnail' : 'image'} of referenced ${reference} artwork blocks completion of the backup`, async t => {
    const { target, backup } = await fixture(t, reference, missing);
    await assert.rejects(backup(), 'persistently referenced artwork cannot be silently treated as a temporary upload');
    await assert.rejects(stat(resolve(target, 'backup-manifest.json')), { code: 'ENOENT' });
  });
}

test('an unreferenced upload removed by normal retention does not make a consistent data backup fail', async t => {
  const { target, backup } = await fixture(t, null, 'both');
  await backup();
  const manifest = JSON.parse(await readFile(resolve(target, 'backup-manifest.json'), 'utf8'));
  assert.ok(!manifest.files.some(entry => entry.path.includes(image)));
});

test('an older product schema can be backed up before adding the artwork column in migration', async t => {
  const { target, backup } = await fixture(t, 'legacy-shop', 'both');
  await backup();
  const manifest = JSON.parse(await readFile(resolve(target, 'backup-manifest.json'), 'utf8'));
  assert.ok(manifest.files.some(entry => entry.path === 'content.db'));
});
