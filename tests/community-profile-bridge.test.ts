import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import type { Payload } from 'payload';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderProfileCommands } from '../server/reader-profile-commands.ts';
import { createReaderService } from '../server/reader-service.ts';
import type { createReaderUidStore } from '../server/reader-uids.ts';
import { prepareIdentityStore } from '../server/community-identity-store.ts';
import { createIdentityAuthority } from '../server/community-identity-authority.ts';
import { createIdentityClient, signIdentityRequest } from '../server/community-identity-protocol.ts';
import { prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { createCommunityHostRuntime } from '../server/community-host-runtime.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createPreviewServer } from '../server.mjs';
import { createCommunityFrameClient } from '../server/community-frame-client.ts';
import { createCommunityProfileReviewerClient } from '../server/community-profile-reviewer.ts';
import type { CommunityProfileReviewerCheck } from '../server/community-profile-reviewer.ts';
import type { CommunityStaffPermission } from '../src/community-staff.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const secret='profile-bridge-test-secret-at-least-32-characters';
const siteOrigin='https://www.sansphase.com', communityOrigin='https://community.sansphase.com';
const path='/api/community-identity/bridge';
async function fixture(t:test.TestContext,options:{ownerReader?:boolean}={}){
  const directory=await mkdtemp(resolve(tmpdir(),'community-profile-bridge-'));
  prepareIdentityStore(directory);
  const readerId=randomUUID(), moderatorId=randomUUID(), ownerId=randomUUID(),personalId=randomUUID(),generalId=randomUUID(),assistantId=randomUUID();
  const reader={id:readerId,uid:'10001',nickname:'普通读者',signature:'已经通过',avatar:null as string|null,_verified:true,disabled:false};
  const moderator={...reader,id:moderatorId,uid:'10002',nickname:'社区版主'};
  const general={...reader,id:generalId,uid:'10004',nickname:'社区总版主'},assistant={...reader,id:assistantId,uid:'10005',nickname:'社区协管'};
  const rows=new Map([[readerId,reader],[moderatorId,moderator],[generalId,general],[assistantId,assistant]]);
  const sessions=new Map([['reader.token',reader],['mod.token',moderator],['general.token',general],['assistant.token',assistant]]);
  const personal={...reader,id:personalId,uid:'10003',nickname:'站长个人',signature:'个人已批准签名'};
  if(options.ownerReader)rows.set(personalId,personal);
  const payload={
    findByID:async({id}:{id:string})=>{const row=rows.get(id);if(!row)throw Object.assign(Error('missing'),{status:404});return{...row};},
    update:async({id,data}:{id:string;data:Partial<typeof reader>})=>{const row=rows.get(id)!;Object.assign(row,data);return{...row};},
    find:async({where}:{where:{avatar:{equals:string}}})=>({totalDocs:[...rows.values()].filter(row=>row.avatar===where.avatar.equals).length}),
  }as unknown as Payload;
  const workflow=createReaderWorkflow(directory,'profile-main-key-at-least-32-characters');
  const commands=createReaderProfileCommands({payload,directory,workflow,uidStore:{get:id=>rows.get(id)?.uid||null}});
  let enabled=true,ownerActive=true;
  let checkReviewer: CommunityProfileReviewerCheck=async(actor,role,operation)=>{
    const allowed = actor.kind==='owner'&&actor.id===ownerId&&role==='owner' ? ['avatar','signature','nickname','background'] as const
      : actor.kind==='reader'&&actor.id===moderatorId&&role==='moderator' ? ['avatar'] as const : [];
    const kinds = allowed.filter(kind => !operation.kind || operation.kind===kind);
    if(!kinds.length) throw Object.assign(Error('denied'),{status:403}); return kinds;
  };
  let reviewForwarded:(()=>void)|undefined;
  const authority=createIdentityAuthority({directory,siteOrigin,communityOrigin,ownerId,secret,stateEncryptionKey:'separate-main-encryption-key-at-least-32-characters',profiles:commands,
    frameEligibility:async id=>{const row=rows.get(id);return{active:Boolean(row&&row._verified&&!row.disabled),vip:false,vipUntil:null};},
    profileReviewer:(actor,role,operation)=>checkReviewer(actor,role,operation),
    readerIdentity:async req=>{if(!enabled)return null;const token=/sansphase_reader_session=([^;]+)/.exec(String(req.headers.cookie))?.[1],row=token?sessions.get(token):null;return row&&!row.disabled&&row._verified?{...row,avatar:row.avatar?`/api/reader/avatar/${row.avatar}.webp`:null}:null;},
    ownerIdentity:async req=>ownerActive&&req.headers.cookie==='sansphase_author_session=owner.token'?{name:'站长'}:null,
    ownerReaderIdentity:async req=>options.ownerReader&&ownerActive&&!personal.disabled&&personal._verified&&req.headers.cookie==='sansphase_author_session=owner.token'?{...personal}:null,
    people:async authors=>new Map(authors.flatMap(author=>{
      const row=rows.get(author.id);if(row)return[[`reader:${row.id}`,{name:row.nickname,uid:row.uid,avatar:row.avatar,bio:row.signature,vip:false,ownerReader:options.ownerReader===true&&row.id===personalId&&!row.disabled,joinedAt:'2026-01-01T00:00:00Z',active:row._verified&&!row.disabled}]as const];
      return author.kind==='owner'&&author.id===ownerId?[[`owner:${ownerId}`,{name:'站长',uid:'owner',avatar:null,bio:'',vip:true,joinedAt:null,active:true}]as const]:[];
    })),findMember:async uid=>{const row=[...rows.values()].find(row=>row.uid===uid);return row?{kind:'reader',id:row.id}:uid==='owner'?{kind:'owner',id:ownerId}:null;},findByNames:async()=>new Map(),avatar:async uid=>{const row=[...rows.values()].find(row=>row.uid===uid);return row?.avatar?readFile(resolve(directory,'uploads',`reader-avatar-${row.avatar}.webp`)):null;},
  });
  const mainReader=createReaderService({payload,directory,siteOrigin,workflow,profileCommands:commands,ownerReaderId:options.ownerReader?personalId:undefined,
    uidStore:{get:id=>rows.get(id)?.uid||''}as ReturnType<typeof createReaderUidStore>,
    authorService:{identityStrict:async req=>ownerActive&&req.headers.cookie==='sansphase_author_session=owner.token'?{name:'站长'}:null,loginCredentials:async()=>{throw Error('unused test login');}}});
  const server=createServer((req,res)=>void(req.url?.startsWith('/api/reader/')?mainReader.handle(req,res):req.url==='/api/community-entry'?authority.handleEntry(req,res):authority.handleBridge(req,res)));
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const local=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
  const client=createIdentityClient({origin:siteOrigin,secret,fetch:(input,options)=>fetch(local+new URL(String(input)).pathname,options)});
  const session=async(cookie:string)=>{
    const issued=await fetch(local+'/api/community-entry',{method:'POST',headers:{Origin:siteOrigin,'X-Reader-Request':'1',Cookie:cookie}});
    assert.equal(issued.status,200);const body=await issued.json();const ticket=new URL(body.url).hash.slice('#community-entry='.length);
    const binding=/sansphase_community_handoff=([^;]+)/.exec(issued.headers.get('set-cookie')||'')![1];
    return(await client.request<{sessionRef:string}>('exchange',{ticket,binding})).sessionRef;
  };
  const bridge=async(operation:string,input:Record<string,unknown>)=>{
    const body=JSON.stringify({operation,input});return fetch(local+path,{method:'POST',headers:{'Content-Type':'application/json',...signIdentityRequest({secret,method:'POST',path,body})},body});
  };
  let closeHost: (()=>Promise<void>)|null=null;
  const host=async()=>{
    const hkDirectory=resolve(directory,'hk');await mkdir(hkDirectory);await prepareCommunityHostDirectory(hkDirectory);
    const store=createCommunityStore(hkDirectory);
    store.staff.bindOwner(ownerId);
    acceptCommunityConvention(store,[...Array.from(rows.keys(),id=>({kind:'reader' as const,id})),{kind:'owner',id:ownerId}]);
    const runtime=createCommunityHostRuntime({directory:hkDirectory,siteOrigin:communityOrigin,mainSiteOrigin:siteOrigin,bridgeSecret:secret,authorId:ownerId},{request:async(operation,input)=>{if(operation==='profile-review')reviewForwarded?.();return client.request(operation,input);}});
    const hkServer=createPreviewServer({...runtime,root:hkDirectory});await new Promise<void>(done=>hkServer.listen(0,'127.0.0.1',done));
    const base=`http://127.0.0.1:${(hkServer.address()as{port:number}).port}`;
    checkReviewer=createCommunityProfileReviewerClient({origin:communityOrigin,secret,accountsActive:async members=>members.every(member=>{const row=rows.get(member.id);return Boolean(row&&row._verified&&!row.disabled);}),fetch:(input,options)=>fetch(base+new URL(String(input)).pathname,options)});
    closeHost=async()=>{await new Promise<void>(done=>hkServer.close(()=>done()));store.close();await runtime.close();};
    const enter=async(mainCookie:string)=>{
      const issued=await fetch(local+'/api/community-entry',{method:'POST',headers:{Origin:siteOrigin,'X-Reader-Request':'1',Cookie:mainCookie}});assert.equal(issued.status,200);
      const body=await issued.json(),ticket=new URL(body.url).hash.slice('#community-entry='.length),binding=issued.headers.getSetCookie()[0].split(';')[0];
      const response=await fetch(base+'/api/community-entry',{method:'POST',headers:{Origin:communityOrigin,'X-Reader-Request':'1',Cookie:binding,'Content-Type':'application/json'},body:JSON.stringify({ticket})});
      assert.equal(response.status,200);return response.headers.getSetCookie().find(value=>value.startsWith('sansphase_community_session='))!.split(';')[0];
    };
    const get=(path:string,cookie:string)=>fetch(base+'/api/community/'+path,{headers:{cookie}});
    const post=(path:string,cookie:string,body:unknown={})=>fetch(base+'/api/community/'+path,{method:'POST',headers:{Origin:communityOrigin,'X-Reader-Request':'1',Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return{directory:hkDirectory,store,base,enter,get,post};
  };
  t.after(async()=>{await closeHost?.();await new Promise<void>(done=>server.close(()=>done()));authority.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  return{readerId,moderatorId,ownerId,personalId,personal,generalId,assistantId,rows,commands,payload,client,bridge,session,host,main:local,setReviewer:(reviewer:CommunityProfileReviewerCheck)=>{checkReviewer=reviewer;},onReviewForwarded:(callback:()=>void)=>{reviewForwarded=callback;},revoke:()=>{enabled=false;},revokeOwner:()=>{ownerActive=false;}};
}

for(const action of ['inspect','decide'] as const)test(`main rejects ${action} after the owner session ends during the reviewer network wait`,{timeout:20000},async t=>{
  const f=await fixture(t),sessionRef=await f.session('sansphase_author_session=owner.token');
  await f.commands.submitSignature(f.readerId,'仍应待审');const [proposal]=await f.commands.reviews(['signature']);
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),waiting=new Promise<void>(done=>{started=done;});
  let calls=0;f.setReviewer(async()=>{if(++calls===(action==='inspect'?2:3)){started();await gate;}return ['signature'];});
  const moderation={role:'owner',actor:{kind:'owner',id:f.ownerId}};
  const pending=f.bridge(action==='inspect'?'profile-reviews':'profile-review',{sessionRef,moderation,...(action==='decide'?{id:proposal.id,decision:'approve'}:{})});
  await waiting;f.revokeOwner();release();
  const response=await pending;assert.equal(response.status,401);
  assert.equal((await f.commands.state(f.readerId)).signature,'已经通过');
  assert.equal((await f.commands.state(f.readerId)).pendingSignature,'仍应待审');
});

test('self profile bridge keeps approved/pending separate and rejects caller-selected identities',async t=>{
  const f=await fixture(t),sessionRef=await f.session('sansphase_reader_session=reader.token');
  let response=await f.bridge('profile-signature',{sessionRef,signature:'新的个签',readerId:f.moderatorId});assert.equal(response.status,400);
  response=await f.bridge('profile-signature',{sessionRef,signature:'新的个签'});assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.signature,'已经通过');assert.equal(value.pendingSignature,'新的个签');assert.equal(value.id,f.readerId);
  assert.equal((await f.commands.state(f.moderatorId)).pendingSignature,null);
  f.revoke();assert.equal((await f.bridge('profile',{sessionRef})).status,401);
});

test('reviewer assertion is session-bound and mod cannot read or review pending signatures',async t=>{
  const f=await fixture(t),modSession=await f.session('sansphase_reader_session=mod.token'),ownerSession=await f.session('sansphase_author_session=owner.token');
  await f.commands.submitSignature(f.readerId,'待审签名');
  const image=await sharp({create:{width:320,height:320,channels:4,background:'#aaccee'}}).webp().toBuffer();await f.commands.submitAvatar(f.readerId,image);
  const moderation={role:'moderator',actor:{kind:'reader',id:f.moderatorId}};
  let response=await f.bridge('profile-reviews',{sessionRef:modSession,moderation});assert.equal(response.status,200);const modQueue=await response.json();assert.equal(modQueue.length,1);assert.equal(modQueue[0].kind,'avatar');
  const [signature]=await f.commands.reviews(['signature']);
  assert.equal((await f.bridge('profile-review',{sessionRef:modSession,moderation,id:signature.id,decision:'approve'})).status,403);
  assert.equal((await f.bridge('profile-reviews',{sessionRef:modSession,moderation:{role:'owner',actor:{kind:'owner',id:f.ownerId}}})).status,403);
  response=await f.bridge('profile-reviews',{sessionRef:ownerSession,moderation:{role:'owner',actor:{kind:'owner',id:f.ownerId}}});assert.equal(response.status,200);assert.equal((await response.json()).length,2);
  response=await f.bridge('profile-review',{sessionRef:modSession,moderation,id:modQueue[0].id,decision:'approve'});assert.equal(response.status,200);
  assert.equal((await f.commands.state(f.readerId)).pendingAvatar,false);assert.equal((await f.commands.state(f.readerId)).pendingSignature,'待审签名');
});

test('bounded normalized avatar upload crosses the bridge without enlarging ordinary operation limits',async t=>{
  const f=await fixture(t),sessionRef=await f.session('sansphase_reader_session=reader.token');
  const pixels=randomBytes(320*320*3);
  const image=await sharp(pixels,{raw:{width:320,height:320,channels:3}}).webp({lossless:true}).toBuffer();
  assert.ok(image.length>48*1024,'fixture must exceed the old bridge allowance');
  const value=await f.client.request<{pendingAvatar:boolean}>('profile-avatar',{sessionRef,base64:image.toString('base64')});assert.equal(value.pendingAvatar,true);
  await assert.rejects(f.client.request('profile',{sessionRef,padding:'x'.repeat(65*1024)}),{status:413});
});

test('real HK profile routes submit to the main workflow and keep pending avatars private',{timeout:20000},async t=>{
  const f=await fixture(t),hk=await f.host(),readerCookie=await hk.enter('sansphase_reader_session=reader.token'),modCookie=await hk.enter('sansphase_reader_session=mod.token');
  let response=await hk.get('profile',readerCookie);assert.equal(response.status,200);const state=await response.json();assert.equal(state.person.name,'普通读者');assert.equal(state.signature,'已经通过');assert.equal(state.canEditProfile,true);
  for(const key of ['email','phone','password','sessionRef'])assert.ok(!Object.hasOwn(state,key));
  assert.equal((await hk.post('profile',readerCookie,{signature:'新签名',id:f.moderatorId})).status,400);
  response=await hk.post('profile',readerCookie,{signature:'新的社区签名'});assert.equal(response.status,200);assert.equal((await response.json()).pendingSignature,'新的社区签名');
  assert.equal((await f.commands.state(f.readerId)).pendingSignature,'新的社区签名');
  const png=await sharp({create:{width:128,height:128,channels:4,background:'#ccddff'}}).png().toBuffer(),form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'avatar.png');
  response=await fetch(hk.base+'/api/community/profile/avatar',{method:'POST',headers:{Origin:communityOrigin,'X-Reader-Request':'1',Cookie:readerCookie},body:form});assert.equal(response.status,200);assert.equal((await response.json()).pendingAvatar,true);
  response=await hk.get('profile/avatar/pending.webp',readerCookie);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-type'),'image/webp');
  assert.equal((await hk.get('profile/avatar/pending.webp',modCookie)).status,404);
  const [avatar]=await f.commands.reviews(['avatar']);assert.equal((await hk.get(`manage/profiles/${avatar.id}/avatar.webp`,modCookie)).status,403);
  response=await hk.post('profile/avatar/remove',readerCookie);assert.equal(response.status,200);assert.equal((await response.json()).pendingAvatar,false);
});

test('real HK management checks current appointment, rejects forged roles, and exposes signatures only to owner',{timeout:20000},async t=>{
  const f=await fixture(t),hk=await f.host(),readerCookie=await hk.enter('sansphase_reader_session=reader.token'),modCookie=await hk.enter('sansphase_reader_session=mod.token'),ownerCookie=await hk.enter('sansphase_author_session=owner.token');
  await f.commands.submitSignature(f.readerId,'待审签名');const avatar=await sharp({create:{width:320,height:320,channels:4,background:'#8899cc'}}).webp().toBuffer();await f.commands.submitAvatar(f.readerId,avatar);
  const [proposal]=await f.commands.reviews(['avatar']);
  assert.equal((await hk.get('manage?tab=profiles',readerCookie)).status,403);
  assert.equal((await hk.post(`manage/profiles/${proposal.id}/approve`,readerCookie,{moderation:{role:'owner'}})).status,400);
  hk.store.members.setSteward({kind:'reader',id:f.moderatorId},true,['qa']);
  let response=await hk.get('manage?tab=profiles',modCookie);assert.equal(response.status,200);let queue=await response.json();assert.deepEqual(queue.profiles.map((row:{kind:string})=>row.kind),['avatar']);assert.deepEqual(queue.backgrounds,[]);
  response=await hk.get('manage?tab=profiles',ownerCookie);assert.equal(response.status,200);queue=await response.json();assert.equal(queue.profiles.length,2);
  assert.equal((await hk.get(`manage/profiles/${proposal.id}/avatar.webp`,ownerCookie+'; community_browse=reader')).status,503,'an unconfigured owner personal identity cannot silently fall back to the old preview');
  const [signature]=await f.commands.reviews(['signature']);assert.equal((await hk.post(`manage/profiles/${signature.id}/approve`,modCookie)).status,403);
  response=await hk.post(`manage/profiles/${proposal.id}/approve`,modCookie);assert.equal(response.status,200);assert.equal((await response.json()).kind,'avatar');
  assert.equal((await hk.post(`manage/profiles/${proposal.id}/approve`,modCookie)).status,404);
  hk.store.members.setSteward({kind:'reader',id:f.moderatorId},false);
  assert.equal((await hk.get('manage?tab=profiles',modCookie)).status,403);
});

test('real HK runtime accepts only signed main-server decoration requests, independently of browser entry sessions',async t=>{
  const f=await fixture(t),hk=await f.host();
  const endpoint=hk.base+'/api/community-identity/decorations';
  const response=await fetch(endpoint,{method:'POST',headers:{Origin:communityOrigin,'X-Reader-Request':'1','Content-Type':'application/json'},body:JSON.stringify({operation:'frame-state',input:{readerId:f.readerId}})});
  assert.equal(response.status,403);
  const client=createCommunityFrameClient({origin:communityOrigin,secret,fetch:(input,options)=>fetch(hk.base+new URL(String(input)).pathname,options)});
  const state=await client.state(f.readerId);assert.equal(state.available,true);assert.equal(state.frame,null);assert.deepEqual(state.items,[]);
  assert.equal(state.vipUntil,null);
  await assert.rejects(client.state(randomUUID()),{status:403},'an unknown reader cannot borrow another account projection');
  f.rows.get(f.readerId)!.disabled=true;
  const freshClient=createCommunityFrameClient({origin:communityOrigin,secret,fetch:(input,options)=>fetch(hk.base+new URL(String(input)).pathname,options)});
  await assert.rejects(freshClient.state(f.readerId),{status:403},'a fresh signed projection rechecks revocation independently of browser sessions');
  assert.equal((await fetch(endpoint)).status,404);
});

test('main refuses a queued community review if HK revoked the moderator before commit',{timeout:20000},async t=>{
  const f=await fixture(t),hk=await f.host(),cookie=await hk.enter('sansphase_reader_session=mod.token');
  hk.store.members.setSteward({kind:'reader',id:f.moderatorId},true,['qa']);
  const image=await sharp({create:{width:320,height:320,channels:4,background:'#7799cc'}}).webp().toBuffer();
  await f.commands.submitAvatar(f.readerId,image);const [proposal]=await f.commands.reviews(['avatar']);
  let release!:()=>void,started!:()=>void,forwarded!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{started=resolve;}),inFlight=new Promise<void>(resolve=>{forwarded=resolve;});
  f.onReviewForwarded(forwarded);
  const blocking=f.commands.accountMutation(async()=>{started();await gate;});await waiting;
  const response=hk.post(`manage/profiles/${proposal.id}/approve`,cookie);
  await inFlight;hk.store.members.setSteward({kind:'reader',id:f.moderatorId},false);release();await blocking;
  const result=await response;assert.equal(result.status,403);
  assert.equal((await f.commands.state(f.readerId)).avatar,null);assert.equal((await f.commands.state(f.readerId)).pendingAvatar,true);
});

test('HK reports a committed review successfully if the appointment changes after the final check',{timeout:20000},async t=>{
  const f=await fixture(t),hk=await f.host(),cookie=await hk.enter('sansphase_reader_session=mod.token');
  hk.store.members.setSteward({kind:'reader',id:f.moderatorId},true,['qa']);
  const image=await sharp({create:{width:320,height:320,channels:4,background:'#7799cc'}}).webp().toBuffer();
  await f.commands.submitAvatar(f.readerId,image);const [proposal]=await f.commands.reviews(['avatar']);
  const update=f.payload.update.bind(f.payload);
  f.payload.update=async args=>{const result=await update(args);hk.store.members.setSteward({kind:'reader',id:f.moderatorId},false);return result;};
  const response=await hk.post(`manage/profiles/${proposal.id}/approve`,cookie);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,id:proposal.id,kind:'avatar',decision:'approve'});
  assert.equal((await f.commands.state(f.readerId)).pendingAvatar,false);assert.ok((await f.commands.state(f.readerId)).avatar);
});

