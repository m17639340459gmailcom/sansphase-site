import { resolve } from 'node:path';
import { backupCommunity, verifyCommunityBackup } from '../server/community-host-backup.ts';

const [target, publicRoot = resolve('dist')] = process.argv.slice(2);
if (target === '--verify') {
  const path = process.argv[3];
  if (!path) throw Error('Usage: node scripts/backup-community.mjs --verify ABSOLUTE_BACKUP_DIRECTORY');
  console.log(JSON.stringify(await verifyCommunityBackup(path)));
} else {
  const configPath = process.env.COMMUNITY_CONFIG_FILE;
  if (!configPath || !target) throw Error('Usage: COMMUNITY_CONFIG_FILE=<private config> node scripts/backup-community.mjs ABSOLUTE_BACKUP_DIRECTORY [PUBLIC_ROOT]');
  const result = await backupCommunity({ configPath, target, publicRoot });
  console.log(JSON.stringify({ directory: result.directory, files: result.manifest.files.length, verified: true }));
}
