import {migrateVipBooks} from '../server/payload/vip-book-migration.ts';
if(!process.argv[2])throw Error('Usage: node scripts/migrate-vip-books.mjs <private-payload-directory>');
console.log(JSON.stringify(await migrateVipBooks(process.argv[2])));
