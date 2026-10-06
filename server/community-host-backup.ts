import { DatabaseSync, backup } from 'node:sqlite';
import { chmod, copyFile, lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { fileHash } from './file-hash.ts';
import { readCommunityHostConfig } from './community-host-runtime.ts';

type Entry = { path: string; bytes: number; sha256: string };
export type CommunityBackupManifest = { provider: 'sansphase-community'; version: 1; createdAt: string; files: Entry[] };
type BackupOptions = { configPath: string; target: string; publicRoot: string };
type RestoreOptions = { backupPath: string; target: string; configPath: string; publicRoot: string };
const under = (path: string, root: string) => path === root || path.startsWith(root + sep);
const safeRelative = (path: unknown): path is string => typeof path === 'string' && Boolean(path) && !path.includes('\\') && !path.includes(':') && !/[\u0000-\u001f\u007f]/u.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..') && !path.startsWith('/');
export async function absoluteNoSymlinks(path: string) {
  if (!isAbsolute(path)) throw Error('Backup paths must be absolute.');
  const root = parse(resolve(path)).root;
  const parts = relative(root, resolve(path)).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('Backup paths must not contain symlinks.'); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') break; throw error; }
  }
  return resolve(path);
}
async function collect(directory: string, prefix = ''): Promise<string[]> {
  const root = await lstat(directory);
  if (root.isSymbolicLink() || !root.isDirectory()) throw Error('Backup source directory must not be a symlink.');
  const files: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (!safeRelative(path)) throw Error('Unsafe backup path.');
    const item = await lstat(resolve(directory, name));
    if (item.isSymbolicLink()) throw Error('Backup source contains a symlink; preserving source unchanged.');
    if (item.isDirectory()) files.push(...await collect(resolve(directory, name), path));
    else if (item.isFile()) files.push(path);
    else throw Error('Backup source contains an unsupported file type.');
  }
  return files;
}
async function requireAbsent(path: string) {
  try { await lstat(path); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return; throw error; }
  throw Error('Backup and restore never overwrite an existing destination.');
}
async function sqliteIntegrity(path: string, role: 'content' | 'host') {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw Error('Community backup SQLite integrity check failed.');
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    if (role === 'content') {
      if (tables.has('readers') || tables.has('authors') || !tables.has('community_topics')) throw Error('Backup contains main-site accounts or an invalid community database.');
    } else if (!tables.has('community_host_sessions') || !tables.has('community_host_nonces') || !tables.has('community_host_file_queue')) throw Error('Backup community session database is invalid.');
  } finally { db.close(); }
}
async function snapshotSqlite(source: string, destination: string) {
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, destination); } finally { db.close(); }
  if (process.platform !== 'win32') await chmod(destination, 0o600);
}
async function copyPrivate(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  if ((await lstat(source)).isSymbolicLink()) throw Error('Backup source contains a symlink.');
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  if (process.platform !== 'win32') await chmod(destination, 0o600);
}
async function referencedImagesPresent(directory: string) {
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try {
    // A pre-upgrade snapshot must remain usable before the new profile tables
    // are created. Include the reference only when that optional table exists.
    const profiles = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_profile_backgrounds'").get()
      ? 'OR EXISTS(SELECT 1 FROM community_profile_backgrounds p WHERE p.approved_image=i.id OR p.pending_image=i.id)' : '';
    const images = db.prepare(`SELECT i.id FROM community_images i WHERE i.deleted_at IS NULL AND
      (i.topic_id IS NOT NULL OR EXISTS(SELECT 1 FROM community_shop_items s WHERE s.image=i.id)
      OR EXISTS(SELECT 1 FROM community_banner_entries b WHERE b.cover=i.id)
      ${profiles})`).all() as Array<{ id: string }>;
    for (const { id } of images) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw Error('Backup image registry contains an invalid identifier.');
      for (const kind of ['image', 'thumb']) {
        const path = resolve(directory, 'uploads', `community-${kind}-${id}.webp`);
        const imageStat = await lstat(path);
        if (!imageStat.isFile() || imageStat.isSymbolicLink()) throw Error('A referenced community image is absent from the backup.');
      }
    }
  } finally { db.close(); }
}

