import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

const day = 86_400_000;
const now = Date.parse('2026-10-05T04:00:00.000Z');
const reader = (id) => ({ kind: 'reader', id });
const owner = { kind: 'owner', id: 'owner' };
const cleanup = (directory) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template;

test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'sansphase-sanctions-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-sanctions-history-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  t.after(async () => { db.close(); store.close(); await cleanup(directory); });
  return { store, db };
}

test('sanction history retains expired and lifted records while long active sanctions remain enforced', async (t) => {
  const { store, db } = await fixture(t);
  const active = store.members.mute(reader('active'), 30, '人身攻击', owner, now - 8 * day);
  const expired = store.members.mute(reader('expired'), 1, '垃圾广告', owner, now - 10 * day);
  const lifted = store.members.mute(reader('lifted'), 30, '违规引流', owner, now - 9 * day);
  const liftedAt = new Date(now - 8 * day).toISOString();
  store.members.lift(lifted.id, liftedAt);
  const before = db.prepare('SELECT * FROM community_sanctions ORDER BY id').all();
  const statsBefore = store.members.stats(reader('expired'), now);

  const history = store.members.sanctions(now);
  assert.deepEqual(history.map(({ id, state, active, liftedAt }) => ({ id, state, active, liftedAt })), [
    { id: active.id, state: 'active', active: true, liftedAt: null },
    { id: lifted.id, state: 'lifted', active: false, liftedAt },
    { id: expired.id, state: 'expired', active: false, liftedAt: null },
  ]);
  assert.equal(store.members.muted(reader('active'), now).id, active.id);
  assert.equal(store.members.muted(reader('expired'), now), null);
  assert.equal(store.members.muted(reader('lifted'), now), null);
  assert.deepEqual(db.prepare('SELECT * FROM community_sanctions ORDER BY id').all(), before, 'reading history must not delete or rewrite records');
  assert.deepEqual(store.members.stats(reader('expired'), now), statsBefore, 'history visibility must preserve trust-level violation statistics');
  assert.equal(statsBefore.violations30, 1);

  const later = store.members.sanctions(now + 90 * day);
  assert.equal(later.length, 3, 'records remain after a week and after sanction expiry');
  assert.equal(later.find(({ id }) => id === active.id).state, 'expired');
  assert.equal(later.find(({ id }) => id === lifted.id).state, 'lifted');
});

test('a sanction becomes historical at the exact expiry instant and a later lift remains recorded', async (t) => {
  const { store } = await fixture(t);
  const sanction = store.members.mute(reader('boundary'), 1, '违规内容', owner, now - day);
  assert.equal(store.members.sanctions(now - 1)[0].state, 'active');
  assert.equal(store.members.sanctions(now)[0].state, 'expired');
  assert.equal(store.members.muted(reader('boundary'), now), null);
  const liftedAt = new Date(now + 1).toISOString();
  assert.deepEqual(store.members.lift(sanction.id, liftedAt), reader('boundary'));
  assert.equal(store.members.lift(sanction.id, liftedAt), null);
  assert.equal(store.members.sanctions(now + 2)[0].state, 'lifted');
  assert.equal(store.members.sanctions(now + 2)[0].liftedAt, liftedAt);
});

test('management history shows at most 100 records, prioritizes active sanctions, and preserves older storage', async (t) => {
  const { store, db } = await fixture(t);
  const active = store.members.mute(reader('long-active'), 365, '违规内容', owner, now - 180 * day);
  for (let index = 0; index < 110; index++) {
    store.members.mute(reader(`expired-${index}`), 1, '垃圾广告', owner, now - (index + 2) * day);
  }
  const history = store.members.sanctions(now);
  assert.equal(history.length, 100);
  assert.equal(history[0].id, active.id, 'old active sanctions remain visible ahead of newer historical records');
  assert.equal(history[1].member.id, 'expired-0');
  assert.equal(history.at(-1).member.id, 'expired-98');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_sanctions').get().count, 111, 'a display limit is not a retention cleanup');
  assert.equal(store.members.stats(reader('expired-109'), now).violations180, 1, 'records outside the displayed page still affect trust statistics');
});