test('actual hierarchical profile grants separate advice from decisions and keep approved nickname/signature shared across hosts',{timeout:20000},async t=>{
  const f=await fixture(t),hk=await f.host(),owner={kind:'owner' as const,id:f.ownerId},general={kind:'reader' as const,id:f.generalId},mod={kind:'reader' as const,id:f.moderatorId},assistant={kind:'reader' as const,id:f.assistantId};
  const permissions:CommunityStaffPermission[]=['staff.appoint','profile.nickname.advise','profile.nickname.decide','profile.signature.advise','profile.signature.decide'];
  hk.store.staff.appoint(owner,general,{role:'general',boards:['qa'],permissions,delegable:permissions});
  hk.store.staff.appoint(general,mod,{role:'moderator',boards:['qa'],permissions,delegable:permissions});
  hk.store.staff.appoint(mod,assistant,{role:'assistant',boards:['qa'],permissions:['profile.nickname.advise'],delegable:[]});
  const readerCookie=await hk.enter('sansphase_reader_session=reader.token'),assistantCookie=await hk.enter('sansphase_reader_session=assistant.token'),modCookie=await hk.enter('sansphase_reader_session=mod.token');
  let response=await hk.post('profile',readerCookie,{nickname:'新昵称',signature:'新的个签'});assert.equal(response.status,200);
  const submitted=await response.json();assert.equal(submitted.pendingNickname,'新昵称');assert.equal(submitted.person.name,'普通读者');assert.equal(submitted.signature,'已经通过');
  response=await hk.get('manage?tab=profiles',assistantCookie);assert.equal(response.status,200);let queue=await response.json();assert.deepEqual(queue.profiles.map((row:{kind:string})=>row.kind),['nickname']);
  const proposal=queue.profiles[0];assert.equal(proposal.canAdvise,true);assert.equal(proposal.canDecide,false);assert.equal(proposal.proposedValue,'新昵称');
  assert.equal((await hk.post(`manage/profiles/${proposal.id}/approve`,assistantCookie)).status,403);
  assert.equal((await hk.post(`manage/profiles/${proposal.id}/advise`,assistantCookie,{decision:'reject',reason:''})).status,400);
  response=await hk.post(`manage/profiles/${proposal.id}/advise`,assistantCookie,{decision:'reject',reason:'建议修改用语'});assert.equal(response.status,200);
  assert.equal((await f.commands.state(f.readerId)).nickname,'普通读者');assert.equal((await f.commands.state(f.readerId)).pendingNickname,'新昵称');
  response=await hk.get('manage?tab=profiles',modCookie);assert.equal(response.status,200);queue=await response.json();const advised=queue.profiles.find((row:{id:string})=>row.id===proposal.id);
  assert.equal(advised.canDecide,true);assert.equal(advised.advice[0].reason,'建议修改用语');assert.deepEqual(advised.advice[0].by,assistant);
  assert.equal((await hk.post(`manage/profiles/${proposal.id}/reject`,modCookie,{reason:''})).status,400);
  response=await hk.post(`manage/profiles/${proposal.id}/approve`,modCookie,{reason:''});assert.equal(response.status,200);assert.equal((await response.json()).kind,'nickname');
  response=await hk.get('profile',readerCookie);assert.equal(response.status,200);assert.equal((await response.json()).person.name,'新昵称');
  const state=await f.commands.state(f.readerId);assert.equal(state.nickname,'新昵称');assert.equal(state.pendingNickname,null);assert.equal(state.signature,'已经通过');assert.equal(state.pendingSignature,'新的个签');
  assert.equal((await hk.post('profile',readerCookie,{nickname:'有效昵称',signature:'无效\n签名'})).status,400);
  assert.equal((await f.commands.state(f.readerId)).pendingNickname,null,'invalid multi-field input cannot partially enqueue a name');
});

