import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateCommunity,communitySchemaReady } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import type { CommunityStaffInput } from '../server/community-staff.ts';
const owner:CommunityAuthor={kind:'owner',id:'fixed-owner'},reader=(id:string):CommunityAuthor=>({kind:'reader',id});
async function fixture(t:test.TestContext){const dir=await mkdtemp(resolve(tmpdir(),'community-staff-'));new DatabaseSync(resolve(dir,'content.db')).close();await migrateCommunity(dir);const store=createCommunityStore(dir);store.staff.bindOwner(owner.id);t.after(async()=>{try{store.close();}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ERR_INVALID_STATE'))throw error;}await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {dir,store};}
test('adjacent appointments cannot self promote, cross boards, create peers or delegate unavailable powers',async t=>{
  const {store}=await fixture(t),s=store.staff;
  const perms=['content.inspect','topic.approve','topic.reject','topic.delete','staff.appoint'] as const;
  s.appoint(owner,reader('general'),{role:'general',boards:['qa'],permissions:[...perms],delegable:[...perms]});
  assert.throws(()=>s.appoint(reader('general'),reader('skip'),{role:'assistant',boards:['qa'],permissions:[],delegable:[]}),/下一级/);
  assert.throws(()=>s.appoint(reader('general'),reader('general'),{role:'moderator',boards:['qa'],permissions:[],delegable:[]}),/自己/);
  assert.throws(()=>s.appoint(reader('general'),reader('other'),{role:'moderator',boards:['tools'],permissions:[],delegable:[]}),/板块/);
  assert.throws(()=>s.appoint(reader('general'),reader('other'),{role:'moderator',boards:['qa'],permissions:['member.mute'],delegable:[]}),/权限/);
  s.appoint(reader('general'),reader('mod'),{role:'moderator',boards:['qa'],permissions:[...perms],delegable:[...perms]});
  s.appoint(reader('mod'),reader('assistant'),{role:'assistant',boards:['qa'],permissions:['content.inspect','topic.delete'],delegable:[]});
  assert.equal(s.can(reader('assistant'),'topic.delete','qa'),true);assert.equal(s.can(reader('assistant'),'reply.delete','qa'),false);
  assert.equal(s.can(reader('assistant'),'topic.penalty','qa'),false);assert.equal(s.can(reader('assistant'),'member.mute'),false);
  assert.equal(s.can(reader('assistant'),'topic.delete','tools'),false);
  assert.throws(()=>s.appoint(reader('mod'),reader('general'),{role:'assistant',boards:['qa'],permissions:[],delegable:[]}),/上级|同级/);
  assert.equal(s.state({kind:'owner',id:'fake-owner'}),null);
});

test('the fixed owner directly appoints every reader staff role with an immediately valid nonlegacy chain',async t=>{
  const {store}=await fixture(t),s=store.staff;
  const permissions=['content.inspect','topic.approve','staff.appoint'] as const;
  for(const role of ['general','moderator','assistant'] as const){
    const target=reader('direct-'+role);
    assert.equal(s.canAppoint(owner,target),true);
    const appointed=s.appoint(owner,target,{role,boards:['qa'],permissions:[...permissions],delegable:['content.inspect']});
    assert.equal(appointed?.role,role);assert.deepEqual(appointed?.parent,owner);
    assert.deepEqual(appointed?.boards,['qa']);assert.deepEqual(appointed?.permissions,[...permissions]);
    assert.deepEqual(appointed?.delegable,['content.inspect']);assert.deepEqual(s.ancestors(target),[owner]);
    assert.equal(s.stored(target)?.legacy_origin,0);assert.equal(s.can(target,'topic.approve','qa'),true);
    assert.equal(s.can(target,'topic.approve','tools'),false);
    assert.throws(()=>s.protect(target,owner),{status:403});
  }
  assert.equal(s.state(reader(owner.id)),null,'a reader sharing the fixed owner ID is still a reader');
  assert.equal(s.canAppoint({kind:'owner',id:'forged-owner'},reader('new')),false);
  assert.throws(()=>s.appoint({kind:'owner',id:'forged-owner'},reader('new'),{role:'assistant',boards:['qa'],permissions:[],delegable:[]}),{status:403});
  assert.throws(()=>s.appoint(owner,reader('new'),{role:'owner',boards:['qa'],permissions:[],delegable:[]} as unknown as CommunityStaffInput),{status:403});
  assert.equal(s.state(reader('new')),null,'a direct appointment cannot create another fixed owner');
});

test('direct owner appointments preserve adjacent delegation and never grant a parent-held but nondelegable capability',async t=>{
  const {store}=await fixture(t),s=store.staff;
  s.appoint(owner,reader('direct-general'),{role:'general',boards:['qa'],permissions:['staff.appoint','topic.delete','content.inspect'],delegable:['staff.appoint','content.inspect']});
  assert.throws(()=>s.appoint(reader('direct-general'),reader('skip'),{role:'assistant',boards:['qa'],permissions:[],delegable:[]}),{status:403});
  assert.throws(()=>s.appoint(reader('direct-general'),reader('unavailable'),{role:'moderator',boards:['qa'],permissions:['topic.delete'],delegable:[]}),{status:403});
  assert.throws(()=>s.appoint(reader('direct-general'),reader('unavailable'),{role:'moderator',boards:['qa'],permissions:['content.inspect'],delegable:['staff.appoint']}),{status:403});
  s.appoint(owner,reader('direct-moderator'),{role:'moderator',boards:['qa'],permissions:['staff.appoint','content.inspect'],delegable:['content.inspect']});
  s.appoint(reader('direct-moderator'),reader('assistant'),{role:'assistant',boards:['qa'],permissions:['content.inspect'],delegable:[]});
  assert.equal(s.state(reader('assistant'))?.role,'assistant');assert.deepEqual(s.ancestors(reader('assistant')),[reader('direct-moderator'),owner]);
  assert.throws(()=>s.appoint(reader('direct-moderator'),reader('outside'),{role:'assistant',boards:['tools'],permissions:[],delegable:[]}),{status:403});
  assert.throws(()=>s.appoint(reader('direct-moderator'),reader('peer'),{role:'moderator',boards:['qa'],permissions:[],delegable:[]}),{status:403});
  assert.throws(()=>s.appoint(reader('direct-general'),reader('assistant'),{role:'moderator',boards:['qa'],permissions:[],delegable:[]}),/其他管理者/);
  s.appoint(owner,reader('direct-assistant'),{role:'assistant',boards:['qa'],permissions:['staff.appoint','content.inspect'],delegable:['content.inspect']});
  assert.equal(s.canAppoint(reader('direct-assistant'),reader('outside')),false);
  assert.throws(()=>s.appoint(reader('direct-assistant'),reader('outside'),{role:'assistant',boards:['qa'],permissions:[],delegable:[]}),{status:403});
});

test('the owner can take over a non-direct appointment and role changes revoke the old subtree without reviving it',async t=>{
  const {store}=await fixture(t),s=store.staff,permissions=['staff.appoint','content.inspect','topic.delete'] as const;
  s.appoint(owner,reader('general'),{role:'general',boards:['qa','tools'],permissions:[...permissions],delegable:[...permissions]});
  s.appoint(reader('general'),reader('moderator'),{role:'moderator',boards:['qa','tools'],permissions:[...permissions],delegable:[...permissions]});
  s.appoint(reader('moderator'),reader('assistant'),{role:'assistant',boards:['qa'],permissions:['topic.delete'],delegable:[]});
  s.appoint(owner,reader('unrelated'),{role:'general',boards:['tools'],permissions:[...permissions],delegable:[...permissions]});
  const untouched=s.stored(reader('unrelated'));
  assert.equal(s.canAppoint(owner,reader('moderator')),true);
  s.appoint(owner,reader('moderator'),{role:'moderator',boards:['qa','tools'],permissions:[...permissions],delegable:[...permissions]});
  assert.deepEqual(s.state(reader('moderator'))?.parent,owner);
  assert.equal(s.state(reader('assistant')),null);assert.ok(s.stored(reader('assistant'))?.revoked_at);
  s.appoint(reader('moderator'),reader('assistant'),{role:'assistant',boards:['qa','tools'],permissions:['topic.delete'],delegable:[]});
  s.appoint(owner,reader('moderator'),{role:'moderator',boards:['qa'],permissions:['staff.appoint','content.inspect'],delegable:['staff.appoint','content.inspect']});
  assert.deepEqual(s.state(reader('assistant'))?.boards,['qa']);assert.equal(s.can(reader('assistant'),'topic.delete','qa'),false);
  assert.equal(s.stored(reader('assistant'))?.revoked_at,null,'same role and parent updates narrow authority without changing the appointment');
  s.appoint(owner,reader('moderator'),{role:'general',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  assert.equal(s.state(reader('moderator'))?.role,'general');assert.equal(s.state(reader('assistant')),null);
  assert.ok(s.stored(reader('assistant'))?.revoked_at,'changing a role explicitly revokes the previous subtree');
  s.appoint(owner,reader('moderator'),{role:'moderator',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  assert.equal(s.state(reader('assistant')),null,'restoring the earlier parent role never restores revoked descendants');
  assert.deepEqual(s.stored(reader('unrelated')),untouched);
});

test('direct owner chains fail closed when the fixed owner changes or a reader parent skips a role',async t=>{
  const {store,dir}=await fixture(t),s=store.staff,permissions=['staff.appoint','content.inspect'] as const;
  s.appoint(owner,reader('general'),{role:'general',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  s.appoint(owner,reader('moderator'),{role:'moderator',boards:['qa'],permissions:[...permissions],delegable:[...permissions]});
  s.appoint(reader('moderator'),reader('assistant'),{role:'assistant',boards:['qa'],permissions:['content.inspect'],delegable:[]});
  const db=new DatabaseSync(resolve(dir,'content.db'));
  try{
    db.prepare("UPDATE community_staff SET parent_kind='reader',parent_id='general' WHERE member_id='assistant'").run();
    assert.equal(s.state(reader('assistant')),null,'general to assistant remains an invalid stored chain');
    db.prepare("UPDATE community_staff SET parent_id='moderator' WHERE member_id='assistant'").run();
    assert.equal(s.state(reader('assistant'))?.role,'assistant');
  }finally{db.close();}
  s.bindOwner('different-fixed-owner');assert.equal(s.state(reader('moderator')),null);assert.equal(s.state(reader('assistant')),null);
  assert.equal(s.can(reader('assistant'),'content.inspect','qa'),false);
  s.bindOwner(owner.id);s.revoke(owner,reader('moderator'));assert.equal(s.state(reader('assistant')),null);
});
test('ancestor updates and revocation intersect descendants immediately; cycles and orphans fail closed',async t=>{
  const {store,dir}=await fixture(t),s=store.staff,p=['content.inspect','topic.delete','staff.appoint'] as const;
  s.appoint(owner,reader('g'),{role:'general',boards:['qa','tools'],permissions:[...p],delegable:[...p]});
  s.appoint(reader('g'),reader('m'),{role:'moderator',boards:['qa','tools'],permissions:[...p],delegable:[...p]});
  s.appoint(reader('m'),reader('a'),{role:'assistant',boards:['qa','tools'],permissions:['topic.delete'],delegable:[]});
  s.appoint(owner,reader('g'),{role:'general',boards:['qa'],permissions:['content.inspect','staff.appoint'],delegable:['content.inspect','staff.appoint']});
  assert.equal(s.can(reader('a'),'topic.delete','qa'),false);assert.deepEqual(s.state(reader('a'))?.boards,['qa']);
  s.revoke(owner,reader('g'));assert.equal(s.state(reader('m')),null);assert.equal(s.state(reader('a')),null);
  s.appoint(owner,reader('g'),{role:'general',boards:['qa'],permissions:[...p],delegable:[...p]});
  assert.equal(s.state(reader('m')),null);assert.equal(s.state(reader('a')),null,'reappointing an ancestor never revives revoked descendants');
  const db=new DatabaseSync(resolve(dir,'content.db'));db.prepare("UPDATE community_staff SET revoked_at=NULL,parent_kind='reader',parent_id='m' WHERE member_id='g'").run();
  assert.equal(s.state(reader('g')),null);db.prepare("UPDATE community_staff SET parent_id='missing' WHERE member_id='g'").run();assert.equal(s.state(reader('a')),null);db.close();
});
test('a malformed but unrevoked superior cannot be reassigned by a lower manager',async t=>{
  const {store,dir}=await fixture(t),s=store.staff,p=['staff.appoint'] as const;
  s.appoint(owner,reader('g'),{role:'general',boards:['qa'],permissions:[...p],delegable:[...p]});
  s.appoint(owner,reader('peer'),{role:'general',boards:['qa'],permissions:[...p],delegable:[...p]});
  const db=new DatabaseSync(resolve(dir,'content.db'));db.prepare("UPDATE community_staff SET parent_id='missing' WHERE member_id='peer'").run();db.close();
  assert.equal(s.state(reader('peer')),null);
  assert.throws(()=>s.protect(reader('g'),reader('peer')),/上级|同级/);
  assert.throws(()=>s.appoint(reader('g'),reader('peer'),{role:'moderator',boards:['qa'],permissions:[],delegable:[]}),/上级|同级/);
});
test('legacy migration preserves original rows and valid scope without granting general role; changes close old-code authority',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'community-staff-legacy-'));new DatabaseSync(resolve(dir,'content.db')).close();await migrateCommunity(dir);const db=new DatabaseSync(resolve(dir,'content.db'));
  db.prepare("INSERT INTO community_members(member_kind,member_id,steward,steward_boards,created_at)VALUES('reader','legacy',1,'[\"qa\"]','2026-01-01')").run();
  db.exec('DROP TABLE community_staff');db.close();assert.equal((await migrateCommunity(dir)).changed,true);
  const reopened=createCommunityStore(dir);reopened.staff.bindOwner(owner.id);t.after(async()=>{reopened.close();await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  assert.equal(reopened.staff.state(reader('legacy'))?.role,'moderator');assert.deepEqual(reopened.staff.state(reader('legacy'))?.boards,['qa']);
  const check=new DatabaseSync(resolve(dir,'content.db'));assert.equal(check.prepare("SELECT steward FROM community_members WHERE member_id='legacy'").get()?.steward,1);
  reopened.staff.appoint(owner,reader('legacy'),{role:'moderator',boards:['qa'],permissions:['content.inspect'],delegable:[]});
  assert.equal(check.prepare("SELECT steward FROM community_members WHERE member_id='legacy'").get()?.steward,0);
  assert.equal(reopened.staff.can(reader('legacy'),'topic.delete','qa'),false);assert.equal((await migrateCommunity(dir)).changed,false);check.close();
});
test('legacy migration leaves malformed source rows untouched and never imports their damaged authority',async t=>{
  const {dir,store}=await fixture(t);store.close();const db=new DatabaseSync(resolve(dir,'content.db'));
  db.prepare("INSERT INTO community_members(member_kind,member_id,steward,steward_boards,created_at)VALUES('reader','bad',1,'corrupt','2026-01-01')").run();
  const before=db.prepare("SELECT * FROM community_members WHERE member_id='bad'").get();db.exec('DROP TABLE community_staff');db.close();
  assert.equal((await migrateCommunity(dir)).changed,true);const after=new DatabaseSync(resolve(dir,'content.db'));
  assert.deepEqual(after.prepare("SELECT * FROM community_members WHERE member_id='bad'").get(),before);
  assert.equal(after.prepare("SELECT member_id FROM community_staff WHERE member_id='bad'").get(),undefined);assert.equal(communitySchemaReady(after),true);after.close();
});
test('background reviewer CHECK upgrade preserves every row, index and trigger and permits explicit reader decisions',async t=>{
  const {dir,store}=await fixture(t);store.close();const db=new DatabaseSync(resolve(dir,'content.db'));
  const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE name='community_profile_background_reviews'").get()?.sql).replace("CHECK(by_kind IN ('reader','owner'))","CHECK(by_kind='owner')");
  db.exec('DROP TABLE community_profile_background_reviews');db.exec(sql);
  db.prepare("INSERT INTO community_profile_background_reviews VALUES('old','reader','r','image',1,'','owner','fixed-owner','2026-01-01')").run();
  db.exec("CREATE INDEX background_review_fixture_idx ON community_profile_background_reviews(member_id); CREATE TABLE background_review_fixture_audit(id TEXT); CREATE TRIGGER background_review_fixture_trigger AFTER INSERT ON community_profile_background_reviews BEGIN INSERT INTO background_review_fixture_audit VALUES(NEW.id); END;");
  const before=db.prepare('SELECT * FROM community_profile_background_reviews').all();const objects=db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='community_profile_background_reviews' AND type IN ('index','trigger') ORDER BY name").all();
  assert.equal(communitySchemaReady(db),false);db.close();const result=await migrateCommunity(dir);assert.equal(result.changed,true);assert.ok('backup'in result);
  const after=new DatabaseSync(resolve(dir,'content.db'));assert.equal(communitySchemaReady(after),true);
  assert.deepEqual(after.prepare('SELECT * FROM community_profile_background_reviews').all(),before);
  assert.deepEqual(after.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='community_profile_background_reviews' AND type IN ('index','trigger') ORDER BY name").all(),objects);
  after.prepare("INSERT INTO community_profile_background_reviews VALUES('new','reader','r','image',0,'明确驳回理由','reader','moderator','2026-02-01')").run();
  assert.deepEqual(after.prepare('SELECT id FROM background_review_fixture_audit').all().map(row=>row.id),['new']);after.close();assert.equal((await migrateCommunity(dir)).changed,false);
});
test('reader cleanup revokes its actual subtree without rewriting unrelated legacy appointments',async t=>{
  const {dir,store}=await fixture(t),s=store.staff,p=['staff.appoint'] as const;
  s.appoint(owner,reader('g'),{role:'general',boards:['qa'],permissions:[...p],delegable:[...p]});s.appoint(reader('g'),reader('m'),{role:'moderator',boards:['qa'],permissions:[...p],delegable:[...p]});s.appoint(reader('m'),reader('a'),{role:'assistant',boards:['qa'],permissions:[],delegable:[]});
  store.members.setSteward(reader('unrelated'),true,['qa']);const db=new DatabaseSync(resolve(dir,'content.db'));db.prepare("UPDATE community_staff SET revoked_at='2026-01-01' WHERE member_id='unrelated'").run();
  const before=db.prepare("SELECT * FROM community_members WHERE member_id='unrelated'").get();store.purgeReaderData('g',()=>{});
  assert.equal(s.stored(reader('g')),undefined);assert.ok(s.stored(reader('m'))?.revoked_at);assert.ok(s.stored(reader('a'))?.revoked_at);
  assert.deepEqual(db.prepare("SELECT * FROM community_members WHERE member_id='unrelated'").get(),before);db.close();
});
