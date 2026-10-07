import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { communityStaffCapabilities,communityStaffDefaultPermissions } from '../src/community-staff.ts';
import type {CommunityStaffPermission} from '../src/community-staff.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
const owner:CommunityAuthor={kind:'owner',id:'owner'},reader=(id:string):CommunityAuthor=>({kind:'reader',id});
async function setup(t:test.TestContext){
  const directory=await mkdtemp(resolve(tmpdir(),'community-staff-http-'));new DatabaseSync(resolve(directory,'content.db')).close();await migrateCommunity(directory);await mkdir(resolve(directory,'uploads'));
  const store=createCommunityStore(directory),accounts=new Map(['g','m','a','r','other'].map((id,i)=>[id,{id,uid:String(10001+i),active:true}]));
  acceptCommunityConvention(store,[owner,...[...accounts.keys()].map(reader)]);
  const all=communityStaffCapabilities.map(cap=>cap.id);store.staff.appoint(owner,reader('g'),{role:'general',boards:['qa','tools','vip'],permissions:all,delegable:all});
  store.staff.appoint(reader('g'),reader('m'),{role:'moderator',boards:['qa','tools','vip'],permissions:all,delegable:all});
  store.staff.appoint(reader('m'),reader('a'),{role:'assistant',boards:['qa'],permissions:[...communityStaffDefaultPermissions.assistant],delegable:[]});
  let beforePeople:(()=>void|Promise<void>)|undefined;
  let beforeReviews:(()=>void|Promise<void>)|undefined;
  let service:ReturnType<typeof createCommunityService>;
  const server=createServer((req,res)=>{void service.handle(req,res);});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
  service=createCommunityService({store,directory,siteOrigin:origin,identify:async req=>{const id=String(req.headers.cookie||'a').split(';')[0];if(id==='owner')return{...owner,name:'站长',vip:true};const row=accounts.get(id);return row?.active?{kind:'reader',id,name:id,vip:false}:null;},
    people:async authors=>{await beforePeople?.();return new Map(authors.flatMap(author=>{const row=accounts.get(author.id);return author.kind==='owner'?[[`owner:${author.id}`,{name:'站长',uid:'owner',avatar:null,vip:true,bio:'',joinedAt:null,active:true}]]:row?[[`reader:${row.id}`,{name:row.id,uid:row.uid,avatar:null,vip:false,bio:'',joinedAt:null,active:row.active}]]:[];}));},
    findMember:async uid=>uid==='owner'?owner:[...accounts.values()].filter(row=>row.uid===uid).map(row=>reader(row.id))[0]||null,
    profile:{
      state:async()=>{throw Error('Unused profile fixture operation');},signature:async()=>{throw Error('Unused profile fixture operation');},nickname:async()=>{throw Error('Unused profile fixture operation');},
      avatar:async()=>{throw Error('Unused profile fixture operation');},removeAvatar:async()=>{throw Error('Unused profile fixture operation');},pendingAvatar:async()=>{throw Error('Unused profile fixture operation');},
      reviews:async()=>{await beforeReviews?.();return[];},reviewImage:async()=>{throw Error('Unused profile fixture operation');},review:async()=>{throw Error('Unused profile fixture operation');},advise:async()=>{throw Error('Unused profile fixture operation');},
    },
  });
  t.after(async()=>{await new Promise<void>(done=>server.close(()=>done()));store.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const get=(path:string,id='a')=>fetch(origin+'/api/community/'+path,{headers:{Cookie:id}});
  const post=(path:string,body:unknown={},id='a')=>fetch(origin+'/api/community/'+path,{method:'POST',headers:{Cookie:id,Origin:origin,'X-Reader-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
  const topic=(board='qa',pending=false,author=reader('r'))=>store.createTopic({board,author,title:'权限回归测试',body:'这是一篇完整的真实待审测试内容',pending:pending?'需要审核':null});
  const grant=(permissions:CommunityStaffPermission[],delegable:CommunityStaffPermission[]=[])=>store.staff.appoint(reader('m'),reader('a'),{role:'assistant',boards:['qa'],permissions,delegable});
  return{store,accounts,get,post,topic,grant,origin,directory,onPeople:(hook:()=>void|Promise<void>)=>{beforePeople=hook;},onReviews:(hook:()=>void|Promise<void>)=>{beforeReviews=hook;}};
}
test('assistant reviews assigned pending posts with required rejection reasons and cannot delete published content by default',async t=>{
  const f=await setup(t),pending=f.topic('qa',true),publicTopic=f.topic(),outside=f.topic('tools',true);
  assert.equal((await f.post(`topics/${pending.id}/approve`)).status,200);
  assert.equal((await f.post(`topics/${publicTopic.id}/delete`,{reason:'明确删除理由'})).status,403);
  assert.equal((await f.post(`topics/${outside.id}/approve`)).status,404);
  const rejected=f.topic('qa',true);assert.equal((await f.post(`manage/topics/${rejected.id}/reject`,{})).status,400);
  assert.equal((await f.post(`manage/topics/${rejected.id}/reject`,{reason:'广告引流'})).status,200);
  const me=await(await f.get('me')).json();assert.equal(me.staff.role,'assistant');assert.equal(me.management.role,'assistant');
  assert.equal((await f.get('manage?tab=reports')).status,403);assert.equal((await f.get('manage?tab=stewards')).status,403);
});
test('explicit delete grants never imply penalties, mute, reply deletion, or global account administration',async t=>{
  const f=await setup(t);f.grant(['content.inspect','topic.delete']);const first=f.topic(),second=f.topic();
  assert.equal((await f.post(`topics/${first.id}/delete`,{reason:'已授权删除'})).status,200);
  assert.equal(f.store.ledger.history(reader('r'),{limit:100}).some(row=>row.reason==='penalty'),false);
  assert.equal((await f.post(`topics/${second.id}/delete`,{reason:'越权扣分',violation:true})).status,403);assert.ok(f.store.topic(second.id));
  assert.equal((await f.post(`topics/${second.id}/delete`,{reason:'越权禁言',mute:1,violation:false})).status,403);assert.equal(f.store.members.muted(reader('r')),null);
  const reply=f.store.addReply({topicId:second.id,author:reader('r'),body:'回复内容'});
  assert.equal((await f.post(`replies/${reply.id}/delete`,{reason:'没有回复删除权限'})).status,403);
  assert.equal((await f.post('members/10004/mute',{days:1,reason:'广告引流'})).status,403);
  assert.equal((await f.get('manage?tab=items')).status,403);
});
test('recommendation is durable and idempotent without reward, and only the corresponding authorized upstream can decide',async t=>{
  const f=await setup(t),topic=f.topic();const first=await f.post(`topics/${topic.id}/feature-recommend`,{reason:'优质教程'});assert.equal(first.status,200);const {id}=await first.json();
  assert.equal((await(await f.post(`topics/${topic.id}/feature-recommend`,{reason:'重试'})).json()).id,id);assert.equal(f.store.topic(topic.id)?.featured,false);
  assert.equal((await f.post(`manage/feature-recommendations/${id}/approve`)).status,403);
  assert.equal((await f.post(`manage/feature-recommendations/${id}/reject`,{},'m')).status,400);
  const queue=await(await f.get('manage?tab=features','m')).json();assert.equal(queue.features.length,1);assert.equal(queue.features[0].id,id);
  assert.equal((await f.post(`manage/feature-recommendations/${id}/approve`,{},'m')).status,200);assert.equal(f.store.topic(topic.id)?.featured,true);
  const balance=f.store.ledger.balance(reader('r'));assert.equal((await f.post(`manage/feature-recommendations/${id}/approve`,{},'m')).status,200);assert.equal(f.store.ledger.balance(reader('r')),balance);
  const other=f.topic();const next=await(await f.post(`topics/${other.id}/feature-recommend`)).json();f.grant(['content.inspect']);assert.equal((await f.post(`manage/feature-recommendations/${next.id}/approve`,{},'m')).status,403);
});
test('report review alone cannot uphold-delete or restore hidden content',async t=>{
  const f=await setup(t),topic=f.topic();f.store.hide({kind:'topic',id:topic.id},'人工隐藏');const report=f.store.report({target:{kind:'topic',id:topic.id},reporter:reader('other'),reason:'广告引流'});f.grant(['content.inspect','report.review']);
  assert.equal((await f.post(`manage/reports/${report.id}`,{uphold:true,reason:'违规理由'})).status,403);assert.ok(f.store.topic(topic.id));
  assert.equal((await f.post(`manage/reports/${report.id}`,{uphold:false})).status,403);assert.equal(f.store.topic(topic.id)?.hidden,true);
  f.grant(['content.inspect','report.review','topic.delete']);assert.equal((await f.post(`manage/reports/${report.id}`,{uphold:true,reason:'明确删除'})).status,200);
  assert.equal(f.store.ledger.history(reader('r'),{limit:100}).some(row=>row.reason==='penalty'),false);
});
test('a disabled or unverified upstream account denies descendants and late revocation does not execute a queued mutation',async t=>{
  const f=await setup(t);f.grant(['content.inspect','topic.delete']);const topic=f.topic();f.accounts.get('g')!.active=false;
  assert.equal((await f.post(`topics/${topic.id}/delete`,{reason:'禁用上级不能授权'})).status,403);assert.ok(f.store.topic(topic.id));
  f.accounts.get('g')!.active=true;let calls=0;f.onPeople(()=>{if(++calls===3)f.accounts.get('m')!.active=false;});
  assert.equal((await f.post(`topics/${topic.id}/delete`,{reason:'等待时撤销上级'})).status,403);assert.ok(f.store.topic(topic.id));
});
test('new owner appointments are strictly adjacent and reader presentation never grants staff actions',async t=>{
  const f=await setup(t);
  assert.equal((await f.post('members/10005/steward',{on:true,boards:['qa']},'owner')).status,400);
  assert.equal(f.store.staff.state(reader('other')),null);
  assert.equal((await f.post('members/10005/steward',{on:true,role:'assistant',boards:['qa'],permissions:[],delegable:[]},'owner')).status,403);
  const topic=f.topic();assert.equal((await f.post(`topics/${topic.id}/delete`,{reason:'不能用读者模式管理'},'m; community_browse=reader')).status,403);
  assert.equal((await f.post('members/10001/mute',{days:1,reason:'广告引流'},'m')).status,403);
});
test('late parent deactivation prevents feature decisions and banner replacement without mutating either record',async t=>{
  const f=await setup(t),topic=f.topic();const {id}=await(await f.post(`topics/${topic.id}/feature-recommend`)).json();
  let calls=0;f.onPeople(()=>{if(++calls===3)f.accounts.get('g')!.active=false;});
  assert.equal((await f.post(`manage/feature-recommendations/${id}/approve`,{},'m')).status,403);
  assert.equal(f.store.topic(topic.id)?.featured,false);
  f.accounts.get('g')!.active=true;calls=0;
  assert.equal((await f.post('manage/banners',{scope:'qa',version:0,items:[]},'m')).status,403);
  assert.equal(f.store.banners.get('qa',()=>true).version,0);
});
test('a parent lost while person projection waits removes private topics and management authority from responses',async t=>{
  const f=await setup(t);f.topic('vip');let calls=0;
  f.onPeople(()=>{if(++calls===2)f.accounts.get('g')!.active=false;});
  const topics=await(await f.get('topics','m')).json();
  assert.equal(topics.items.length,0);
  f.accounts.get('g')!.active=true;calls=0;
  const me=await(await f.get('me','m')).json();assert.equal(me.staff,null);assert.equal(me.management,null);assert.equal(me.mod,false);
});
test('a general disabled after request identification cannot appoint a moderator',async t=>{
  const f=await setup(t);let calls=0;f.onPeople(()=>{if(++calls===2)f.accounts.get('g')!.active=false;});
  assert.equal((await f.post('members/10005/steward',{on:true,role:'moderator',boards:['qa'],permissions:['content.inspect'],delegable:[]},'g')).status,403);
  assert.equal(f.store.staff.state(reader('other')),null);
});
test('unpublished banner media cannot retain its uploader staff authority after an upstream account becomes inactive',async t=>{
  const f=await setup(t),id=randomUUID();f.grant(['banner.manage']);
  f.store.addImage({id,uploader:reader('a'),width:32,height:32,purpose:'banner',bannerScope:'qa'});
  await writeFile(resolve(f.directory,'uploads',`community-image-${id}.webp`),'private-banner-bytes');
  assert.equal((await f.get(`images/${id}.webp`)).status,200);
  f.accounts.get('g')!.active=false;assert.equal((await f.get(`images/${id}.webp`)).status,404);
  f.accounts.get('g')!.active=true;let calls=0;f.onPeople(()=>{if(++calls===2)f.accounts.get('m')!.active=false;});
  assert.equal((await f.get(`images/${id}.webp`)).status,404,'disk read cannot release bytes after parent deactivation');
});
test('a recommender disabled during the final account check cannot approve or replay its recommendation',async t=>{
  const f=await setup(t),topic=f.topic();const {id}=await(await f.post(`topics/${topic.id}/feature-recommend`)).json();let calls=0;
  f.onPeople(()=>{if(++calls===4)f.accounts.get('a')!.active=false;});
  assert.equal((await f.post(`manage/feature-recommendations/${id}/approve`,{},'m')).status,403);assert.equal(f.store.topic(topic.id)?.featured,false);
  f.onPeople(()=>{});assert.equal((await(await f.get('manage?tab=features','m')).json()).features.length,0);
  f.accounts.get('a')!.active=true;assert.equal((await f.post(`manage/feature-recommendations/${id}/approve`,{},'m')).status,200);
  f.accounts.get('a')!.active=false;assert.equal((await f.post(`manage/feature-recommendations/${id}/approve`,{},'m')).status,403);
});
test('contact writes and member appointment proofs lose authority when a parent becomes inactive while waiting',async t=>{
  const f=await setup(t);let calls=0;f.onPeople(()=>{if(++calls===3)f.accounts.get('m')!.active=false;});
  assert.equal((await f.post('me/contact',{qq:'1234567',email:''})).status,403);
  assert.deepEqual(f.store.members.moderationContact(reader('a')),{qq:'',email:''});
  f.accounts.get('m')!.active=true;calls=0;f.onPeople(()=>{if(++calls===2)f.accounts.get('g')!.active=false;});
  const member=await(await f.get('members/10003','m')).json();assert.equal(member.canAppoint,false);assert.equal(member.staff,null);
});
test('the requested appointee must remain a verified active account at the final authority check',async t=>{
  const f=await setup(t);let calls=0;f.onPeople(()=>{if(++calls>=3)f.accounts.get('other')!.active=false;});
  assert.equal((await f.post('members/10005/steward',{on:true,role:'moderator',boards:['qa'],permissions:['content.inspect'],delegable:[]},'g')).status,403);
  assert.equal(f.store.staff.state(reader('other')),null);
});
test('management rejection protects self and superior staff while own withdrawal remains separate and bulk checks are atomic',async t=>{
  const f=await setup(t),own=f.topic('qa',true,reader('a')),superior=f.topic('qa',true,reader('m')),normal=f.topic('qa',true);
  assert.equal((await f.post(`manage/topics/${own.id}/reject`,{reason:'广告引流'})).status,403);
  assert.equal((await f.post(`manage/topics/${superior.id}/reject`,{reason:'广告引流'})).status,403);
  assert.equal((await f.post('manage/review',{action:'reject',ids:[normal.id,superior.id],reason:'广告引流'})).status,403);
  assert.equal(f.store.topic(normal.id)?.pending,true);assert.equal(f.store.topic(superior.id)?.pending,true);
  assert.equal((await f.post(`topics/${own.id}/delete`,{})).status,400,'explicit staff reject reason rules remain on the shared delete route');
  assert.equal((await f.post(`topics/${own.id}/delete`,{reason:'本人撤回'})).status,200);assert.equal(f.store.topic(own.id),null);
});
test('staff report authority never grants a synthetic strong report against a superior',async t=>{
  const f=await setup(t);f.grant(['content.inspect','report.review']);const superior=f.topic('qa',false,reader('m')),normal=f.topic();
  assert.equal((await f.post('reports',{kind:'topic',id:superior.id,reason:'人身攻击'})).status,403);
  assert.equal(f.store.topic(superior.id)?.hidden,false);assert.equal(f.store.openReports().length,0);
  const reported=await f.post('reports',{kind:'topic',id:normal.id,reason:'人身攻击'});assert.equal(reported.status,201);assert.equal((await reported.json()).hidden,true);
  assert.equal(f.store.topic(normal.id)?.hidden,true);
});
test('paid recommendations expose only public metadata and never a complete prompt',async t=>{
  const f=await setup(t),prompt='PRIVATE-PAID-PROMPT-regression';
  const topic=f.store.createTopic({board:'qa',author:reader('r'),title:'付费提示词回归',body:'真实带元数据的作品内容',meta:{tools:'tool',model:'model',usage:'个人使用',prompt,promptMode:'paid',price:20}});
  assert.equal((await f.post(`topics/${topic.id}/feature-recommend`,{reason:'推荐内容'})).status,200);
  const response=await f.get('manage?tab=features','m');assert.equal(response.status,200);const body=await response.text();assert.equal(body.includes(prompt),false);
  const queue=JSON.parse(body);assert.equal(queue.features[0].topic.meta.price,20);assert.equal(queue.features[0].topic.meta.promptMode,'paid');assert.equal(Object.hasOwn(queue.features[0].topic.meta,'prompt'),false);assert.equal(Object.hasOwn(queue.features[0].topic,'fullMeta'),false);
});
test('summary excludes private board aggregates after initial or late ancestor deactivation',async t=>{
  const f=await setup(t),privateTopic=f.topic('vip');f.store.addReply({topicId:privateTopic.id,author:reader('r'),body:'会员私密回复'});
  f.accounts.get('g')!.active=false;
  const initial=await(await f.get('summary','m')).json();assert.equal(initial.total,0);assert.equal(initial.repliesToday,0);assert.equal(initial.boards.vip,undefined);assert.deepEqual(initial.hot,[]);
  f.accounts.get('g')!.active=true;let calls=0;f.onPeople(()=>{if(++calls===2)f.accounts.get('g')!.active=false;});
  const late=await(await f.get('summary','m')).json();assert.equal(late.total,0);assert.equal(late.repliesToday,0);assert.equal(late.boards.vip,undefined);assert.deepEqual(late.hot,[]);
});
test('profile queue waits cannot return content or report data after their inspection capabilities are removed',async t=>{
  const f=await setup(t);f.grant(['content.inspect','report.review','profile.avatar.advise']);const pending=f.topic('qa',true);f.store.report({target:{kind:'topic',id:pending.id},reporter:reader('other'),reason:'人身攻击',note:'private report note'});
  f.onReviews(()=>{f.grant(['profile.avatar.advise']);});
  const result=await f.get('manage?tab=profiles');assert.equal(result.status,403);const body=await result.text();assert.equal(body.includes('private report note'),false);assert.equal(body.includes(pending.body),false);
});
