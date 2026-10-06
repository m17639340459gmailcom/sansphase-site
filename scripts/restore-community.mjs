import { resolve } from 'node:path';
import { restoreCommunity } from '../server/community-host-backup.ts';

const [backupPath, target, configPath, publicRoot = resolve('dist')] = process.argv.slice(2);
if (!backupPath || !target || !configPath) throw Error('Usage: node scripts/restore-community.mjs ABSOLUTE_BACKUP NEW_ABSOLUTE_DATA_DIRECTORY NEW_ABSOLUTE_PRIVATE_CONFIG [PUBLIC_ROOT]');
console.log(JSON.stringify(await restoreCommunity({ backupPath, target, configPath, publicRoot })));
