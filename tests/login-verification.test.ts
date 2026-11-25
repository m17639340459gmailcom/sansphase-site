import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createLoginVerification, readLoginVerificationSettings, loginVerificationLifetimeMs } from '../server/login-verification.ts';
import type { TestContext } from 'node:test';
import type { LoginNamespace } from '../server/login-verification.ts';
const siteOrigin = 'https://www.example.test', secret = 'payload-'.padEnd(64, 'p');
const settings = { enabled: true as const, engine: 'tianai' as const, serviceOrigin: 'http://127.0.0.1:4253', serviceSecret: 'service-'.padEnd(64, 's'), hmacSecret: 'hmac-'.padEnd(64, 'h'), keySecret: 'key-'.padEnd(64, 'k') };
const track = () => ({ bgImageWidth: 300, bgImageHeight: 180, templateImageWidth: 55, templateImageHeight: 180, startTime: Date.now() - 1300, stopTime: Date.now(), left: 145, top: 0, trackList: Array.from({length:20},(_,i)=>({x:i*7,y:i%3,t:i*60,type:i===0?'DOWN':i===19?'UP':'MOVE'})) });
function request(cookie = '', proof?: string) {
  const socket = new Socket(); Object.defineProperty(socket, 'remoteAddress', {value:'127.0.0.1'});
  const req = new IncomingMessage(socket); req.headers = {origin:siteOrigin,cookie,'x-real-ip':'198.51.100.21',...(proof?{'x-login-verification':proof}:{})}; return req;
}
async function fixture(t:TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(),'sansphase-slider-')); t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:5}));
  const workflow=createReaderWorkflow(directory,secret); let current=Date.now(), offline=false, wrong=false, badImage=false; const calls:string[]=[];
  const engineRequest:typeof fetch=async(url,init)=>{
    const u=new URL(String(url)); assert.equal(u.origin,settings.serviceOrigin); assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer '+settings.serviceSecret); assert.ok(init?.signal);
    calls.push(u.pathname); if(offline) throw Error('offline'); if(u.pathname==='/verify') return Response.json({verified:!wrong});
    return Response.json({id:randomUUID(),type:'SLIDER',backgroundImage:badImage?'https://evil.test/i':'data:image/jpeg;base64,/9j/2Q==',templateImage:'data:image/png;base64,iVBORw0KGgo=',backgroundImageWidth:600,backgroundImageHeight:360,templateImageWidth:110,templateImageHeight:360,randomX:200});
  };
  const options={directory,siteOrigin,settings,workflow,now:()=>current,engineRequest},guard=createLoginVerification(options);
  return {directory,options,guard,calls,advance:(ms:number)=>{current+=ms;},offline:()=>{offline=true;},wrong:()=>{wrong=true;},badImage:()=>{badImage=true;}};
}
async function challenge(guard:ReturnType<typeof createLoginVerification>,namespace:LoginNamespace='reader',cookie=''){
  const req=request(cookie),res=new ServerResponse(req),issued=await guard.issue(req,res,namespace); if(!issued.enabled) throw Error('Enabled fixture');
  const value=res.getHeader('Set-Cookie'); return {challenge:issued.challenge,cookie:value?String(Array.isArray(value)?value.at(-1):value).split(';')[0]:cookie};
}
async function proof(guard:ReturnType<typeof createLoginVerification>,namespace:LoginNamespace='reader',cookie=''){
  const p=await challenge(guard,namespace,cookie),result=await guard.match(request(p.cookie),namespace,{token:p.challenge.token,track:track()});return {...p,payload:result.proof};
}
const status=(expected:number)=>(error:unknown)=>!!error&&typeof error==='object'&&'status' in error&&error.status===expected;
test('explicit slider config requires independent keys and literal loopback service',()=>{
 assert.equal(readLoginVerificationSettings(undefined,secret),null);assert.equal(readLoginVerificationSettings({enabled:false},secret),null);assert.deepEqual(readLoginVerificationSettings(settings,secret),settings);
 for(const value of [null,false,{}, {enabled:true},{...settings,engine:'other'},{...settings,serviceOrigin:'https://external.test'},{...settings,serviceOrigin:'http://localhost:4253'},{...settings,serviceOrigin:'http://127.0.0.1:4253/other'},{...settings,hmacSecret:'short'},{...settings,keySecret:settings.hmacSecret},{...settings,serviceSecret:secret},{...settings,serviceSecret:'密钥'.repeat(32)},{...settings,serviceSecret:'x'.repeat(513)},{...settings,extra:true}]) assert.throws(()=>readLoginVerificationSettings(value,secret));
 assert.throws(()=>readLoginVerificationSettings(settings,secret,[settings.keySecret]));
});
test('disabled config preserves login compatibility without opening storage',async()=>{
 const guard=createLoginVerification({directory:'',siteOrigin,settings:null,workflow:{consumeAuthLimits:()=>{throw Error('disabled');}}}),req=request();
 assert.deepEqual(await guard.issue(req,new ServerResponse(req),'reader'),{enabled:false});await guard.verify(req,'author');await assert.rejects(guard.match(req,'reader',{}),status(403));
});
test('challenge is not login proof; matched proof is bound, single-use, restart safe',async t=>{
 const f=await fixture(t),p=await proof(f.guard);
 for(const [cookie,value,ns] of [[p.cookie,p.challenge.token,'reader'],['',p.payload,'reader'],[p.cookie,p.payload,'author']] as const) await assert.rejects(f.guard.verify(request(cookie,value),ns),status(403));
 const altered=request(p.cookie,p.payload);altered.headers.origin='https://other.test';await assert.rejects(f.guard.verify(altered,'reader'),status(403));
 await f.guard.verify(request(p.cookie,p.payload),'reader');await assert.rejects(createLoginVerification(f.options).verify(request(p.cookie,p.payload),'reader'),status(403));
 const db=new DatabaseSync(resolve(f.directory,'login-verification.db'),{readOnly:true});try{const rows=db.prepare('SELECT * FROM login_verification_used').all();assert.equal(rows.length,2);assert.equal(JSON.stringify(rows).includes(p.payload),false);assert.equal(JSON.stringify(rows).includes(p.cookie),false);}finally{db.close();}
});
test('public image whitelist strips engine answers and keeps private secrets private',async t=>{
 const f=await fixture(t),p=await challenge(f.guard);assert.equal(Object.hasOwn(p.challenge,'randomX'),false);assert.equal(JSON.stringify(p).includes(settings.serviceSecret),false);f.badImage();await assert.rejects(challenge(f.guard),status(503));
});
test('malformed or tampered proofs cannot consume a valid proof',async t=>{
 const f=await fixture(t),p=await proof(f.guard);for(const v of [undefined,'invalid!','A'.repeat(9000),Buffer.from('{}').toString('base64url'),p.payload+'a',p.payload.replace(/^./,p.payload[0]==='e'?'f':'e')])await assert.rejects(f.guard.verify(request(p.cookie,v),'reader'),status(403));await f.guard.verify(request(p.cookie,p.payload),'reader');
});
test('local expiry precedes upstream cache matching',async t=>{
 const f=await fixture(t),p=await challenge(f.guard);f.advance(loginVerificationLifetimeMs+1);await assert.rejects(f.guard.match(request(p.cookie),'reader',{token:p.challenge.token,track:track()}),status(403));assert.deepEqual(f.calls,['/challenge']);
});
test('matched login proof also expires',async t=>{
 const f=await fixture(t),p=await proof(f.guard);f.advance(loginVerificationLifetimeMs+1);await assert.rejects(f.guard.verify(request(p.cookie,p.payload),'reader'),status(403));
});
test('binding and namespace are enforced before matching',async t=>{
 const f=await fixture(t),p=await challenge(f.guard),body={token:p.challenge.token,track:track()};await assert.rejects(f.guard.match(request(),'reader',body),status(403));await assert.rejects(f.guard.match(request(p.cookie),'author',body),status(403));assert.deepEqual(f.calls,['/challenge']);assert.ok((await f.guard.match(request(p.cookie),'reader',body)).proof);
});
test('wrong answers and engine failure each consume attempt once and stay closed',async t=>{
 const f=await fixture(t),p=await challenge(f.guard);f.wrong();for(let i=0;i<2;i++)await assert.rejects(f.guard.match(request(p.cookie),'reader',{token:p.challenge.token,track:track()}),status(403));assert.equal(f.calls.filter(v=>v==='/verify').length,1);
 const g=await fixture(t),q=await challenge(g.guard);g.offline();await assert.rejects(g.guard.match(request(q.cookie),'reader',{token:q.challenge.token,track:track()}),status(503));await assert.rejects(g.guard.match(request(q.cookie),'reader',{token:q.challenge.token,track:track()}),status(403));
});
test('untrusted track bounds are checked before sending to service',async t=>{
 const f=await fixture(t),p=await challenge(f.guard);
 for(const bad of [{...track(),extra:true},{...track(),trackList:Array(513).fill({x:0,y:0,t:0,type:'MOVE'})},{...track(),left:Infinity},{...track(),bgImageWidth:999999},{...track(),templateImageHeight:1},{...track(),trackList:[{x:0,y:0,t:0,type:'OTHER'}]},{...track(),trackList:[{x:0,y:0,t:0,type:['MOVE']}]}])await assert.rejects(f.guard.match(request(p.cookie),'reader',{token:p.challenge.token,track:bad}),status(400));
 assert.deepEqual(f.calls,['/challenge']);
});
test('parallel matching and login consumption each allow exactly one',async t=>{
 const f=await fixture(t),p=await challenge(f.guard),matches=await Promise.allSettled(Array.from({length:6},()=>createLoginVerification(f.options).match(request(p.cookie),'reader',{token:p.challenge.token,track:track()})));assert.equal(matches.filter(v=>v.status==='fulfilled').length,1);
 const good=matches.find(v=>v.status==='fulfilled');if(good?.status!=='fulfilled')throw Error('No proof');
 const logins=await Promise.allSettled(Array.from({length:6},()=>createLoginVerification(f.options).verify(request(p.cookie,good.value.proof),'reader')));assert.equal(logins.filter(v=>v.status==='fulfilled').length,1);
});
test('new challenges renew the same browser binding across tabs',async t=>{
 const f=await fixture(t),a=await proof(f.guard),b=await proof(f.guard,'author',a.cookie);assert.equal(a.cookie,b.cookie);await f.guard.verify(request(a.cookie,a.payload),'reader');await f.guard.verify(request(a.cookie,b.payload),'author');
});
test('shared durable quotas apply across namespaces and guard restarts',async t=>{
 const f=await fixture(t);for(let i=0;i<30;i++)await challenge(f.guard,i%2?'reader':'author');await assert.rejects(challenge(createLoginVerification(f.options)),status(429));f.advance(60001);assert.ok(await challenge(f.guard));
 for(let i=0;i<30;i++)await assert.rejects(f.guard.match(request(),i%2?'author':'reader',{}),status(400));await assert.rejects(createLoginVerification(f.options).match(request(),'reader',{}),status(429));
});
test('failed replay storage or unavailable engines never permit login',async t=>{
 const f=await fixture(t),p=await proof(f.guard),path=resolve(f.directory,'login-verification.db');await rm(path);await mkdir(path);await assert.rejects(f.guard.verify(request(p.cookie,p.payload),'reader'),status(503));
 const g=await fixture(t);g.offline();await assert.rejects(challenge(g.guard),status(503));
});
