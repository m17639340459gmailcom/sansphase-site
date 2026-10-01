import {migrateCommunity} from '../server/payload/community-migration.ts';
if(!process.argv[2])throw Error('Usage: node scripts/migrate-community.mjs <private-payload-directory>');
console.log(JSON.stringify(await migrateCommunity(process.argv[2])));
