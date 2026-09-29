import {migrateContentOrder} from '../server/payload/content-order-migration.ts';
if(!process.argv[2])throw Error('Usage: node scripts/migrate-content-order.mjs <private-payload-directory>');
console.log(JSON.stringify(await migrateContentOrder(process.argv[2])));
