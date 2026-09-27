import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

export async function createBuildManifest(root, version) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('Build output must not contain symlinks');
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name !== 'build-info.json') {
        const bytes = await readFile(path);
        files.push({path:relative(root,path).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      }
    }
  }
  await visit(resolve(root));
  const id=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,16);
  const manifest={version,release:`${version}-${id}`,builtAt:new Date().toISOString(),files};
  await writeFile(resolve(root,'build-info.json'),JSON.stringify(manifest,null,2));
  return manifest;
}