test('direct owner-appointed moderator and assistant use the existing profile bridge for advice and final approval',{timeout:20000},async t=>{
  const f=await fixture(t),hk=await f.host(),owner={kind:'owner' as const,id:f.ownerId};
  const moderator={kind:'reader' as const,id:f.moderatorId},assistant={kind:'reader' as const,id:f.assistantId};
  hk.store.staff.appoint(owner,moderator,{role:'moderator',boards:['qa'],permissions:['profile.nickname.decide'],delegable:[]});
  hk.store.staff.appoint(owner,assistant,{role:'assistant',boards:['qa'],permissions:['profile.nickname.advise'],delegable:[]});
  const moderatorCookie=await hk.enter('sansphase_reader_session=mod.token');
  const assistantCookie=await hk.enter('sansphase_reader_session=assistant.token');
  await f.commands.submitNickname(f.readerId,'直属审核的新昵称');const [proposal]=await f.commands.reviews(['nickname']);
  const queue=await(await hk.get('manage?tab=profiles',assistantCookie)).json();
  const advice=queue.profiles.find((row:{id:string})=>row.id===proposal.id);
  assert.equal(advice.canAdvise,true);assert.equal(advice.canDecide,false);
  assert.equal((await hk.post(`manage/profiles/${proposal.id}/advise`,assistantCookie,{decision:'approve'})).status,200);
  assert.equal((await f.commands.state(f.readerId)).nickname,'普通读者','advice does not publish profile data');
  assert.equal((await hk.post(`manage/profiles/${proposal.id}/approve`,moderatorCookie)).status,200);
  const state=await f.commands.state(f.readerId);assert.equal(state.nickname,'直属审核的新昵称');assert.equal(state.pendingNickname,null);
  const me=await(await hk.get('me',moderatorCookie)).json();assert.equal(me.owner,false);assert.equal(me.staff.role,'moderator');
  assert.deepEqual(hk.store.staff.state(moderator)?.parent,owner);assert.deepEqual(hk.store.staff.state(assistant)?.parent,owner);
});

