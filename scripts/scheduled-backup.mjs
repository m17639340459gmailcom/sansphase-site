import { mkdir, statfs, readdir, stat, realpath, readFile } from 'node:fs/promises';
import { resolve, isAbsolute, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const configPath=process.env.PAYLOAD_CONFIG_FILE;
const destination=process.env.BACKUP_DIRECTORY;
if(!configPath||!isAbsolute(destination||'')) throw Error('Set PAYLOAD_CONFIG_FILE and an absolute BACKUP_DIRECTORY');
const settings=JSON.parse(await readFile(configPath,'utf8'));
const source=await realpath(settings.directory);
await mkdir(destination,{recursive:true,mode:0o700});
const target=await realpath(destination);
if(target===source||target.startsWith(source+sep)||target===resolve('dist')||target.startsWith(resolve('dist')+sep))
  throw Error('Backup directory must be outside the database and public directory');
let required=(await stat(resolve(source,'content.db'))).size+512*1024**2;
for(const entry of await readdir(resolve(source,'uploads'),{withFileTypes:true}))
  if(entry.isFile()) required+=(await stat(resolve(source,'uploads',entry.name))).size;
const disk=await statfs(target);
if(disk.bavail*disk.bsize<required) throw Error('Not enough free space for a complete backup; no older backup was deleted');
const name=`payload-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`;
await promisify(execFile)(process.execPath,['scripts/backup-payload.mjs',resolve(target,name)],{env:process.env,timeout:6*60*60*1000});
console.log(JSON.stringify({event:'backup-complete',name,at:new Date().toISOString()}));
