import { resolve } from 'node:path';
import { migrateReaderAccounts } from '../server/payload/reader-migration.mjs';
if (!process.argv[2]) throw Error('Usage: node scripts/migrate-reader-accounts.mjs <private-payload-directory>');
console.log(JSON.stringify(await migrateReaderAccounts(resolve(process.argv[2]))));