test('main rejects queued nickname approval when a real ancestor account becomes disabled',{timeout:20000},async t=>{
  const f=await fixture(t),hk=await f.host(),owner={kind:'owner' as const,id:f.ownerId},general={kind:'reader' as const,id:f.generalId},mod={kind:'reader' as const,id:f.moderatorId};
  const permissions:CommunityStaffPermission[]=['staff.appoint','profile.nickname.decide'];
  hk.store.staff.appoint(owner,general,{role:'general',boards:['qa'],permissions,delegable:permissions});
  hk.store.staff.appoint(general,mod,{role:'moderator',boards:['qa'],permissions,delegable:permissions});
  const cookie=await hk.enter('sansphase_reader_session=mod.token');await f.commands.submitNickname(f.readerId,'待审昵称');const [proposal]=await f.commands.reviews(['nickname']);
  let release!:()=>void,started!:()=>void,forwarded!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),waiting=new Promise<void>(done=>{started=done;}),inFlight=new Promise<void>(done=>{forwarded=done;});
  f.onReviewForwarded(forwarded);const blocking=f.commands.accountMutation(async()=>{started();await gate;});await waiting;
  const pending=hk.post(`manage/profiles/${proposal.id}/approve`,cookie);await inFlight;
  f.rows.get(f.generalId)!.disabled=true;release();await blocking;
  assert.equal((await pending).status,403);assert.equal((await f.commands.state(f.readerId)).nickname,'普通读者');assert.equal((await f.commands.state(f.readerId)).pendingNickname,'待审昵称');
  assert.equal((await hk.get('manage?tab=profiles',cookie)).status,403,'a cached title/grant cannot authorize after the ancestor is disabled');
});

