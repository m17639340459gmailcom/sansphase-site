import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import { communityRules } from '../src/community-rules.ts';

let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'sansphase-stardust-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
async function open(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-stardust-policy-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { store, directory };
}
const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const beforeMidnight = '2026-10-06T15:59:00.000Z';
const afterMidnight = '2026-10-06T16:00:00.000Z';
function topic(store: ReturnType<typeof createCommunityStore>, author: CommunityAuthor, now = beforeMidnight, pending: string | null = null) {
  return store.createTopic({ board: 'qa', author, title: '有效的问答主题', body: '记录具体问题、环境和已经尝试过的方法。', pending, now });
}
function answer(store: ReturnType<typeof createCommunityStore>, topicId: string, author: CommunityAuthor, now = beforeMidnight) {
  return store.addReply({ topicId, author, body: '提供具体解决步骤以及适用条件，请先按这些步骤检查。', now });
}

test('approved issuance uses six daily contribution stars and fifteen for at most two first features', () => {
  const r = communityRules;
  assert.deepEqual([r.topicReward, r.topicDaily, r.replyReward, r.replyDaily, r.acceptReward, r.acceptDaily, r.dailyCap], [2, 1, 1, 1, 3, 1, 6]);
  assert.deepEqual([r.featureReward, r.featureMonthly, r.likeReward, r.reportReward], [15, 2, 0, 0]);
});

test('daily quotas survive removal, replies on own topics and short replies do not consume them, and Beijing midnight resets them', async t => {
  const { store } = await open(t), author = reader('writer'), helper = reader('helper');
  const first = topic(store, author);
  assert.equal(first.earned, 2);
  assert.equal(topic(store, author).earned, 0);
  assert.equal(answer(store, first.id, author).earned, 0);
  assert.equal(store.addReply({ topicId: first.id, author: helper, body: '太短', now: beforeMidnight }).earned, 0);
  const reply = answer(store, first.id, helper);
  assert.equal(reply.earned, 1);
  store.deleteReply(reply.id, { now: beforeMidnight });
  assert.equal(answer(store, first.id, helper).earned, 0, 'deleting the paid reply cannot reopen the daily slot');
  store.deleteTopic(first.id, { now: beforeMidnight });
  assert.equal(topic(store, author).earned, 0, 'deleting a paid topic cannot reopen the daily slot');
  const next = topic(store, author, afterMidnight);
  assert.equal(next.earned, 2);
  assert.equal(answer(store, next.id, helper, afterMidnight).earned, 1);
});

test('review uses the approval day and accepted answers earn once per answerer per day without withholding bounties', async t => {
  const { store } = await open(t), helper = reader('helper');
  const pending = topic(store, helper, beforeMidnight, '需要审核');
  assert.equal(pending.earned, 0);
  assert.equal(store.approveTopic(pending.id, afterMidnight).earned, 2);
  assert.equal(topic(store, helper, afterMidnight).earned, 0);
  const first = topic(store, reader('asker-a'), afterMidnight);
  const second = topic(store, reader('asker-b'), afterMidnight);
  const one = answer(store, first.id, helper, afterMidnight);
  assert.equal(one.earned, 1);
  assert.equal(store.accept(one.id, afterMidnight), 3);
  assert.throws(() => store.accept(one.id, afterMidnight), /已经采纳/);
  const two = answer(store, second.id, helper, afterMidnight);
  assert.equal(two.earned, 0);
  assert.equal(store.accept(two.id, afterMidnight), 0);
  assert.equal(store.ledger.behaviourToday(helper, Date.parse(afterMidnight)), 6);
  const own = answer(store, pending.id, helper, afterMidnight);
  assert.throws(() => store.accept(own.id, afterMidnight), /自己/);
  const nextDay = '2026-10-07T16:00:00.000Z', asker = reader('bounty-asker');
  store.ledger.credit(asker, 100, 'test', null, nextDay);
  const bounty = store.createTopic({ board: 'qa', author: asker, title: '带悬赏的具体问题', body: '请提供解决步骤。', bounty: 20, now: nextDay });
  assert.equal(store.accept(answer(store, bounty.id, helper, nextDay).id, nextDay), 23);
});

