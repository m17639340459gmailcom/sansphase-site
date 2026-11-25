import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { frontendV3AppPath, frontendV3ReceiptPath, verifyFrontendV3Release } from './frontend-v3-release.mjs';

/** Selection changes documents, never the content/authentication runtime. */
export function frontendVersion(value) {
  if (value === undefined) return 'v1';
  if (!['v1', 'v2', 'v3'].includes(value)) throw Error('SITE_FRONTEND / --frontend must be v1, v2 or v3.');
  return value;
}

export function frontendArgument(args = process.argv.slice(2), env = process.env) {
  const parsed = parseArgs({args,options:{frontend:{type:'string'}},tokens:true,strict:true,allowPositionals:false});
  if (parsed.tokens.filter(token=>token.kind==='option' && token.name==='frontend').length > 1)
    throw Error('Specify --frontend only once.');
  return frontendVersion(parsed.values.frontend ?? env.SITE_FRONTEND);
}

/** verifyBuild checks every byte first. This additionally verifies that an
 * explicitly selected UI has all of the assets referenced by its own manifest. */
export async function verifyFrontendBuild(root, manifest, frontend, workspace = resolve(root, '..')) {
  const selected = frontendVersion(frontend);
  if (selected === 'v3') return verifyFrontendV3Release(root, manifest, resolve(workspace, frontendV3AppPath));
  if (manifest.files.some(file => file.path === frontendV3ReceiptPath)) {
    throw Error('This release requires SITE_FRONTEND=v3. Use a separate release to roll back.');
  }
  if (selected === 'v1') return;
  const paths = new Set(manifest.files.map(file=>file.path));
  for (const path of ['index.html','style.css','third-party-notices.txt','build-manifest.json'])
    if (!paths.has('frontend-v2/'+path)) throw Error('Missing frontend-v2 build asset: '+path);
  const delivery = JSON.parse(await readFile(resolve(root,'frontend-v2/build-manifest.json'),'utf8'));
  const asset = path => typeof path === 'string' && /^\/build\/[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Z0-9]{8}\.(?:js|css|woff2?|ttf)$/.test(path);
  if (delivery.version !== 1 || !asset(delivery.script) || !delivery.script.endsWith('.js')
    || !asset(delivery.stylesheet) || !delivery.stylesheet.endsWith('.css')
    || !Array.isArray(delivery.assets) || delivery.assets.some(path=>!asset(path))
    || !delivery.assets.includes(delivery.script) || !delivery.assets.includes(delivery.stylesheet)
    || new Set(delivery.assets).size !== delivery.assets.length)
    throw Error('Invalid frontend-v2 delivery manifest.');
  for (const path of delivery.assets)
    if (!paths.has('frontend-v2'+path)) throw Error('Missing frontend-v2 build asset: '+path);
}