export async function backupCommunity({ configPath, target, publicRoot }: BackupOptions) {
  const sourceConfig = await absoluteNoSymlinks(configPath);
  const settings = await readCommunityHostConfig(sourceConfig, publicRoot);
  const source = await absoluteNoSymlinks(settings.directory);
  const destination = await absoluteNoSymlinks(target);
  const publicPath = await realpath(publicRoot);
  if (under(destination, source) || under(source, destination) || under(destination, publicPath)) throw Error('Backup destination must be separate from source and public directories.');
  await requireAbsent(destination);
  const files = (await collect(resolve(source, 'uploads'))).map(path => `uploads/${path}`);
  for (const filename of ['migration-complete.json', 'community-migration-complete.json', 'community-migration.json', 'community-words.txt', 'community-admin-audit.jsonl']) {
    try {
      const file = await lstat(resolve(source, filename));
      if (!file.isFile() || file.isSymbolicLink()) throw Error('Backup metadata contains a symlink or unexpected type.');
      files.push(filename);
    } catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
  }
  try { files.push(...(await collect(resolve(source, 'schema-backups'))).map(path => `schema-backups/${path}`)); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
  await mkdir(destination, { recursive: false, mode: 0o700 });
  await mkdir(resolve(destination, 'uploads'), { mode: 0o700 });
  await snapshotSqlite(resolve(source, 'content.db'), resolve(destination, 'content.db'));
  await snapshotSqlite(resolve(source, 'community-host.db'), resolve(destination, 'community-host.db'));
  await copyPrivate(sourceConfig, resolve(destination, 'settings.json'));
  for (const path of files) await copyPrivate(resolve(source, path), resolve(destination, path));
  await sqliteIntegrity(resolve(destination, 'content.db'), 'content');
  await sqliteIntegrity(resolve(destination, 'community-host.db'), 'host');
  await referencedImagesPresent(destination);
  const entries: Entry[] = [];
  for (const path of ['content.db', 'community-host.db', 'settings.json', ...files].sort()) entries.push({ path, bytes: (await stat(resolve(destination, path))).size, sha256: await fileHash(resolve(destination, path)) });
  const manifest: CommunityBackupManifest = { provider: 'sansphase-community', version: 1, createdAt: new Date().toISOString(), files: entries };
  await writeFile(resolve(destination, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  await verifyCommunityBackup(destination);
  return { directory: destination, manifest };
}

export async function verifyCommunityBackup(backupPath: string) {
  const root = await absoluteNoSymlinks(backupPath);
  const parsed: unknown = JSON.parse(await readFile(resolve(root, 'backup-manifest.json'), 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !('provider' in parsed) || parsed.provider !== 'sansphase-community' || !('version' in parsed) || parsed.version !== 1 || !('files' in parsed) || !Array.isArray(parsed.files) || !parsed.files.length) throw Error('Invalid independent community backup manifest.');
  const paths = new Set<string>();
  for (const entry of parsed.files) {
    if (!entry || typeof entry !== 'object' || !safeRelative(entry.path) || paths.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw Error('Unsafe or duplicate backup manifest path.');
    paths.add(entry.path);
    const path = await absoluteNoSymlinks(resolve(root, entry.path));
    if (!under(path, root)) throw Error('Unsafe backup path.');
    const file = await lstat(path);
    if (!file.isFile()) throw Error('Backup manifest must refer only to files.');
    if (file.size !== entry.bytes) throw Error(`Backup size mismatch: ${entry.path}`);
    if (await fileHash(path) !== entry.sha256) throw Error(`Backup checksum mismatch: ${entry.path}`);
  }
  for (const required of ['content.db', 'community-host.db', 'settings.json']) if (!paths.has(required)) throw Error('Independent community backup is incomplete.');
  await sqliteIntegrity(resolve(root, 'content.db'), 'content');
  await sqliteIntegrity(resolve(root, 'community-host.db'), 'host');
  await referencedImagesPresent(root);
  return { directory: root, files: paths.size, manifest: parsed as CommunityBackupManifest };
}

export async function restoreCommunity({ backupPath, target, configPath, publicRoot }: RestoreOptions) {
  const checked = await verifyCommunityBackup(backupPath);
  const destination = await absoluteNoSymlinks(target), config = await absoluteNoSymlinks(configPath), publicPath = await realpath(publicRoot);
  const original: unknown = JSON.parse(await readFile(resolve(checked.directory, 'settings.json'), 'utf8'));
  if (!original || typeof original !== 'object' || !('directory' in original) || typeof original.directory !== 'string' || !isAbsolute(original.directory)) throw Error('Invalid backed-up community settings.');
  const previous = resolve(original.directory);
  if (under(destination, previous) || under(previous, destination) || under(destination, checked.directory) || under(checked.directory, destination) || under(destination, publicPath) || under(config, publicPath) || under(config, destination) || under(config, previous) || under(config, checked.directory)) throw Error('Restore must use separate private new data and config paths.');
  await requireAbsent(destination); await requireAbsent(config);
  await mkdir(destination, { mode: 0o700, recursive: false });
  await mkdir(resolve(destination, 'uploads'), { mode: 0o700 });
  for (const entry of checked.manifest.files) if (entry.path !== 'settings.json') await copyPrivate(resolve(checked.directory, entry.path), resolve(destination, entry.path));
  // A restored business snapshot must not revive browsers' previous entry
  // authorization. Retain purge/file retry state and replay nonces, but force
  // every browser to acquire a fresh handoff from the main site.
  const host = new DatabaseSync(resolve(destination, 'community-host.db'));
  try { host.exec('BEGIN IMMEDIATE; DELETE FROM community_host_sessions; DELETE FROM community_host_entry_rates; COMMIT; PRAGMA wal_checkpoint(TRUNCATE)'); }
  finally { host.close(); }
  await sqliteIntegrity(resolve(destination, 'content.db'), 'content');
  await sqliteIntegrity(resolve(destination, 'community-host.db'), 'host');
  await referencedImagesPresent(destination);
  // The only adjusted setting is the data directory. The new configuration is
  // exclusive and does not activate/switch the running production service.
  await writeFile(config, JSON.stringify({ ...original, directory: destination }, null, 2), { mode: 0o600, flag: 'wx' });
  await readCommunityHostConfig(config, publicRoot);
  return { directory: destination, configPath: config, files: checked.files };
}
