import { resolve } from 'node:path';
import { migrateReaderInvitations } from '../server/payload/invitation-migration.ts';

if (process.argv.length !== 3) throw Error('Usage: node scripts/migrate-reader-invitations.ts <private-payload-directory>');
console.log(JSON.stringify(await migrateReaderInvitations(resolve(process.argv[2]))));
