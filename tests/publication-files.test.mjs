import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { publicationFiles, scanPublication } from '../scripts/publication-files.mjs';

test('publication includes relative imports of every shipped build and runtime script',async()=>{
  const root=resolve('.');
  const files=new Set(await publicationFiles(root));
  for(const file of files) {
    if(!file.startsWith('scripts/')||!file.endsWith('.mjs'))continue;
    const text=await readFile(resolve(root,file),'utf8');
    for(const match of text.matchAll(/\b(?:from\s*|import\s*\()\s*['"](\.[^'"]+\.mjs)['"]/g)) {
      const dependency=relative(root,resolve(dirname(resolve(root,file)),match[1])).replaceAll('\\','/');
      assert.ok(files.has(dependency),`${file} imports missing publication file ${dependency}`);
    }
  }
});

test('publication scan rejects credentials without revealing their values',async t=>{
  const root=await mkdtemp(resolve(tmpdir(),'sansphase-publication-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const secret='isolated-test-secret-value';
  await writeFile(resolve(root,'leak.json'),JSON.stringify({value:secret}));
  await writeFile(resolve(root,'safe.mjs'),'export const publicValue=1;');
  const report=await scanPublication(root,['.local/private.json','leak.json','safe.mjs'],[secret]);
  assert.equal(report.length,2);
  assert.ok(report.some(x=>x.reason==='known-private-value'));
  assert.ok(report.some(x=>x.reason==='private-or-generated-path'));
  assert.ok(!JSON.stringify(report).includes(secret));
});
