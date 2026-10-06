import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { migrateReaderAccounts } from '../server/payload/reader-migration.ts';

test('explicit owner preparation against real Payload is idempotent and leaves brand, accounts, and activity untouched',{timeout:60000},async t=>{
  const directory=await mkdtemp(resolve(tmpdir(),'owner-reader-prepare-')),data=resolve(directory,'data'),publicRoot=resolve(directory,'public');
  await mkdir(data);await mkdir(publicRoot);t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const settings={directory:data,secret:randomBytes(48).toString('hex'),siteOrigin:'https://www.sansphase.com',sourceURL:'https://www.sansphase.com',authorId:randomUUID(),privateSetting:{preserve:true}};
  const payload=await getPayload({config:makePayloadConfig({...settings,push:true})});
  try{
    await payload.create({collection:'authors',data:{id:settings.authorId,email:'owner@example.invalid',password:'test-owner-password',first_name:'品牌作者',role:'owner'}});
    await payload.create({collection:'site_profile',data:{name:'博客品牌',signature:'品牌原签名',avatar:randomUUID()}});
    await payload.create({collection:'readers',data:{email:'ordinary@example.invalid',password:'ordinary-reader-password',nickname:'普通读者',_verified:true,disabled:false},disableVerificationEmail:true});
  }finally{await payload.destroy();payload.db.client.close();}
  await writeFile(resolve(data,'migration-complete.json'),JSON.stringify({provider:'payload'}));await migrateReaderAccounts(data);
  const configPath=resolve(directory,'private.json');await writeFile(configPath,JSON.stringify(settings),{mode:0o600});
  const db=new DatabaseSync(resolve(data,'content.db'),{readOnly:true});
  const before={author:db.prepare('SELECT * FROM authors').all(),brand:db.prepare('SELECT * FROM site_profile').all(),ordinary:db.prepare("SELECT * FROM readers WHERE email='ordinary@example.invalid'").all(),logins:db.prepare('SELECT * FROM login_events').all()};db.close();
  const run=(nickname)=>promisify(execFile)(process.execPath,['scripts/prepare-owner-reader.mjs','--apply',...(nickname?[`--nickname=${nickname}`]:[]),`--public-root=${publicRoot}`],{cwd:process.cwd(),env:{...process.env,PAYLOAD_CONFIG_FILE:configPath},windowsHide:true});
  const first=JSON.parse((await run('个人测试')).stdout.trim().split('\n').at(-1));assert.equal(first.prepared,true);assert.equal(first.created,true);
  const bound=await readFile(configPath,'utf8'),parsed=JSON.parse(bound);assert.equal(parsed.ownerReaderId,first.readerId);assert.deepEqual(parsed.privateSetting,{preserve:true});assert.equal(parsed.secret,settings.secret);
  const again=JSON.parse((await run()).stdout.trim().split('\n').at(-1));assert.equal(again.created,false);assert.equal(again.readerId,first.readerId);assert.equal(again.uid,first.uid);assert.equal(await readFile(configPath,'utf8'),bound);
  const after=new DatabaseSync(resolve(data,'content.db'),{readOnly:true});
  try{
    assert.deepEqual(after.prepare('SELECT * FROM authors').all(),before.author);assert.deepEqual(after.prepare('SELECT * FROM site_profile').all(),before.brand);assert.deepEqual(after.prepare("SELECT * FROM readers WHERE email='ordinary@example.invalid'").all(),before.ordinary);assert.deepEqual(after.prepare('SELECT * FROM login_events').all(),before.logins);
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM readers').get().n,2);
    const personal=after.prepare('SELECT * FROM readers WHERE id=?').get(first.readerId);assert.equal(personal.nickname,'个人测试');assert.equal(personal._verified,1);assert.equal(personal.signature,null);assert.equal(personal.avatar,null);assert.equal(personal.vip_until,null);assert.ok(personal.hash);assert.equal(personal.phone,null);
  }finally{after.close();}
  await assert.rejects(access(configPath+'.owner-reader.lock'),{code:'ENOENT'});
  await assert.rejects(access(resolve(data,'reader-workflow.db')),{code:'ENOENT'});
  // Exercise real author login, strict JWT/session validation, runtime wiring,
  // personal profile review, and the unchanged public brand on the same data.
  const verify=`import assert from 'node:assert/strict';
    import {createPayloadRuntime} from './server/payload/runtime.ts';
    import {createPreviewServer} from './server.mjs';
    const runtime=await createPayloadRuntime(process.argv[1]);
    const server=createPreviewServer({...runtime,root:process.argv[2]});
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const base='http://127.0.0.1:'+server.address().port,origin=runtime.settings.siteOrigin;
    try{
      const login=await fetch(base+'/api/reader/login',{method:'POST',headers:{Origin:origin,'X-Reader-Request':'1','Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.invalid',password:'test-owner-password'})});
      assert.equal(login.status,200);assert.equal((await login.json()).role,'owner');
      const cookie=login.headers.getSetCookie()[0].split(';')[0],req={headers:{cookie}};
      assert.equal(await runtime.readerService.identityStrict(req),null);assert.ok(await runtime.authorService.identityStrict(req));
      let response=await fetch(base+'/api/reader/session',{headers:{cookie}}),personal=await response.json();
      assert.equal(personal.ownerReader,true);assert.equal(personal.nickname,'个人测试');assert.equal(personal.id,runtime.settings.ownerReaderId);
      response=await fetch(base+'/api/reader/profile',{method:'POST',headers:{cookie,Origin:origin,'X-Reader-Request':'1','Content-Type':'application/json'},body:JSON.stringify({nickname:'个人昵称',signature:'个人新签名'})});assert.equal(response.status,200);assert.equal((await response.json()).pendingSignature,'个人新签名');
      const pending=await(await fetch(base+'/api/manage/review',{headers:{cookie}})).json(),proposal=pending.profiles.find(row=>row.kind==='signature');assert.ok(proposal);assert.equal(proposal.readerId,runtime.settings.ownerReaderId);
      response=await fetch(base+'/api/manage/review/profile/'+proposal.id+'/approve',{method:'POST',headers:{cookie,Origin:origin,'X-Author-Request':'1','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);
      personal=await(await fetch(base+'/api/reader/session',{headers:{cookie}})).json();assert.equal(personal.signature,'个人新签名');assert.equal(personal.ownerReader,true);
      const brand=await(await fetch(base+'/api/author/profile',{headers:{cookie}})).json();assert.equal(brand.name,'博客品牌');assert.equal(brand.signature,'品牌原签名');
      console.log(JSON.stringify({verified:true}));
    }finally{await new Promise(done=>server.close(done));await runtime.close();}`;
  const verification=await promisify(execFile)(process.execPath,['--input-type=module','-e',verify,configPath,publicRoot],{cwd:process.cwd(),env:{...process.env,SITE_ORIGIN:settings.siteOrigin},windowsHide:true});
  assert.deepEqual(JSON.parse(verification.stdout.trim().split('\n').at(-1)),{verified:true});
  // A config lacking an explicit association must not silently take over this
  // same-email entity, even when it was created by an earlier successful run.
  await writeFile(configPath,JSON.stringify(settings),{mode:0o600});await assert.rejects(run('不能再建'),/明确/u);assert.equal(JSON.parse(await readFile(configPath,'utf8')).ownerReaderId,undefined);
});
