import {migrateShowcaseCover} from '../server/payload/showcase-cover-migration.ts';
if(!process.argv[2])throw Error('Usage: node scripts/migrate-showcase-cover.mjs <private-payload-directory>');
console.log(JSON.stringify(await migrateShowcaseCover(process.argv[2])));
