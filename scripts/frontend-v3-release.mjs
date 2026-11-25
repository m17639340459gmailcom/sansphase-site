import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export const frontendV3AppPath = 'previews/frontend-v3';
export const frontendV3ReceiptPath = 'frontend-v3.json';
const releaseDirectory = /^\.next-release-([a-f0-9]{16}|[a-f0-9]{24})$/;
const required = ['BUILD_ID', 'routes-manifest.json', 'required-server-files.json', 'server/app-paths-manifest.json'];

export function frontendV3StaticPrefix(buildDirectory) {
  const id = releaseDirectory.exec(buildDirectory)?.[1];
  return id?.length === 24 ? `assets/site/${id}` : null;
}

/** Only the public Next build outputs referenced by browser assets. */
export async function frontendV3StaticFiles(appDirectory, buildDirectory, buildId) {
  if (!frontendV3StaticPrefix(buildDirectory) || !/^[A-Za-z0-9_-]{1,100}$/.test(buildId)) throw Error('Invalid frontend-v3 static build');
  const staticRoot = resolve(appDirectory, buildDirectory, 'static');
  if (!(await lstat(staticRoot)).isDirectory()) throw Error('Unsafe frontend-v3 static directory');
  const files = [];
  for (const [bucket, pattern] of [
    ['chunks', /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:js|css)$/],
    ['media', /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:woff2?|ttf|svg)$/],
    [buildId, /^_(?:buildManifest|clientMiddlewareManifest|ssgManifest)\.js$/],
  ]) {
    const directory = resolve(staticRoot, bucket);
    if (!(await lstat(directory)).isDirectory()) throw Error('Unsafe frontend-v3 static directory');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (!pattern.test(entry.name)) continue;
      if (!entry.isFile()) throw Error('Unsafe frontend-v3 static asset');
      const data = await readFile(resolve(directory, entry.name));
      files.push({ path:`_next/static/${bucket}/${entry.name}`, bytes:data.length, sha256:createHash('sha256').update(data).digest('hex') });
    }
  }
  if (!files.some(({path}) => path.startsWith('_next/static/chunks/') && path.endsWith('.js'))) throw Error('Missing frontend-v3 browser scripts');
  return files;
}

async function hashFile(path) {
  if (!(await lstat(path)).isFile()) throw Error('Unsafe frontend-v3 release file');
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function createFrontendV3Receipt(appDirectory, buildDirectory) {
  if (typeof buildDirectory !== 'string' || !releaseDirectory.test(buildDirectory)) throw Error('Invalid frontend-v3 build directory');
  const app = await realpath(appDirectory);
  const build = resolve(app, buildDirectory);
  if (!(await lstat(build)).isDirectory() || await realpath(build) !== build) throw Error('Unsafe frontend-v3 release directory');
  const hash = createHash('sha256');
  const add = async path => hash.update(JSON.stringify([path, await hashFile(resolve(build, path))]));
  async function visit(directory) {
    if (!(await lstat(resolve(build, directory))).isDirectory()) throw Error('Unsafe frontend-v3 release directory');
    const entries = await readdir(resolve(build, directory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = directory + '/' + entry.name;
      // Next may fill its own mutable route cache while serving requests.
      if (path === 'server/route-cache') continue;
      if (entry.isDirectory()) await visit(path);
      else await add(path);
    }
  }
  await visit('server');
  await visit('static');
  for (const file of required) await add(file);
  const buildId = (await readFile(resolve(build, 'BUILD_ID'), 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(buildId)) throw Error('Invalid frontend-v3 build ID');
  const prefix = frontendV3StaticPrefix(buildDirectory);
  if (prefix) {
    const runtime = JSON.parse(await readFile(resolve(build, 'required-server-files.json'), 'utf8'));
    if (runtime.config?.assetPrefix !== '/' + prefix) throw Error('Missing frontend-v3 asset prefix in compiled configuration');
  }
  return { version: 1, buildDirectory, buildId, integrity: hash.digest('hex'), lock: await hashFile(resolve(app, 'package-lock.json')) };
}

export async function verifyFrontendV3Release(root, manifest, appDirectory) {
  if (!manifest.files.some(file => file.path === frontendV3ReceiptPath)) throw Error('Missing frontend-v3 release receipt.');
  const receipt = JSON.parse(await readFile(resolve(root, frontendV3ReceiptPath), 'utf8'));
  if (!receipt || receipt.version !== 1 || typeof receipt.buildDirectory !== 'string' || !releaseDirectory.test(receipt.buildDirectory)) throw Error('Invalid frontend-v3 release receipt.');
  const current = await createFrontendV3Receipt(appDirectory, receipt.buildDirectory);
  if (receipt.buildId !== current.buildId || receipt.integrity !== current.integrity || receipt.lock !== current.lock) throw Error('Frontend-v3 runtime integrity verification failed.');
  const prefix = frontendV3StaticPrefix(current.buildDirectory);
  if (prefix) {
    const retained = new Map(manifest.files.filter(file => file.path.startsWith(prefix + '/_next/static/')).map(file => [file.path, file]));
    for (const asset of await frontendV3StaticFiles(appDirectory, current.buildDirectory, current.buildId)) {
      const copy = retained.get(prefix + '/' + asset.path);
      if (!copy || copy.sha256 !== asset.sha256 || copy.bytes !== asset.bytes) throw Error('Missing retained frontend-v3 asset: ' + asset.path);
      retained.delete(copy.path);
    }
    if (retained.size) throw Error('Unexpected retained frontend-v3 assets');
  }
  return { appDirectory, buildDirectory: current.buildDirectory };
}
