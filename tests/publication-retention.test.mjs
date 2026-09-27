import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prunePublications } from '../scripts/publication-retention.mjs';

test('publication cleanup keeps current, recent, latest three and unmarked directories', async t => {
  const base=await mkdtemp(resolve(tmpdir(),'publication-retention-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const now=Date.now(), ages=[0,1,2,3,10,11,12];
  for(let i=0;i<ages.length;i++) {
    const dir=resolve(base,`sansphase-site-${i}`);await mkdir(dir);
    if(i!==5) await writeFile(resolve(dir,'.publication-complete.json'),JSON.stringify({kind:'sansphase-publication',createdAt:new Date(now-ages[i]*86400000).toISOString()}));
  }
  const current=resolve(base,'sansphase-site-6');
  assert.deepEqual(await prunePublications(base,current,now),[resolve(base,'sansphase-site-4')]);
  for(const i of [0,1,2,3,5,6]) await access(resolve(base,`sansphase-site-${i}`));
  await assert.rejects(access(resolve(base,'sansphase-site-4')));
});
