import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { createCommunityListingFixture, reader } from './fixtures/community-listing.mjs';

const setup = createCommunityListingFixture(test);
const post = (f, body, identity = 'vip') => fetch(`${f.origin}/api/community/shop/equip`, {
  method: 'POST', headers: { Cookie: identity, Origin: f.origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const inventory = f => {
  const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
  try { return Object.fromEntries(['community_owned', 'community_ledger', 'community_experience_ledger'].map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)])); }
  finally { db.close(); }
};

test('all real active VIPs see the same optional frame independently of growth and never receive permanent inventory', async t => {
  const f = await setup(t), before = inventory(f);
  const profile = await f.list('profile', 'vip');
  assert.deepEqual(profile.frames.find(item => item.ref === 'vipmoon'), { id: 'frame-vipmoon', name: 'VIP 月相头像框', ref: 'vipmoon', image: null });
  assert.equal(profile.person.frame, null, 'membership does not automatically equip');
  const response = await post(f, { kind: 'frame', ref: 'vipmoon' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).frame, 'vipmoon');
  assert.equal((await f.list('me', 'vip')).frame, 'vipmoon');
  assert.equal((await f.list('profile', 'vip')).person.frame, 'vipmoon');
  assert.deepEqual(inventory(f), before, 'choosing a membership frame is not an award, purchase or inventory grant');
});

test('expired VIP selection hides everywhere without deleting it and renewal restores the choice', async t => {
  const f = await setup(t), member = reader('vip');
  f.store.members.equip(member, 'frame', 'vipmoon');
  f.accounts.get('vip').vip = false;
  assert.equal((await f.list('profile', 'vip')).frames.some(item => item.ref === 'vipmoon'), false);
  assert.equal((await f.list('profile', 'vip')).person.frame, null);
  assert.equal((await f.list('me', 'vip')).frame, null);
  f.topic('会员月相作者帖子', 0, { author: member });
  assert.equal((await f.list('topics?sort=newest', 'reader')).items[0].author.frame, null);
  assert.equal(f.store.members.storedDecorations(member).frame, 'vipmoon');
  const denied = await post(f, { kind: 'frame', ref: 'vipmoon' });
  assert.equal(denied.status, 403);
  f.accounts.get('vip').vip = true;
  assert.equal((await f.list('me', 'vip')).frame, 'vipmoon');
  assert.equal((await f.list('profile', 'vip')).frames.some(item => item.ref === 'vipmoon'), true);
  assert.equal((await post(f, { kind: 'frame', ref: null })).status, 200);
  assert.equal((await f.list('me', 'vip')).frame, null);
});

test('VIP frame refuses ordinary accounts, forged payload fields and membership revoked during its final lookup', async t => {
  const f = await setup(t);
  assert.equal((await f.list('profile', 'reader')).frames.some(item => item.ref === 'vipmoon'), false);
  assert.equal((await post(f, { kind: 'frame', ref: 'vipmoon' }, 'reader')).status, 403);
  assert.equal((await post(f, { kind: 'frame', ref: 'vipmoon', vip: true })).status, 400);
  f.onPeople(() => { f.accounts.get('vip').vip = false; });
  assert.equal((await post(f, { kind: 'frame', ref: 'vipmoon' })).status, 403);
  assert.equal(f.store.members.storedDecorations(reader('vip')).frame, null);
});

test('an inactive other author cannot display a retained VIP frame even when its membership bit is still true', async t => {
  const f = await setup(t), member = reader('vip');
  f.store.members.equip(member, 'frame', 'vipmoon');
  f.accounts.get('vip').active = false;
  f.topic('停用账号历史帖子', 0, { author: member });
  assert.equal((await f.list('topics?sort=newest', 'reader')).items[0].author.frame, null);
});

test('another author reaching expiry during the final viewer wait cannot keep its earlier VIP frame projection', async t => {
  const f = await setup(t), member = reader('vip');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  f.accounts.get('vip').vipUntil = new Date(Date.now() + 1000).toISOString();
  f.store.members.equip(member, 'frame', 'vipmoon');
  f.topic('跨等待到期作者帖子', 0, { author: member });
  let confirms = 0;
  f.onIdentify(() => { if (++confirms === 2) t.mock.timers.tick(2000); });
  const item = (await f.list('topics?sort=newest', 'reader')).items[0];
  assert.ok(confirms >= 2, 'expiry is crossed after the author map and during a real final viewer lookup');
  assert.equal(f.accounts.get('vip').vip, true, 'the bool snapshot deliberately remains old');
  assert.equal(item.author.frame, null);
  assert.equal(item.author.vip, false);
  assert.equal('vipUntil' in item.author, false, 'an internal deadline is not a public author expiry disclosure');
});
