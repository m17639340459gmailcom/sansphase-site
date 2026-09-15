import { readFile, mkdir, mkdtemp, copyFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { publicationFiles, scanPublication } from './publication-files.mjs';

const root=resolve('.');
const files=await publicationFiles(root);
const privateValues=[];
for(const file of ['.local/payload-env.json','.local/site-env.json']) {
  try {
    const config=JSON.parse(await readFile(file,'utf8'));
    for(const [key,value] of Object.entries(config)) if(/secret|password|token/i.test(key)&&typeof value==='string') privateValues.push(value);
  } catch(error) {if(error.code!=='ENOENT') throw error;}
}
// The contents of any legacy credential note are compared in memory only.
try {
  const note=await readFile('.local/author-access.txt','utf8');
  for(const line of note.split(/\r?\n/)) {
    const match=/(?:password|密码|secret|token)\s*[:：=]\s*(.+)/i.exec(line);
    if(match) privateValues.push(match[1].trim());
  }
} catch(error) {if(error.code!=='ENOENT') throw error;}
const issues=await scanPublication(root,files,privateValues);
if(issues.length) {
  console.error(JSON.stringify({status:'blocked',issues},null,2));
  process.exitCode=1;
} else {
  const base=resolve('.local/publication');
  await mkdir(base,{recursive:true});
  const target=await mkdtemp(resolve(base,'sansphase-site-'));
  const manifest=[];
  for(const file of files) {
    const destination=resolve(target,file);
    await mkdir(dirname(destination),{recursive:true});
    await copyFile(resolve(root,file),destination);
    manifest.push({file,bytes:(await stat(destination)).size,sha256:createHash('sha256').update(await readFile(destination)).digest('hex')});
  }
  await writeFile(resolve(base,'latest.json'),JSON.stringify({directory:target,files:manifest,createdAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({status:'prepared-not-published',directory:target,files:files.length,privateValueMatches:0},null,2));
}
