import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { migrateContentOrder } from '../server/payload/content-order-migration.ts';
import { migrateShowcaseCover } from '../server/payload/showcase-cover-migration.ts';
import { migrateReaderAccounts } from '../server/payload/reader-migration.ts';
import { migrateVipBooks } from '../server/payload/vip-book-migration.ts';

// Local-only isolated preview: no changes to the current database or website.
const sourceSettings = JSON.parse(await readFile(process.env.PAYLOAD_CONFIG_FILE || '.local/payload-env.json', 'utf8'));
const source = resolve(sourceSettings.directory);
const preview = await mkdtemp(resolve('.local', 'reader-preview-'));
const directory = resolve(preview, 'payload');
await mkdir(directory);
await mkdir(resolve(directory, 'uploads'));
const liveDb = new DatabaseSync(resolve(source, 'content.db'), { readOnly: true });
try { await backup(liveDb, resolve(directory, 'content.db')); }
finally { liveDb.close(); }
await copyFile(resolve(source, 'migration-complete.json'), resolve(directory, 'migration-complete.json'));
for (const entry of await readdir(resolve(source, 'uploads'), { withFileTypes: true }))
  if (entry.isFile()) await copyFile(resolve(source, 'uploads', entry.name), resolve(directory, 'uploads', entry.name));
await migrateContentOrder(directory);
await migrateShowcaseCover(directory);
await migrateReaderAccounts(directory);
await migrateVipBooks(directory);
const port = Number(process.env.PORT || 4194);
const siteOrigin = `http://127.0.0.1:${port}`;
const settingsPath = resolve(preview, 'settings.json');
const useLocalSmtp = process.env.READER_PREVIEW_SMTP === '1';
await writeFile(settingsPath, JSON.stringify({ ...sourceSettings, directory, siteOrigin, smtp: useLocalSmtp ? sourceSettings.smtp : undefined }), { mode: 0o600 });
process.env.PAYLOAD_CONFIG_FILE = settingsPath;
process.env.PORT = String(port);
process.env.HOST = '127.0.0.1';
console.log(`Reader preview: ${siteOrigin}/#/notes`);
console.log(`Reader management: ${siteOrigin}/manage/`);
console.log(`Preview uses an isolated database copy. Email registration: ${useLocalSmtp ? 'enabled through private local SMTP settings' : 'disabled'}.`);
await import('./dev.mjs');
