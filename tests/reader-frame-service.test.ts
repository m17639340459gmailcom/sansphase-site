import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { Payload } from 'payload';
import { createReaderService } from '../server/reader-service.ts';
import { createPreviewServer } from '../server.mjs';
import type { createReaderUidStore } from '../server/reader-uids.ts';
import { createCommunityFrameClient } from '../server/community-frame-client.ts';

test('main frame display and equip derive the reader from auth, and remote failure leaves the account usable',async t=>{
  const directory=await mkdtemp(resolve(tmpdir(),'reader-frame-http-')),id=randomUUID(),imageId=randomUUID();
  const row={id,collection:'readers',email:'private@example.invalid',nickname:'测试读者',signature:'已通过签名',_verified:true,disabled:false,createdAt:'2026-01-01T00:00:00.000Z'};
  const payload={config:{secret:'reader-frame-test-key-at-least-32-characters'},auth:async({headers}:{headers:Headers})=>({user:headers.get('authorization')==='JWT reader.token'?row:null}),findByID:async()=>row}as unknown as Payload;
  let frame:string|null='gold',failed=false,reads=0;
  const frames={
    state:async(readerId:string)=>{assert.equal(readerId,id);reads++;if(failed)throw Error('unavailable');return{frame,frameImage:null,items:[{id:'owned-gold',name:'金环',ref:'gold',image:null}],available:true};},
    equip:async(readerId:string,ref:string|null)=>{assert.equal(readerId,id);if(failed)throw Object.assign(Error('暂不可用'),{status:503});frame=ref;return{frame,frameImage:null,items:[],available:true};},
    image:async(readerId:string,requestedId:string)=>{assert.equal(readerId,id);assert.equal(requestedId,imageId);return Buffer.from('RIFF0000WEBPframe');},
  };
  const uidStore={get:()=> '10001'}as unknown as ReturnType<typeof createReaderUidStore>;
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const port=(reservation.address()as{port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
  const base=`http://127.0.0.1:${port}`;
  const service=createReaderService({payload,directory,siteOrigin:base,uidStore,frames});
  const server=createPreviewServer({readerService:service,contentService:{snapshot:async()=>({data:{notes:[]}})}});
  await new Promise<void>(done=>server.listen(port,'127.0.0.1',done));
  const cookie='sansphase_reader_session=reader.token';
  t.after(async()=>{await new Promise<void>(done=>server.close(()=>done()));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  let response=await fetch(base+'/api/reader/session',{headers:{cookie}});let account=await response.json();assert.equal(account.frame,'gold');assert.equal(account.signature,row.signature);
  response=await fetch(base+'/api/reader/frame-state',{headers:{cookie}});assert.equal((await response.json()).available,true);
  const post=(body:unknown)=>fetch(base+'/api/reader/frame',{method:'POST',headers:{cookie,Origin:base,'X-Reader-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({ref:'gold',readerId:randomUUID()})).status,400);
  assert.equal((await post({ref:null})).status,200);assert.equal(frame,null);
  response=await fetch(base+`/api/reader/frame/${imageId}.webp`,{headers:{cookie}});assert.equal(response.status,200);assert.equal(await response.text(),'RIFF0000WEBPframe');
  assert.equal((await fetch(base+`/api/reader/frame/${imageId}.webp`)).status,401);
  failed=true;response=await fetch(base+'/api/reader/session',{headers:{cookie}});account=await response.json();assert.equal(response.status,200);assert.equal(account.nickname,row.nickname);assert.equal(account.frame,null);
  const beforeIdentity=reads;const identity=await service.identity({headers:{cookie}}as Parameters<typeof service.identity>[0]);assert.equal(identity?.id,id);assert.equal(reads,beforeIdentity,'ordinary account authentication must not call remote frame service');
  response=await fetch(base+'/api/reader/frame-state',{headers:{cookie}});assert.equal((await response.json()).available,false);
  assert.equal((await post({ref:'gold'})).status,503);
  const before=reads;assert.equal(await service.identityStrict({headers:{}}as Parameters<typeof service.identityStrict>[0]),null);assert.equal(reads,before,'strict bridge identity cannot make a reverse frame request');
});

test('fresh main membership vetoes a still-cached VIP frame while retaining other owned frames', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'reader-vip-frame-http-')), id = randomUUID();
  const row = { id, collection: 'readers', email: 'private@example.invalid', nickname: '会员读者', signature: '', _verified: true, disabled: false,
    createdAt: '2026-01-01T00:00:00.000Z', vip_until: new Date(Date.now() + 60_000).toISOString() as string | null };
  const payload = { config: { secret: 'reader-vip-frame-test-key-at-least-32-characters' }, auth: async ({ headers }: { headers: Headers }) => ({ user: headers.get('authorization') === 'JWT reader.token' ? { ...row } : null }), findByID: async () => ({ ...row }) } as unknown as Payload;
  let calls = 0;
  const frames = createCommunityFrameClient({ origin: 'https://community.sansphase.com', secret: 'frame-cached-proof-at-least-32-characters', fetch: async () => {
    calls++;
    return new Response(JSON.stringify({ frame: 'vipmoon', frameImage: null, available: true, vipUntil: row.vip_until,
      items: [{ id: 'frame-vipmoon', name: 'VIP 月相头像框', ref: 'vipmoon', image: null }, { id: 'frame-gold', name: '金环', ref: 'gold', image: null }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(done => reservation.close(() => done()));
  const base = `http://127.0.0.1:${port}`, cookie = 'sansphase_reader_session=reader.token';
  const service = createReaderService({ payload, directory, siteOrigin: base, uidStore: { get: () => '10001' } as unknown as ReturnType<typeof createReaderUidStore>, frames });
  const server = createPreviewServer({ readerService: service, contentService: { snapshot: async () => ({ data: { notes: [] } }) } });
  await new Promise<void>(done => server.listen(port, '127.0.0.1', done));
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const session = async () => (await fetch(base + '/api/reader/session', { headers: { cookie } })).json();
  assert.equal((await session()).frame, 'vipmoon');
  row.vip_until = null;
  const expired = await session();
  assert.equal(expired.vip, false);
  assert.equal(expired.frame, null, 'the current account source must override the old decoration projection');
  const state = await (await fetch(base + '/api/reader/frame-state', { headers: { cookie } })).json();
  assert.equal(state.frame, null);
  assert.deepEqual(state.items.map((item: { ref: string }) => item.ref), ['gold']);
  assert.equal(calls, 1, 'masking an already-known loss needs no extra bridge request or inventory mutation');
});
