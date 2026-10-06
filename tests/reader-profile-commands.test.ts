import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Payload } from 'payload';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderProfileCommands, normalizeReaderAvatar } from '../server/reader-profile-commands.ts';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'reader-profile-commands-'));
  const readerId = randomUUID();
  const row = { id: readerId, nickname: '测试读者', signature: '已通过签名', avatar: null as string|null, _verified: true, disabled: false };
  const payload = {
    findByID: async ({ id }: {id:string}) => { if(id !== row.id) throw Object.assign(Error('missing'),{status:404}); return {...row}; },
    update: async ({ id, data }: {id:string;data:Partial<typeof row>}) => { assert.equal(id, row.id); Object.assign(row,data); return {...row}; },
    find: async ({ where }: {where:{avatar:{equals:string}}}) => ({totalDocs: row.avatar === where.avatar.equals ? 1 : 0}),
  } as unknown as Payload;
  const workflow = createReaderWorkflow(directory, 'profile-test-secret-with-at-least-32-characters');
  const commands = createReaderProfileCommands({payload,directory,workflow,uidStore:{get:()=> '10001'}});
  t.after(async()=>{ await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}); });
  return {directory,readerId,row,workflow,commands,payload};
}

test('signature submission reuses the main pending proposal and leaves approved data intact',async t=>{
  const f=await fixture(t);
  const state=await f.commands.submitSignature(f.readerId,'新的签名');
  assert.equal(state.signature,'已通过签名'); assert.equal(state.pendingSignature,'新的签名');
  assert.equal(f.row.signature,'已通过签名');
  await assert.rejects(f.commands.submitSignature(f.readerId,'vx:contact'),{status:400});
  await assert.rejects(f.commands.submitSignature(f.readerId,'a\nb'),{status:400});
  const cancelled=await f.commands.submitSignature(f.readerId,'已通过签名');
  assert.equal(cancelled.pendingSignature,null);
});

test('avatars remain pending, share review with main, and record the actual community reviewer',async t=>{
  const f=await fixture(t);
  const png=await sharp({create:{width:128,height:128,channels:4,background:'#aabbff'}}).png().toBuffer();
  const image=await normalizeReaderAvatar(png,'image/png');
  const state=await f.commands.submitAvatar(f.readerId,image);
  assert.equal(state.avatar,null); assert.equal(state.pendingAvatar,true);
  assert.deepEqual(await f.commands.pendingAvatar(f.readerId),image);
  const [proposal]=await f.commands.reviews(['avatar']);
  const moderator={kind:'reader' as const,id:'moderator-a',source:'community' as const};
  const decision=await f.commands.review(proposal.id,'approve',moderator,['avatar']);
  assert.deepEqual(decision,{ok:true,id:proposal.id,kind:'avatar',decision:'approve'});
  assert.equal((await f.commands.state(f.readerId)).pendingAvatar,false);
  assert.ok(f.row.avatar);
  const entry=JSON.parse((await readFile(resolve(f.directory,'reader-admin-audit.jsonl'),'utf8')).trim());
  assert.equal(entry.actorId,'moderator-a');assert.equal(entry.actorKind,'reader');assert.equal(entry.source,'community');
  assert.equal(entry.readerId,f.readerId);assert.equal(entry.reviewId,proposal.id);
  await assert.rejects(f.commands.review(proposal.id,'reject',moderator,['avatar']),{status:404});
});

test('replaced review IDs and avatar-only reviewers cannot affect a newer proposal or a signature',async t=>{
  const f=await fixture(t),actor={kind:'reader' as const,id:'moderator-a',source:'community' as const};
  await f.commands.submitSignature(f.readerId,'第一版');
  const [old]=await f.commands.reviews(['signature']);
  await f.commands.submitSignature(f.readerId,'第二版');
  await assert.rejects(f.commands.review(old.id,'approve',actor,['avatar','signature']),{status:404});
  const [current]=await f.commands.reviews(['signature']);
  await assert.rejects(f.commands.review(current.id,'approve',actor,['avatar']),{status:403});
  assert.equal((await f.commands.state(f.readerId)).pendingSignature,'第二版');
  assert.equal(f.row.signature,'已通过签名');
});

