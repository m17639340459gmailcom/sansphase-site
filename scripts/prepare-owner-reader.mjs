import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { verifyPrivateConfig } from '../server/production-config.ts';
import { createReaderUidStore } from '../server/reader-uids.ts';
import { prepareOwnerReaderAccount, readOwnerReaderId, writeOwnerReaderBinding } from '../server/owner-reader.ts';

// Explicit maintenance entry only. Do not construct the normal runtime: its
// retention and cleanup tasks must not run during identity preparation.
const args = process.argv.slice(2);
if (!args.includes('--apply') || args.some(value => value !== '--apply' && !value.startsWith('--nickname=') && !value.startsWith('--public-root='))
  || args.filter(value => value === '--apply').length !== 1 || args.filter(value => value.startsWith('--nickname=')).length > 1 || args.filter(value => value.startsWith('--public-root=')).length > 1)
  throw Error('Usage: PAYLOAD_CONFIG_FILE=/absolute/private.json node scripts/prepare-owner-reader.mjs --apply --nickname=个人昵称 [--public-root=/absolute/public-root]');
const configPath = process.env.PAYLOAD_CONFIG_FILE;
if (!configPath || !isAbsolute(configPath)) throw Error('An absolute private PAYLOAD_CONFIG_FILE is required.');
const configStat = await lstat(configPath);
if (!configStat.isFile() || configStat.isSymbolicLink() || await realpath(configPath) !== resolve(configPath) || process.platform !== 'win32' && (configStat.mode & 0o077)) throw Error('Private regular configuration without symlinks required.');
const publicRoot = args.find(value => value.startsWith('--public-root='))?.slice('--public-root='.length) || resolve('dist');
if (!isAbsolute(publicRoot)) throw Error('Public root must be absolute.');
const expected = await readFile(configPath, 'utf8');
const settings = await verifyPrivateConfig(configPath, publicRoot);
if (settings.siteOrigin !== 'https://www.sansphase.com') throw Error('Approved main-site configuration required.');
const ownerReaderId = readOwnerReaderId(settings);
const directory = settings.directory;
const dataStat = await lstat(directory), dbStat = await lstat(resolve(directory, 'content.db'));
if (!dataStat.isDirectory() || dataStat.isSymbolicLink() || await realpath(directory) !== resolve(directory) || !dbStat.isFile() || dbStat.isSymbolicLink()) throw Error('Private data and database must be real directories and files without symlinks.');
const manifest = JSON.parse(await readFile(resolve(directory, 'migration-complete.json'), 'utf8'));
if (manifest.provider !== 'payload') throw Error('Payload migration validation is required before preparation.');
const lockPath = configPath + '.owner-reader.lock';
const lock = await open(lockPath, 'wx', 0o600);
let payload, uidStore;
try {
  await lock.writeFile(JSON.stringify({ operation: 'prepare-owner-reader', pid: process.pid }) + '\n'); await lock.sync();
  payload = await getPayload({ config: makePayloadConfig({ ...settings, push: false }) });
  uidStore = createReaderUidStore(directory);
  const result = await prepareOwnerReaderAccount({ payload, ownerId: settings.authorId, ownerReaderId,
    nickname: args.find(value => value.startsWith('--nickname='))?.slice('--nickname='.length), uidStore,
    saveBinding: id => writeOwnerReaderBinding(configPath, expected, id) });
  console.log(JSON.stringify({ prepared: true, ...result }));
} finally {
  uidStore?.close();
  if (payload) { await payload.destroy(); payload.db.client.close(); }
  await lock.close(); await unlink(lockPath);
}
