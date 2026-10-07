import { resolve } from 'node:path';
import { migrateReaderProfileWorkflow } from '../server/reader-profile-workflow-migration.ts';

const [directory] = process.argv.slice(2);
if (!directory) throw Error('Usage: node scripts/migrate-reader-profiles.mjs PRIVATE_DATA_DIRECTORY');
console.log(JSON.stringify(await migrateReaderProfileWorkflow(resolve(directory))));
