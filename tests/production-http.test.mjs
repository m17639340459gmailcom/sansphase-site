import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewServer} from '../server.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('health reports the running release and conceals backend failures',async()=>{
  let healthy=true;
  const server=createPreviewServer({release:'test-release',healthCheck:async()=>{if(!healthy) throw Error('private database path');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/healthz`;
  try {
    let response=await fetch(url);assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{status:'ok',release:'test-release'});
    assert.equal(response.headers.get('cache-control'),'no-store');
    healthy=false;response=await fetch(url);assert.equal(response.status,503);
    assert.doesNotMatch(await response.text(),/private database/);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('static ETags revalidate, hashed chunks cache and personalized HTML never caches',async t=>{
  const root=await mkdtemp(resolve(tmpdir(),'sansphase-cache-'));
  await mkdir(resolve(root,'chunks'));
  await writeFile(resolve(root,'index.html'),'<html><head></head><body></body></html>');
  await writeFile(resolve(root,'app.mjs'),'export const version=1;');
  await writeFile(resolve(root,'chunks/chunk-ABCDEFGH.mjs'),'export const chunk=1;');
  const logs=[];
  const server=createPreviewServer({root,requestLogger:event=>logs.push(event),contentService:{snapshot:async()=>({data:{notes:[]}})},authorService:{identity:async()=>({name:'private-author'})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  let response=await fetch(base+'/app.mjs?private=must-not-be-logged');
  const etag=response.headers.get('etag');await response.text();
  assert.ok(etag);
  response=await fetch(base+'/app.mjs',{headers:{'If-None-Match':etag}});
  assert.equal(response.status,304);assert.equal(await response.text(),'');
  await writeFile(resolve(root,'app.mjs'),'export const version=2222;');
  response=await fetch(base+'/app.mjs',{headers:{'If-None-Match':etag}});
  assert.equal(response.status,200);assert.match(await response.text(),/2222/);
  response=await fetch(base+'/chunks/chunk-ABCDEFGH.mjs');
  assert.match(response.headers.get('cache-control'),/immutable/);await response.text();
  for(const path of ['/','/api/content']) {
    response=await fetch(base+path,{headers:{'If-None-Match':'*'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('etag'),null);assert.match(await response.text(),/private-author/);
  }
  assert.doesNotMatch(JSON.stringify(logs),/must-not-be-logged|private-author/);
});
