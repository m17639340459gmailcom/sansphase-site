import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Payload } from 'payload';
import { chmod, chown, lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareOwnerReaderAccount, readOwnerReaderId, writeOwnerReaderBinding } from '../server/owner-reader.ts';

function fixture() {
  const ownerId=randomUUID(),readerId=randomUUID(),email='owner@example.invalid';
  const readers=new Map<string,{id:string;email:string;nickname:string;_verified:boolean;disabled:boolean;avatar?:string;signature?:string}>();
  let created=0,saved:string|undefined;const uids=new Map<string,string>();
  const payload={
    findByID:async({collection,id}:{collection:string;id:string})=>{if(collection==='authors'&&id===ownerId)return{id,email,role:'owner'};const row=readers.get(id);if(!row)throw Object.assign(Error('missing'),{status:404});return{...row};},
    find:async()=>({docs:[...readers.values()].filter(row=>row.email===email)}),
    create:async({collection,data,disableVerificationEmail}:{collection:string;data:Record<string,unknown>;disableVerificationEmail:boolean})=>{
      assert.equal(collection,'readers');assert.equal(disableVerificationEmail,true);assert.equal(data._verified,true);assert.equal(data.email,email);
      assert.equal(typeof data.password,'string');assert.ok(String(data.password).length>=32);
      assert.ok(!('avatar'in data));assert.ok(!('signature'in data));assert.ok(!('vip_until'in data));created++;
      const row={id:readerId,email,nickname:String(data.nickname),_verified:true,disabled:false};readers.set(readerId,row);return{...row};
    },
  }as unknown as Payload;
  const uidStore={assignRandom:(id:string)=>{uids.set(id,'100123');return'100123';},get:(id:string)=>{const uid=uids.get(id);if(!uid)throw Error('missing UID');return uid;}};
  const saveBinding=async(id:string)=>{saved=id;};
  return{ownerId,readerId,email,readers,uids,payload,uidStore,saveBinding,get created(){return created;},get saved(){return saved;}};
}

test('private owner-reader binding must be an explicit UUID and never guesses an identity',()=>{
  assert.equal(readOwnerReaderId({}),undefined);const id=randomUUID();assert.equal(readOwnerReaderId({ownerReaderId:id}),id);
  for(const value of [null,'owner','10001',1,'',id.toUpperCase()])assert.throws(()=>readOwnerReaderId({ownerReaderId:value}));
});

test('explicit preparation creates one verified reader and repeated execution preserves profile and binding',async()=>{
  const f=fixture();const first=await prepareOwnerReaderAccount({...f,nickname:'我的身份'});
  assert.deepEqual(first,{created:true,readerId:f.readerId,uid:'100123'});assert.equal(f.saved,f.readerId);assert.equal(f.created,1);
  f.readers.get(f.readerId)!.signature='独立个人签名';
  const again=await prepareOwnerReaderAccount({...f,ownerReaderId:f.saved,nickname:'不应覆盖'});
  assert.equal(again.created,false);assert.equal(f.created,1);assert.equal(f.readers.get(f.readerId)!.nickname,'我的身份');assert.equal(f.readers.get(f.readerId)!.signature,'独立个人签名');
});

test('an unbound same-email reader stops preparation without taking over any existing account',async()=>{
  const f=fixture();f.readers.set(f.readerId,{id:f.readerId,email:f.email,nickname:'已有读者',_verified:true,disabled:false});
  await assert.rejects(prepareOwnerReaderAccount({...f,nickname:'我的身份'}),/explicit|明确/u);assert.equal(f.created,0);assert.equal(f.saved,undefined);
});

test('missing, unverified or disabled explicit binding fails without silently creating another reader',async()=>{
  for(const variant of ['missing','unverified','disabled']){
    const f=fixture();if(variant!=='missing')f.readers.set(f.readerId,{id:f.readerId,email:f.email,nickname:'已有读者',_verified:variant!=='unverified',disabled:variant==='disabled'});
    await assert.rejects(prepareOwnerReaderAccount({...f,ownerReaderId:f.readerId}),/active|有效/u);assert.equal(f.created,0);assert.equal(f.saved,undefined);
  }
});

test('a binding-save failure preserves the created entity and a retry stops rather than creating a duplicate',async()=>{
  const f=fixture();await assert.rejects(prepareOwnerReaderAccount({...f,nickname:'我的身份',saveBinding:async()=>{throw Error('disk failed');}}),/关联|binding/u);
  assert.equal(f.created,1);assert.equal(f.readers.size,1);
  await assert.rejects(prepareOwnerReaderAccount({...f,nickname:'我的身份'}),/explicit|明确/u);assert.equal(f.created,1);
});

test('binding save preserves unrelated private settings and refuses a changed or already-bound config',async t=>{
  const directory=await mkdtemp(resolve(tmpdir(),'owner-reader-private-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(resolve(directory,'data'));
  const path=resolve(directory,'private.json'),original=JSON.stringify({secret:'private-test-value',directory:resolve(directory,'data'),communityIdentity:{untouched:true}}),id=randomUUID();
  await writeFile(path,original,{mode:0o600});await writeOwnerReaderBinding(path,original,id);
  const settings=JSON.parse(await readFile(path,'utf8'));assert.equal(settings.ownerReaderId,id);assert.equal(settings.secret,'private-test-value');assert.deepEqual(settings.communityIdentity,{untouched:true});
  const bound=await readFile(path,'utf8');await assert.rejects(writeOwnerReaderBinding(path,bound,randomUUID()),/binding already exists/);assert.equal(await readFile(path,'utf8'),bound);
  await writeFile(path,original,{mode:0o600});await assert.rejects(writeOwnerReaderBinding(path,original+' ',id),/changed/);assert.equal(await readFile(path,'utf8'),original);
});

test('atomic binding replacement preserves Unix config ownership and exact private permissions', { skip: process.platform === 'win32' }, async t=>{
  const directory=await mkdtemp(resolve(tmpdir(),'owner-reader-owner-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=resolve(directory,'private.json'),original=JSON.stringify({secret:'private-test-value'}),id=randomUUID();
  await writeFile(path,original,{mode:0o600});
  // Root maintenance must not replace a service-owned config with a root-owned file.
  // On ordinary Unix runs, also verify the caller's existing ownership is retained.
  if(process.getuid?.()===0)await chown(path,65534,65534);
  await chmod(path,0o400);
  const before=await lstat(path);await writeOwnerReaderBinding(path,original,id);const after=await lstat(path);
  assert.equal(after.uid,before.uid);assert.equal(after.gid,before.gid);assert.equal(after.mode&0o777,before.mode&0o777);
  assert.equal(JSON.parse(await readFile(path,'utf8')).ownerReaderId,id);
});