test('feature quota survives cancellation; overflow marks cannot be re-featured next month to claim a delayed reward', async t => {
  const { store } = await open(t), author = reader('featured-author');
  const a = topic(store, author), b = topic(store, author), overflow = topic(store, author);
  for (const item of [a, b, overflow]) store.setFeatured(item.id, true, { actor: owner, now: beforeMidnight });
  assert.equal(store.ledger.history(author).filter(row => row.reason === 'featured').length, 2);
  assert.equal(store.ledger.balance(author), 32);
  store.setFeatured(a.id, false, { now: beforeMidnight });
  store.setFeatured(a.id, true, { now: beforeMidnight });
  assert.equal(store.ledger.balance(author), 17, 'a reversed first award is not issued again');
  const november = '2026-10-31T16:00:00.000Z';
  store.setFeatured(overflow.id, false, { now: november });
  store.setFeatured(overflow.id, true, { now: november });
  assert.equal(store.ledger.history(author).filter(row => row.reason === 'featured').length, 2);
  const fresh = topic(store, author, november);
  store.setFeatured(fresh.id, true, { now: november });
  assert.equal(store.ledger.balance(author), 34, 'a genuinely first feature in a new month may earn');
  store.deleteTopic(fresh.id, { now: november });
  assert.equal(store.ledger.balance(author), 17, 'deletion revokes both the topic and its feature award');
});

test('likes and upheld reports still function but never issue new stardust', async t => {
  const { store } = await open(t), author = reader('author'), fan = reader('fan');
  const item = topic(store, author);
  assert.deepEqual(store.like({ kind: 'topic', id: item.id }, fan, true, { rewarding: true, now: beforeMidnight }), { likes: 1, liked: true, earned: 0 });
  assert.equal(store.ledger.balance(author), 2);
  store.like({ kind: 'topic', id: item.id }, fan, false, { now: beforeMidnight });
  assert.equal(store.like({ kind: 'topic', id: item.id }, fan, true, { rewarding: true, now: afterMidnight }).earned, 0);
  const report = store.report({ target: { kind: 'topic', id: item.id }, reporter: fan, reason: '垃圾广告 / 引流', now: beforeMidnight });
  assert.deepEqual(store.resolveReport(report.id, true, beforeMidnight), { removed: true });
  assert.equal(store.ledger.balance(fan), 0);
  assert.equal(store.openReports().length, 0);
});

test('repeated reward references stay spent across days and reversals while existing balances are preserved on reopen', async t => {
  const { store, directory } = await open(t), author = reader('existing');
  store.ledger.credit(author, 800, 'historical-balance', null, beforeMidnight);
  const ref = { kind: 'topic', id: 'same-content' };
  assert.equal(store.ledger.reward(author, 2, 'topic', ref, beforeMidnight, 1), 2);
  store.ledger.revert(ref, beforeMidnight);
  assert.equal(store.ledger.reward(author, 2, 'topic', ref, afterMidnight, 1), 0);
  const second = createCommunityStore(directory);
  try { assert.equal(second.ledger.balance(author), 800); } finally { second.close(); }
});

test('complete calendar-month issuance adds one VIP star per actual sign-in and preserves contribution caps and transfers', async t => {
  const { store } = await open(t);
  assert.equal(communityRules.checkinVipBonus, 1);
  for (const [month, days, expected] of [['2027-02', 28, 231], ['2028-02', 29, 238], ['2026-04', 30, 245], ['2026-10', 31, 252]] as const) {
    for (const vip of [false, true]) {
      const member = reader(`${month}-${vip ? 'vip' : 'ordinary'}`);
      for (let d = 1; d <= days; d++) {
        const now = `${month}-${String(d).padStart(2, '0')}T02:00:00.000Z`;
        store.economy.checkin(member, { now: Date.parse(now), vip });
        const own = topic(store, member, now);
        const question = topic(store, reader(`${month}-${vip}-asker-${d}`), now);
        const reply = answer(store, question.id, member, now);
        assert.equal(own.earned, 2);
        assert.equal(reply.earned, 1);
        assert.equal(store.accept(reply.id, now), 3);
        assert.equal(store.ledger.behaviourToday(member, Date.parse(now)), 6);
        store.setFeatured(own.id, true, { actor: owner, now });
      }
      const issuance = expected + (vip ? days : 0);
      assert.equal(store.ledger.balance(member), issuance, `${month} ${vip ? 'VIP' : 'ordinary'}`);
      store.ledger.credit(member, 8, 'thank-in', null, `${month}-28T02:00:00.000Z`, 'in');
      assert.equal(store.ledger.balance(member), issuance + 8, 'legitimate transfers are not new system issuance');
    }
  }
});