test('parallel main and community decisions approve a proposal once and removal uses the same serialization',async t=>{
  const f=await fixture(t),actor={kind:'owner' as const,id:'owner-a',source:'main' as const};
  await f.commands.submitSignature(f.readerId,'等待审核');
  const [proposal]=await f.commands.reviews(['signature']);
  const secondAdapter=createReaderProfileCommands({payload:f.payload,directory:f.directory,workflow:f.workflow,uidStore:{get:()=> '10001'}});
  const results=await Promise.allSettled([f.commands.review(proposal.id,'approve',actor),secondAdapter.review(proposal.id,'reject',actor)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const rejected=results.find(result=>result.status==='rejected');assert.ok(rejected&&rejected.status==='rejected');assert.equal(rejected.reason.status,404);
  assert.equal(f.row.signature,'等待审核');
  const image=await sharp({create:{width:320,height:320,channels:4,background:'#ccccff'}}).webp().toBuffer();
  await f.commands.submitAvatar(f.readerId,image);
  const removed=await f.commands.removeAvatar(f.readerId);
  assert.equal(removed.avatar,null); assert.equal(removed.pendingAvatar,false);
  await assert.rejects(f.commands.pendingAvatar(f.readerId),{status:404});
});

test('commands recheck revoked sessions before writes and reject missing or disabled readers',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.commands.submitSignature(f.readerId,'新签名',async()=>{throw Object.assign(Error('revoked'),{status:401});}),{status:401});
  assert.equal(f.workflow.profileFor(f.readerId,'signature'),null);
  f.row.disabled=true;
  await assert.rejects(f.commands.submitSignature(f.readerId,'新签名'),{status:404});
});

for (const kind of ['signature','avatar'] as const) for (const change of ['disabled','deleted'] as const) {
  test(`${kind} approval preserves its proposal when the target is ${change} while reviewer authentication awaits`,async t=>{
    const f=await fixture(t),actor={kind:'owner' as const,id:'owner-a',source:'main' as const};
    const image=kind==='avatar' ? await sharp({create:{width:320,height:320,channels:4,background:'#ccccff'}}).webp().toBuffer() : null;
    if(image) await f.commands.submitAvatar(f.readerId,image); else await f.commands.submitSignature(f.readerId,'等待审核');
    const proposal=f.workflow.profileFor(f.readerId,kind);assert.ok(proposal);
    let checks=0,deleted=false;
    const find=f.payload.findByID.bind(f.payload);
    f.payload.findByID=async args=>{if(deleted) throw Object.assign(Error('missing'),{status:404});return find(args);};
    await assert.rejects(f.commands.review(proposal.id,'approve',actor,[kind],async()=>{
      if(++checks===2){if(change==='disabled') f.row.disabled=true;else deleted=true;}
    }),{status:404});
    assert.equal(f.row.signature,'已通过签名');assert.equal(f.row.avatar,null);
    assert.equal(f.workflow.profileFor(f.readerId,kind)?.id,proposal.id);
    if(image) assert.deepEqual(await readFile(resolve(f.directory,'uploads',`pending-reader-avatar-${proposal.proposed_value}.webp`)),image);
  });
}

test('account inactivation shares the profile mutation boundary across adapters',async t=>{
  const f=await fixture(t),actor={kind:'owner' as const,id:'owner-a',source:'main' as const};
  await f.commands.submitSignature(f.readerId,'等待审核');
  const proposal=f.workflow.profileFor(f.readerId,'signature');assert.ok(proposal);
  const secondAdapter=createReaderProfileCommands({payload:f.payload,directory:f.directory,workflow:f.workflow,uidStore:{get:()=> '10001'}});
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const waiting=new Promise<void>(resolve=>{started=resolve;});
  const update=f.payload.update.bind(f.payload);
  f.payload.update=async args=>{started();await gate;return update(args);};
  const decision=f.commands.review(proposal.id,'approve',actor);
  await waiting;
  let disabled=false;
  const inactivate=secondAdapter.accountMutation(async()=>{disabled=true;f.row.disabled=true;});
  await Promise.resolve();assert.equal(disabled,false);
  release();await decision;await inactivate;
  assert.equal(f.row.signature,'等待审核');assert.equal(f.row.disabled,true);
  assert.equal(f.workflow.profileFor(f.readerId,'signature'),null);
});

test('avatar move rolls back and preserves pending when authorization or target activity changes before account update',async t=>{
  const f=await fixture(t),actor={kind:'owner' as const,id:'owner-a',source:'main' as const};
  const image=await sharp({create:{width:320,height:320,channels:4,background:'#ccccff'}}).webp().toBuffer();
  await f.commands.submitAvatar(f.readerId,image);
  const proposal=f.workflow.profileFor(f.readerId,'avatar');assert.ok(proposal);
  let checks=0;
  await assert.rejects(f.commands.review(proposal.id,'approve',actor,['avatar'],async()=>{if(++checks===3)f.row.disabled=true;}),{status:404});
  assert.equal(f.row.avatar,null);assert.equal(f.workflow.profileFor(f.readerId,'avatar')?.id,proposal.id);
  assert.deepEqual(await readFile(resolve(f.directory,'uploads',`pending-reader-avatar-${proposal.proposed_value}.webp`)),image);
  await assert.rejects(readFile(resolve(f.directory,'uploads',`reader-avatar-${proposal.proposed_value}.webp`)),{code:'ENOENT'});
});
