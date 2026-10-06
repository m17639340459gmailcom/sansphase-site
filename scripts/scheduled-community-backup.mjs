import { mkdir, readdir, stat, statfs, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { absoluteNoSymlinks, backupCommunity } from '../server/community-host-backup.ts';
import { readCommunityHostConfig } from '../server/community-host-runtime.ts';

const configPath = process.env.COMMUNITY_CONFIG_FILE;
const destination = process.env.COMMUNITY_BACKUP_DIRECTORY;
if (!configPath || !isAbsolute(configPath) || !isAbsolute(destination || '')) throw Error('Private community config and an absolute backup parent are required.');
const publicRoot = await realpath('dist');
const settings = await readCommunityHostConfig(configPath, publicRoot);
const source = await absoluteNoSymlinks(settings.directory), target = await absoluteNoSymlinks(destination);
const nested = (first, second) => first === second || first.startsWith(second + sep);
if (nested(target, source) || nested(source, target) || nested(target, publicRoot) || nested(publicRoot, target)) throw Error('Backup parent must be separate from data and public directories.');
await mkdir(target, { recursive: true, mode: 0o700 });
async function totalBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Community backup source contains a symlink.');
    if (entry.isDirectory()) bytes += await totalBytes(path);
    else if (entry.isFile()) bytes += (await stat(path)).size;
    else throw Error('Unsupported community backup source file.');
  }
  return bytes;
}
const disk = await statfs(target), required = await totalBytes(source) + 512 * 1024 ** 2;
if (disk.bavail * disk.bsize < required) throw Error('Not enough space for a complete backup; existing backups are preserved.');
const name = `community-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
const result = await backupCommunity({ configPath, target: resolve(target, name), publicRoot });
console.log(JSON.stringify({ event: 'community-backup-complete', name, files: result.manifest.files.length, verified: true }));
