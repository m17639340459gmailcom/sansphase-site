import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export function productionOptions(env:Record<string,string|undefined>, nodeVersion=process.versions.node) {
  if (env.NODE_ENV !== 'production') throw Error('NODE_ENV must be production');
  // systemd runs Node directly; package-manager engine checks alone do not
  // prevent an old binary from starting an already installed release.
  const version=/^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
  if (!version || Number(version[1]) !== 24 || Number(version[2]) < 21)
    throw Error('Production requires Node.js >=24.21.0 <25; update the Node 24 security patch before starting.');
  let origin;
  try {origin=new URL(env.SITE_ORIGIN || '');} catch {throw Error('SITE_ORIGIN must be an HTTPS origin');}
  if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash)
    throw Error('SITE_ORIGIN must contain only an HTTPS origin');
  const configPath=env.PAYLOAD_CONFIG_FILE;
  if(!configPath || !isAbsolute(configPath)) throw Error('PAYLOAD_CONFIG_FILE must be an absolute private path');
  const port=Number(env.PORT||4176);
  if(!Number.isInteger(port)||port<1024||port>65535) throw Error('PORT must be between 1024 and 65535');
  const host=env.HOST||'127.0.0.1';
  if(!['127.0.0.1','::1'].includes(host)) throw Error('Production app must listen on loopback behind the HTTPS proxy');
  return {origin:origin.origin,configPath,port,host};
}

export async function verifyBuild(root:string) {
  const base=await realpath(root);
  const manifest=JSON.parse(await readFile(resolve(base,'build-info.json'),'utf8'));
  if(!manifest.release||!Array.isArray(manifest.files)||!manifest.files.length) throw Error('Build manifest is missing or invalid');
  for(const entry of manifest.files) {
    const path=await realpath(resolve(base,entry.path));
    if(!path.startsWith(base+sep)||!(await lstat(path)).isFile()) throw Error('Unsafe build file');
    const data=await readFile(path);
    if(data.length!==entry.bytes || createHash('sha256').update(data).digest('hex')!==entry.sha256)
      throw Error(`Build verification failed: ${entry.path}`);
  }
  return manifest;
}

export async function verifyPrivateConfig(configPath:string, root:string) {
  const path=await realpath(configPath), publicRoot=await realpath(root);
  if(path===publicRoot||path.startsWith(publicRoot+sep)) throw Error('Private configuration cannot be in the public directory');
  const settings=JSON.parse(await readFile(path,'utf8'));
  if(!isAbsolute(settings.directory||'')) throw Error('Production data directory must be absolute');
  const directory=await realpath(settings.directory);
  if(directory===publicRoot||directory.startsWith(publicRoot+sep)) throw Error('Database and uploads cannot be in the public directory');
  if(!settings.secret||settings.secret.length<32||!settings.authorId) throw Error('Private author configuration is incomplete');
  return settings;
}
