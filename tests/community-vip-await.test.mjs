import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { createCommunityListingFixture, owner, reader } from './fixtures/community-listing.mjs';
import sharp from 'sharp';

const setup = createCommunityListingFixture(test);

for(const change of ['disabled','different principal','valid']) test(`late image registration checks a ${change} account and cleans rejected files`,async t=>{
  const f=await setup(t);
  const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#445566'}}).png().toBuffer();
  let finalFile=false,id;
  f.onIdentify(value=>{if(finalFile&&change==='different principal'&&value)value.id='reader';});
  const original=fs.writeFile;
  const write=t.mock.method(fs,'writeFile',async(...args)=>{
    await original(...args);
    const match=/community-thumb-([0-9a-f-]{36})\.webp$/.exec(String(args[0]));
    if(match){id=match[1];finalFile=true;if(change==='disabled')f.accounts.get('vip').active=false;}
  });
  syncBuiltinESMExports();
  try {
    const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'synthetic.png');
    const response=await fetch(`${f.origin}/api/community/images`,{method:'POST',headers:{Cookie:'vip',Origin:f.origin,'X-Reader-Request':'1'},body:form});
    assert.equal(finalFile,true,'the account changes only after thumbnail bytes reach disk');
    assert.equal(response.status,change==='valid'?201:401,await response.clone().text());
    if(change==='valid') { assert.ok(f.store.image(id)); assert.equal((await fs.readdir(resolve(f.directory,'uploads'))).filter(name=>name.includes(id)).length,2); }
    else { assert.equal(f.store.image(id),null); assert.equal((await fs.readdir(resolve(f.directory,'uploads'))).filter(name=>name.includes(id)).length,0); }
  } finally {write.mock.restore();syncBuiltinESMExports();}
});