test('owner reader metadata preserves original management identity and personal writes require explicit delegation',async t=>{
  const f=await fixture(t,{ownerReader:true}),sessionRef=await f.session('sansphase_author_session=owner.token');
  let response=await f.bridge('session',{sessionRef}),dto=await response.json();assert.equal(dto.viewer.kind,'owner');assert.equal(dto.viewer.id,f.ownerId);assert.equal(dto.reader,null);assert.equal(dto.author.name,'站长');assert.equal(dto.ownerReader.id,f.personalId);assert.equal(dto.ownerReader.role,'reader');
  for(const key of ['email','phone','password'])assert.ok(!Object.hasOwn(dto.ownerReader,key));
  assert.equal((await f.bridge('profile',{sessionRef})).status,403);
  assert.equal((await f.bridge('profile-signature',{sessionRef,asReader:true,signature:'新个人签名',readerId:f.readerId})).status,400);
  response=await f.bridge('profile-signature',{sessionRef,asReader:true,signature:'新个人签名'});assert.equal(response.status,200);dto=await response.json();assert.equal(dto.id,f.personalId);assert.equal(dto.signature,'个人已批准签名');assert.equal(dto.pendingSignature,'新个人签名');
  assert.equal((await f.commands.state(f.readerId)).pendingSignature,null);
  const ordinary=await f.session('sansphase_reader_session=reader.token');assert.equal((await f.bridge('profile',{sessionRef:ordinary,asReader:true})).status,400);
  assert.equal((await f.bridge('profile-reviews',{sessionRef,asReader:true,moderation:{role:'owner',actor:{kind:'owner',id:f.ownerId}}})).status,400);
  response=await f.bridge('session',{sessionRef});dto=await response.json();assert.equal(dto.viewer.kind,'owner');assert.equal(dto.ownerReader.signature,'个人已批准签名');
});

