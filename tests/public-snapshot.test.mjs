import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createPublicSnapshotCache} from '../server/public-snapshot.ts';
import {createPublicationRevision} from '../server/payload/publication-revision.mjs';
import {createContentService} from '../server/content-service.ts';
import {createPreviewServer} from '../server.mjs';

test('simultaneous media reads share a snapshot; a committed change invalidates immediately',async()=>{
 let version=1,loads=0,published=true;
 const read=createPublicSnapshotCache({revision:()=>version,load:async()=>{loads++;await Promise.resolve();return {media:new Set(published?['image']:[]),expiresAt:Infinity};}});
 const values=await Promise.all(Array.from({length:12},()=>read()));
 assert.equal(loads,1);assert(values.every(x=>x.media.has('image')));
 await read();assert.equal(loads,1);
 published=false;version++;
 assert.equal((await read()).media.has('image'),false);assert.equal(loads,2);
});

test('a write during snapshot construction cannot populate the cache with stale permissions',async()=>{
 let version=1,loads=0;
 const read=createPublicSnapshotCache({revision:()=>version,load:async()=>{loads++;if(loads===1){version++;return {media:new Set(['withdrawn']),expiresAt:Infinity};}return {media:new Set(),expiresAt:Infinity};}});
 assert.equal((await read()).media.size,0);assert.equal(loads,2);
});

test('scheduled publication refreshes at its deadline; failed loads and revision reads never serve stale data',async()=>{
 let time=100,loads=0,broken=false,version=1;
 const read=createPublicSnapshotCache({revision:()=>{if(broken)throw Error('database unavailable');return version;},now:()=>time,load:async()=>({loads:++loads,expiresAt:150})});
 await read();time=149;await read();assert.equal(loads,1);
 time=150;await read();assert.equal(loads,2);
 broken=true;await assert.rejects(read(),/database unavailable/);
 let fail=true;
 const retry=createPublicSnapshotCache({revision:()=>version,load:async()=>{if(fail)throw Error('failed load');return {expiresAt:Infinity};}});
 await assert.rejects(retry(),/failed load/);fail=false;await retry();
});

test('publication revision notices commits by another SQLite connection, not uncommitted writes',async()=>{
 const directory=await mkdtemp(resolve(tmpdir(),'sansphase-revision-'));
 const writer=new DatabaseSync(resolve(directory,'content.db'));let tracker;
 try {
  writer.exec('CREATE TABLE example (id INTEGER)');tracker=createPublicationRevision(directory);
  const before=tracker.read();writer.exec('BEGIN; INSERT INTO example VALUES (1)');assert.equal(tracker.read(),before);
  writer.exec('COMMIT');assert.notEqual(tracker.read(),before);
 }finally{tracker?.close();writer.close();await rm(directory,{recursive:true,force:true});}
});

test('cached public content never retains author identity or another request preview',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const store={publicData:async()=>[[],null,[],[]],preview:async()=>({slug:'secret',title:'Private preview',body:'draft'})};
 const contentService=createContentService({url:'http://cms.test',store,revision:()=>1});
 const authorService={identity:async req=>req.headers.cookie?{name:'Owner'}:null};
 const server=createPreviewServer({contentService,authorService});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const owner=await (await fetch(base+'/api/content?preview='+id,{headers:{Cookie:'owner=1'}})).json();assert.equal(owner.preview.title,'Private preview');
  const visitor=await (await fetch(base+'/api/content')).json();assert.equal(visitor.author,null);assert.equal(visitor.preview,undefined);
  assert.equal((await contentService.snapshot()).data.author,undefined);
 }finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});

test('background, avatar and announcement display URLs use compressed variants while originals stay addressable',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const service=createContentService({url:'http://cms.test',store:{publicData:async()=>[[],{avatar:id,background:id},[{status:'published',image:id}],[]]}});
 const {data,media}=await service.snapshot();
 for(const url of [data.profile.avatar,data.profile.background,data.announcements[0].image])assert.match(url,/view=content/);
 assert(media.has(id));
});