const post = (f,path,body,identity='vip') => fetch(`${f.origin}/api/community/${path}`,{
  method:'POST',headers:{Cookie:identity,Origin:f.origin,'X-Reader-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body),
});
async function delayedBody(f,path,body,expire) {
  let started; const seen=new Promise(done=>{started=done;});
  let first=true;
  f.onIdentify(()=>{if(first){first=false;started();}});
  const text=JSON.stringify(body);
  let req;
  const received=new Promise((done,reject)=>{
    req=request(`${f.origin}/api/community/${path}`,{method:'POST',headers:{Cookie:'vip',Origin:f.origin,'X-Reader-Request':'1','Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done({status:res.statusCode,text:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.write(text.slice(0,1));
  });
  await seen;
  if(expire)f.accounts.get('vip').vip=false;
  req.end(text.slice(1));
  return received;
}

for(const action of ['topics','replies','like','bookmark']) for(const expire of [true,false]) {
  test(`${action} checks ${expire?'expired':'valid'} membership after a delayed request body without accidental writes`,async t=>{
    const f=await setup(t), id=randomUUID(), vip=reader('vip');
    f.store.addImage({id,uploader:vip,width:800,height:600});
    const subject=f.topic('合法会员提交对照',0,{board:'vip'});
    const path=action==='topics'?'topics':`topics/${subject.id}/${action}`;
    const body=action==='topics'?{board:'vip',title:'慢速正文会员帖子',body:`有效正文\n![封面](/api/community/images/${id}.webp)`,images:[id]}
      :action==='replies'?{body:'有效会员回复正文'}:{on:true};
    const before=f.store.ledger.balance(vip);
    const response=await delayedBody(f,path,body,expire);
    const expected=expire?(action==='topics'?403:404):(action==='topics'||action==='replies'?201:200);
    assert.equal(response.status,expected,response.text);
    if(expire) {
      assert.equal(f.store.ledger.balance(vip),before);
      assert.equal(f.store.postedToday(vip).topics,0);
      assert.equal(f.store.postedToday(vip).replies,0);
      assert.equal(f.store.liked({kind:'topic',id:subject.id},vip),false);
      assert.equal(f.store.bookmarked(subject.id,vip),false);
    }
  });
}

for(const action of ['topics','replies']) for(const expire of [true,false]) {
  test(`${action} checks ${expire?'expired':'valid'} membership after mention resolution before its transaction`,async t=>{
    const f=await setup(t),vip=reader('vip'),id=randomUUID(),subject=f.topic('会员提及等待',0,{board:'vip'});
    f.store.addImage({id,uploader:vip,width:800,height:600});
    let namesChecked=false;
    f.onNames(()=>{namesChecked=true;if(expire)f.accounts.get('vip').vip=false;});
    const body=action==='topics'?{board:'vip',title:'提及等待后的会员帖子',body:`有效正文 @帖子作者\n![封面](/api/community/images/${id}.webp)`,images:[id]}:{body:'有效会员回复 @帖子作者'};
    const before=f.store.ledger.balance(vip);
    const response=await post(f,action==='topics'?'topics':`topics/${subject.id}/replies`,body);
    assert.equal(namesChecked,true);
    assert.equal(response.status,expire?action==='topics'?403:404:201,await response.clone().text());
    if(expire) {
      assert.equal(f.store.ledger.balance(vip),before);
      assert.equal(f.store.postedToday(vip).topics,0);
      assert.equal(f.store.postedToday(vip).replies,0);
    }
  });
}
const cases = [
  ['curated', () => 'topics?sort=curated', 1, 200],
  ['private-board', () => 'topics?sort=curated&board=vip', 1, 404],
  ['summary', () => 'summary', 1, 200],
  ['bookmarks', () => 'bookmarks', 1, 200],
  ['member-topics', () => 'members/10002?tab=topics', 1, 200],
  ['member-final-self', () => 'members/10002?tab=topics', 2, 200],
  ['member-replies', () => 'members/10002?tab=replies', 1, 200],
  ['member-bookmarks', () => 'members/10002?tab=bookmarks', 2, 200],
  ...['icons', 'frames', 'badges'].map(tab => [`member-${tab}`, () => `members/10002?tab=${tab}`, 1, 200]),
  ['thread-first-profile', subject => `topics/${subject.id}`, 1, 404],
  ['thread-empty-mentions', subject => `topics/${subject.id}`, 3, 404],
  ['thread-final-self', subject => `topics/${subject.id}`, 4, 404],
  ['checkin', () => 'checkin', 1, 200],
  ['checkin-final-self', () => 'checkin', 2, 200],
];

for (const [label, pathFor, expireAt, expectedStatus] of cases) {
  test(`${label} uses current VIP after the awaited profile stage for content, counts and metadata`, async t => {
    const f = await setup(t), vip = reader('vip'), marker = `PRIVATE-AWAIT-${label}`;
    const subject = f.topic(marker, 0, { board: 'vip', author: vip, body: `${marker} full body` });
    f.store.setFeatured(subject.id, true);
    f.store.addReply({ topicId: subject.id, author: vip, body: `${marker} reply`, now: f.ago(0) });
    f.store.bookmark(subject.id, vip, true);
    f.store.members.setIcon(vip, 'vip:1');
    let calls = 0, changed = false;
    f.onPeople(() => { if (++calls === expireAt) { f.accounts.get('vip').vip = false; changed = true; } });
    const response = await f.get(pathFor(subject), 'vip'), text = await response.text();
    assert.equal(changed, true);
    assert.equal(response.status, expectedStatus, text);
    assert.equal(text.includes(marker), false, 'the current non-member cannot retain private titles, body, reply or latest-topic text');
    if (expectedStatus === 200) {
      const value = JSON.parse(text);
      if (value.total !== undefined) assert.equal(value.total, 0);
      if (value.counts) assert.deepEqual(value.counts, { topics: 0, replies: 0, bookmarks: 0 });
      if (value.person) { assert.equal(value.person.vip, false); assert.equal(value.person.icon, null); }
      if (label === 'summary') assert.equal(value.boards.vip, undefined);
      if (label.startsWith('checkin')) { assert.equal(value.vip, false); assert.equal(value.dailyReward, 1); }
    }
    f.onPeople(null);
    assert.equal((await f.list('me', 'vip')).vip, false);
    assert.equal(f.store.members.iconSelection(vip), 'vip:1', 'expiry hides the icon without erasing the selected icon');
  });
}

test('an expired visitor absent from topic author maps still loses private access', async t => {
  const f = await setup(t), marker = 'OTHER-AUTHOR-PRIVATE-CONTENT';
  f.topic(marker, 0, { board: 'vip', author: reader('author') });
  let changed = false;
  f.onPeople(authors => {
    if (!changed && authors.some(author => author.id === 'author')) { changed = true; f.accounts.get('vip').vip = false; }
  });
  const value = await f.list('topics?sort=curated', 'vip');
  assert.equal(changed, true);
  assert.equal(value.total, 0);
  assert.equal(JSON.stringify(value).includes(marker), false);
});

test('a renewed membership during an empty author stage is applied to final global candidates', async t => {
  const f = await setup(t), subject = f.topic('空作者批次后续期可见', 0, { board: 'vip' });
  f.accounts.get('vip').vip = false;
  let renewed = false;
  f.onPeople(authors => { if (!renewed && !authors.length) { renewed = true; f.accounts.get('vip').vip = true; } });
  const value = await f.list('topics?sort=curated', 'vip');
  assert.equal(renewed, true);
  assert.equal(value.total, 1);
  assert.deepEqual(value.items.map(topic => topic.id), [subject.id]);
  assert.equal(value.items[0].author.name, '测试站长', 'newly eligible topics still resolve their missing author');
});

test('valid membership and valid VIP-board management remain usable without changing earned data', async t => {
  const f = await setup(t), subject = f.topic('有效会员与管理共同权限', 0, { board: 'vip' });
  const mod = reader('mod');
  f.store.staff.appoint(owner, mod, { role: 'moderator', boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
  for (const actor of ['vip', 'mod']) assert.deepEqual((await f.list('topics?sort=curated&board=vip', actor)).items.map(topic => topic.id), [subject.id]);
  assert.equal(f.accounts.get('mod').vip, false);
  assert.equal(f.store.members.trustLevel(mod), 0);
});

for(const change of ['hide','delete','move']) test(`member replies do not retain a ${change} during their final profile wait`,async t=>{
  const f=await setup(t), author=reader('vip'), subject=f.topic('成员回复最终父板块',0,{author});
  const reply=f.store.addReply({topicId:subject.id,author,body:'WITHDRAWN-REPLY-CONTENT'});
  let changed=false;
  f.onPeople(()=>{
    if(changed)return;
    changed=true;
    if(change==='hide')f.store.hide({kind:'reply',id:reply.id},'fixture');
    else if(change==='delete')f.store.deleteReply(reply.id);
    else f.store.move(subject.id,'vip');
  });
  const value=await f.list('members/10002?tab=replies','author');
  assert.equal(changed,true);
  assert.equal(value.counts.replies,0);
  assert.deepEqual(value.replies,[]);
  assert.equal(JSON.stringify(value).includes('WITHDRAWN-REPLY-CONTENT'),false);
});

test('summary hot items and board counters agree after a renewal during its empty author wait',async t=>{
  const f=await setup(t), subject=f.topic('RENEWED-SUMMARY-HOT',0,{board:'vip',author:reader('vip')});
  f.accounts.get('vip').vip=false;
  f.onPeople(()=>{f.accounts.get('vip').vip=true;});
  const value=await f.list('summary','vip');
  assert.equal(value.total,1);
  assert.deepEqual(value.hot.map(topic=>topic.id),[subject.id]);
});

for(const role of ['self','moderator','ordinary']) test(`member bookmarks retain the original ${role} visibility when a public candidate becomes hidden during its wait`,async t=>{
  const f=await setup(t), actor=reader(role==='moderator'?'mod':'vip'), author=role==='self'?actor:reader('author');
  if(role==='moderator')f.store.staff.appoint(owner,actor,{role:'moderator',boards:['qa'],permissions:['content.inspect'],delegable:[]});
  const subject=f.topic('原有书签可见性契约',0,{author});
  f.store.bookmark(subject.id,actor,true);
  let changed=false;
  f.onPeople(authors=>{if(!changed&&authors.some(member=>member.id===author.id)){changed=true;f.store.hide({kind:'topic',id:subject.id},'fixture');}});
  const value=await f.list(`members/${role==='moderator'?'10003':'10002'}?tab=bookmarks`,actor.id);
  assert.equal(changed,true);
  const allowed=role!=='ordinary';
  assert.equal(value.counts.bookmarks,allowed?1:0);
  assert.deepEqual(value.bookmarks.map(topic=>topic.id),allowed?[subject.id]:[]);
});

for (const conditional of [false, true]) for (const kind of ['image','thumb','variant']) {
  test(`private ${kind} rechecks VIP after file await before ${conditional ? '304' : 'bytes'}`, async t => {
    const f = await setup(t), vip = reader('vip'), id = randomUUID();
    f.store.addImage({ id, uploader: vip, width: 800, height: 600 });
    f.topic('附件资格末次校验', 0, { board: 'vip', author: vip, images: [id] });
    const filename = resolve(f.directory, 'uploads', `community-${kind==='thumb' ? 'thumb' : 'image'}-${id}.webp`);
    await fs.writeFile(filename, kind==='variant'?await sharp({create:{width:1600,height:900,channels:4,background:'#4477aacc'}}).webp().toBuffer():'private synthetic image bytes');
    const url = `images/${id}${kind==='thumb' ? '.thumb' : ''}.webp${kind==='variant'?'?w=768':''}`, baseline = await f.get(url, 'vip');
    assert.equal(baseline.status, 200);
    const etag = baseline.headers.get('etag'); await baseline.arrayBuffer();
    const original = fs.readFile; let awaited = false;
    const read = t.mock.method(fs, 'readFile', async (...args) => {
      const bytes = await original(...args);
      if (String(args[0]) === filename || kind==='variant'&&String(args[0]).startsWith(resolve(f.directory,'image-cache'))) { awaited = true; f.accounts.get('vip').vip = false; }
      return bytes;
    });
    syncBuiltinESMExports();
    try {
      const first = await fetch(`${f.origin}/api/community/${url}`, {
        headers: { Cookie: 'vip', ...(conditional ? { 'If-None-Match': etag } : {}) },
      });
      assert.equal(awaited, true);
      assert.equal(first.status, 404);
      assert.equal((await first.text()).includes('private synthetic image bytes'), false);
      if (conditional) assert.ok(etag);
    } finally { read.mock.restore(); syncBuiltinESMExports(); }
  });
}