test('queued owner-personal writes reject a revoked owner session and retain approved reader data',async t=>{
  const f=await fixture(t,{ownerReader:true}),sessionRef=await f.session('sansphase_author_session=owner.token');
  let release!:()=>void,started!:()=>void,queued!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{started=resolve;}),queuedRequest=new Promise<void>(resolve=>{queued=resolve;});
  const blocking=f.commands.accountMutation(async()=>{started();await gate;});await waiting;
  const submit=f.commands.submitSignature.bind(f.commands);f.commands.submitSignature=async(...args)=>{queued();return submit(...args);};
  const pending=f.bridge('profile-signature',{sessionRef,asReader:true,signature:'不可写入'});
  await queuedRequest;f.revokeOwner();release();await blocking;
  assert.equal((await pending).status,401);assert.equal(f.personal.signature,'个人已批准签名');
  // No command may have created a proposal for another account.
  assert.equal((await f.commands.state(f.personalId)).pendingSignature,null);
});

test('real owner handoff supports personal profile editing in reader mode without modifying the author brand',{timeout:20000},async t=>{
  const f=await fixture(t,{ownerReader:true}),hk=await f.host(),ownerCookie=await hk.enter('sansphase_author_session=owner.token'),personalCookie=ownerCookie+'; community_browse=reader';
  let response=await hk.get('profile',ownerCookie),state=await response.json();assert.equal(response.status,200);assert.equal(state.canEditProfile,false);assert.equal(state.person.role,'owner');
  assert.equal((await hk.post('profile',ownerCookie,{signature:'不允许改个人'})).status,403);
  response=await hk.get('profile',personalCookie);assert.equal(response.status,200);state=await response.json();assert.equal(state.canEditProfile,true);assert.equal(state.person.uid,'10003');assert.equal(state.person.name,'站长个人');assert.equal(state.signature,'个人已批准签名');
  response=await hk.post('profile',personalCookie,{signature:'社区个人新签名'});assert.equal(response.status,200);state=await response.json();assert.equal(state.signature,'个人已批准签名');assert.equal(state.pendingSignature,'社区个人新签名');
  const png=await sharp({create:{width:128,height:128,channels:4,background:'#ccddff'}}).png().toBuffer(),form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'personal-avatar.png');
  response=await fetch(hk.base+'/api/community/profile/avatar',{method:'POST',headers:{Origin:communityOrigin,'X-Reader-Request':'1',Cookie:personalCookie},body:form});assert.equal(response.status,200);assert.equal((await response.json()).pendingAvatar,true);
  assert.equal((await hk.get('profile/avatar/pending.webp',personalCookie)).status,200);assert.equal((await hk.get('manage?tab=profiles',personalCookie)).status,403);
  for(const proposal of await f.commands.reviews())assert.equal((await hk.post(`manage/profiles/${proposal.id}/approve`,ownerCookie)).status,200);
  response=await hk.get('profile',personalCookie);assert.equal(response.status,200);state=await response.json();assert.equal(state.signature,'社区个人新签名');assert.equal(state.pendingSignature,null);assert.equal(state.pendingAvatar,false);assert.match(state.person.avatar,/\/avatar\/10003\.webp/);
  const personalAvatar=`/api/community/avatar/10003.webp?v=${f.personal.avatar}`;
  assert.equal(state.person.avatar,personalAvatar);
  response=await hk.get('me',personalCookie);assert.equal(response.status,200);assert.equal((await response.json()).avatar,personalAvatar,'the member projection and profile editor use the same full approved avatar version');
  response=await fetch(hk.base+'/api/content?view=bootstrap',{headers:{Cookie:personalCookie}});assert.equal(response.status,200);assert.equal((await response.json()).reader.avatar,personalAvatar,'reader-mode bootstrap uses the same approved personal avatar URL');
  const sessionRef=await f.session('sansphase_author_session=owner.token'),identity=await(await f.bridge('session',{sessionRef})).json();assert.equal(identity.viewer.kind,'owner');assert.equal(identity.author.name,'站长');assert.equal(identity.ownerReader.signature,'社区个人新签名');assert.equal(identity.ownerReader.avatar,f.personal.avatar);
  assert.equal((await f.commands.state(f.readerId)).signature,'已经通过');assert.equal((await hk.get('profile',ownerCookie)).status,200);
  const mainCookie='sansphase_author_session=owner.token';
  const mainState=await(await fetch(f.main+'/api/reader/session',{headers:{Cookie:mainCookie}})).json();
  assert.equal(mainState.id,f.personalId);assert.equal(mainState.signature,'社区个人新签名');assert.equal(mainState.avatar,`/api/reader/avatar/${f.personal.avatar}.webp`);
  const mainImage=await fetch(f.main+mainState.avatar,{headers:{Cookie:mainCookie}}),hkImage=await hk.get('avatar/10003.webp',personalCookie);
  assert.equal(mainImage.status,200);assert.equal(hkImage.status,200);assert.deepEqual(Buffer.from(await mainImage.arrayBuffer()),Buffer.from(await hkImage.arrayBuffer()),'both hosts use the same approved personal avatar');
  const original=await sharp({create:{width:32,height:48,channels:3,background:'#cc99bb'}}).png().toBuffer(),nextForm=new FormData();nextForm.set('file',new Blob([original],{type:'image/png'}),'small-portrait.png');
  response=await fetch(f.main+'/api/reader/avatar',{method:'POST',headers:{Origin:siteOrigin,'X-Reader-Request':'1',Cookie:mainCookie},body:nextForm});assert.equal(response.status,200);
  const [newAvatar]=await f.commands.reviews(['avatar']);assert.equal((await hk.post(`manage/profiles/${newAvatar.id}/approve`,ownerCookie)).status,200);
  const nextMain=await(await fetch(f.main+'/api/reader/session',{headers:{Cookie:mainCookie}})).json(),nextCommunity=await(await hk.get('profile',personalCookie)).json();
  assert.notEqual(nextMain.avatar,mainState.avatar);assert.equal(nextCommunity.person.avatar,`/api/community/avatar/10003.webp?v=${f.personal.avatar}`);
  response=await fetch(hk.base+'/api/content?view=bootstrap',{headers:{Cookie:personalCookie}});assert.equal(response.status,200);assert.equal((await response.json()).reader.avatar,nextCommunity.person.avatar,'an approved replacement changes the bootstrap and editor URL together');
  assert.deepEqual(Buffer.from(await(await fetch(f.main+nextMain.avatar,{headers:{Cookie:mainCookie}})).arrayBuffer()),Buffer.from(await(await hk.get('avatar/10003.webp',personalCookie)).arrayBuffer()),'main-site uploads are approved into the same community personal portrait');
  assert.equal((await(await hk.get('profile',ownerCookie)).json()).person.avatar,null,'personal approval leaves the separate brand portrait unchanged');
});
