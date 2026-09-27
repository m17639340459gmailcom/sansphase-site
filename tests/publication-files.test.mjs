import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { scanPublication } from '../scripts/publication-files.mjs';

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
