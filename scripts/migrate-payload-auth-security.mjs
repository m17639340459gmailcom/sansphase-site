import { resolve } from 'node:path';
import { migratePayloadAuthSecurity } from '../server/payload/auth-security-migration.ts';
if (process.argv.length !== 3) throw new Error('Usage: node scripts/migrate-payload-auth-security.mjs <private-payload-directory>');
console.log(JSON.stringify(await migratePayloadAuthSecurity(resolve(process.argv[2]))));
