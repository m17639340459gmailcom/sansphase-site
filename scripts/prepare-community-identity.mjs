import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { verifyPrivateConfig } from '../server/production-config.ts';
import { readMainCommunityIdentitySettings } from '../server/payload/runtime.ts';
import { prepareIdentityStore } from '../server/community-identity-store.ts';

// Explicit maintenance entry; production startup never creates bridge state.
const path = process.env.PAYLOAD_CONFIG_FILE;
if (!path || !isAbsolute(path)) throw Error('An absolute private PAYLOAD_CONFIG_FILE is required.');
const stat = await lstat(path);
if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077)) throw Error('Private regular configuration required.');
const settings = await verifyPrivateConfig(path, resolve('dist'));
if (!isAbsolute(settings.directory || '') || settings.siteOrigin !== 'https://www.sansphase.com' || !readMainCommunityIdentitySettings(settings)) throw Error('Approved main-site identity configuration required.');
const dataStat = await lstat(settings.directory);
if (!dataStat.isDirectory() || dataStat.isSymbolicLink() || await realpath(settings.directory) !== resolve(settings.directory)) throw Error('Identity data directory must not contain symlinks.');
console.log(JSON.stringify({ prepared: true, ...prepareIdentityStore(settings.directory) }));
