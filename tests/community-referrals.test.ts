import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import type { IdentityReferralAttribution } from '../server/community-identity-protocol.ts';

const prefix = resolve(tmpdir(), 'sansphase-referrals-');
const clean = async (directory: string) => { assert.ok(directory.startsWith(prefix)); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); };
let template: string;
test.before(async () => { template = await mkdtemp(prefix); new DatabaseSync(resolve(template, 'content.db')).close(); await migrateCommunity(template); });
test.after(() => clean(template));
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(prefix);
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  t.after(async () => { store.close(); await clean(directory); });
  return { store, directory };
}
const reader = (id: string) => ({ kind: 'reader' as const, id });
const registeredAt = '2026-10-01T00:00:00.000Z';
const at = '2026-10-11T00:00:00.000Z';
const authority = (inviter = 'inviter'): IdentityReferralAttribution => ({ inviter: reader(inviter), registeredAt });
const post = (store: ReturnType<typeof createCommunityStore>, id: string, now = at) => store.createTopic({
  author: reader(id), board: 'qa', title: '受邀成员的有效帖子', body: '这是受邀成员提交的具体问题以及已经尝试的解决方法。', referral: authority(), now,
});

test('a trusted invited registration forces even plain text into review and approval credits exactly 15 once', async t => {
  const { store } = await fixture(t);
  const created = post(store, 'new-reader');
  assert.equal(created.pending, true);
  assert.equal(created.earned, 0);
  assert.equal(store.ledger.balance(reader('inviter')), 0);
  assert.throws(() => store.approveTopic(created.id, at), /邀请|校验/);
  assert.equal(store.topic(created.id)?.pending, true);
  const approved = store.approveTopic(created.id, at, authority());
  assert.equal(approved.referralEarned, 15);
  assert.equal(store.ledger.balance(reader('inviter')), 15);
  assert.equal(store.ledger.behaviourToday(reader('inviter'), Date.parse(at)), 0, 'invitations do not consume the ordinary daily contribution quota');
  assert.throws(() => store.approveTopic(created.id, at, authority()), /待审/);
  const second = store.createTopic({ author: reader('new-reader'), board: 'qa', title: '第二篇需要审核的帖子', body: '第二篇帖子依旧可能因图片或其他规则需要审核。', pending: '图片审核', now: at });
  assert.equal(store.approveTopic(second.id, at, authority()).referralEarned, 0);
  assert.equal(store.ledger.history(reader('inviter')).filter(row => row.reason === 'referral').length, 1);
});

test('referral credit remains 15 when the inviter has already reached the normal daily cap', async t => {
  const { store } = await fixture(t);
  store.transaction(() => store.ledger.reward(reader('inviter'), 6, 'test-cap', { kind: 'test', id: 'cap' }, at, 1));
  const created = post(store, 'new-reader');
  store.approveTopic(created.id, at, authority());
  assert.equal(store.ledger.balance(reader('inviter')), 21);
});

test('the Beijing approval month caps rewards at ten and overflow never moves into a later month', async t => {
  const { store } = await fixture(t);
  const before = '2026-10-31T15:59:59.999Z', after = '2026-10-31T16:00:00.000Z';
  for (let index = 0; index < 11; index++) {
    const created = post(store, `new-${index}`);
    assert.equal(store.approveTopic(created.id, before, authority()).referralEarned, index < 10 ? 15 : 0);
  }
  assert.equal(store.ledger.balance(reader('inviter')), 150);
  const october = store.referrals.summary(reader('inviter'), Date.parse(before));
  assert.equal(october.rewardedThisMonth, 10);
  assert.equal(october.remaining, 0);
  assert.equal(october.records.find(row => row.inviteeId === 'new-10')?.status, 'limit');
  const retry = store.createTopic({ author: reader('new-10'), board: 'qa', title: '限额以后的另一篇帖子', body: '新月份再发另一篇帖子也不应该重复领取邀请奖励。', pending: '仍需审核', now: after });
  assert.equal(store.approveTopic(retry.id, after, authority()).referralEarned, 0);
  const next = post(store, 'new-11', after);
  assert.equal(store.approveTopic(next.id, after, authority()).referralEarned, 15);
  assert.equal(store.referrals.summary(reader('inviter'), Date.parse(after)).rewardedThisMonth, 1);
});

test('two database connections racing for the last monthly slot cannot both earn a reward', { timeout: 15_000 }, async t => {
  const { store, directory } = await fixture(t);
  for (let index = 0; index < 9; index++) store.approveTopic(post(store, `settled-${index}`).id, at, authority());
  const pending = [post(store, 'racing-a'), post(store, 'racing-b')];
  const workers = pending.map(topic => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createCommunityStore } = await import(workerData.module);
      const store = createCommunityStore(workerData.directory);
      parentPort.once('message', () => {
        try { parentPort.postMessage({ earned: store.approveTopic(workerData.topic, workerData.at, workerData.attribution).referralEarned }); }
        finally { store.close(); }
      });
      parentPort.postMessage({ ready: true });
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { module: new URL('../server/community-store.ts', import.meta.url).href,
    directory, topic: topic.id, at, attribution: authority() } }));
  try {
    const results = workers.map(worker => {
      let ready: () => void = () => {};
      let done: (amount: number) => void = () => {};
      let failed: (error: Error) => void = () => {};
      const prepared = new Promise<void>(resolve => { ready = resolve; });
      const earned = new Promise<number>((resolve, reject) => { done = resolve; failed = reject; });
      worker.on('error', error => { ready(); failed(error); });
      worker.on('message', (message: { ready?: boolean; earned?: number }) => {
        if (message.ready) ready();
        if (typeof message.earned === 'number') done(message.earned);
      });
      return { prepared, earned };
    });
    await Promise.all(results.map(result => result.prepared));
    workers.forEach(worker => worker.postMessage('approve'));
    assert.deepEqual((await Promise.all(results.map(result => result.earned))).sort((a, b) => a - b), [0, 15]);
    assert.equal(store.ledger.balance(reader('inviter')), 150);
    const summary = store.referrals.summary(reader('inviter'), Date.parse(at));
    assert.equal(summary.rewardedThisMonth, 10);
    assert.deepEqual(summary.records.filter(row => row.inviteeId.startsWith('racing-')).map(row => row.status).sort(), ['limit', 'rewarded']);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});

test('the first rejected attempt can be replaced, while an atomic batch failure leaves no partial reward', async t => {
  const { store } = await fixture(t);
  const rejected = post(store, 'new-reader');
  store.rejectTopic(rejected.id, '不符合版规', '', at);
  assert.equal(store.ledger.balance(reader('inviter')), 0);
  const retry = post(store, 'new-reader');
  assert.throws(() => store.transaction(() => { store.approveTopic(retry.id, at, authority()); throw new Error('batch rollback'); }), /batch rollback/);
  assert.equal(store.ledger.balance(reader('inviter')), 0);
  assert.equal(store.topic(retry.id)?.pending, true);
  assert.equal(store.referrals.summary(reader('inviter'), Date.parse(at)).records[0]?.status, 'waiting');
  assert.equal(store.approveTopic(retry.id, at, authority()).referralEarned, 15);
});

test('deleting the qualifying topic reverses available rewards without restoring quota or eligibility', async t => {
  const { store } = await fixture(t);
  const created = post(store, 'new-reader');
  store.approveTopic(created.id, at, authority());
  store.ledger.debit(reader('inviter'), 12, 'spent', null, at);
  store.deleteTopic(created.id, { moderated: true, now: at });
  assert.equal(store.ledger.balance(reader('inviter')), 0);
  const state = store.referrals.summary(reader('inviter'), Date.parse(at));
  assert.equal(state.rewardedThisMonth, 1);
  assert.equal(state.records[0]?.status, 'reverted');
  assert.equal(state.records[0]?.revertedAmount, 3);
  store.deleteTopic(created.id, { now: at });
  assert.equal(store.ledger.history(reader('inviter')).filter(row => row.kind === 'revert').length, 1);
  const retry = store.createTopic({ author: reader('new-reader'), board: 'qa', title: '删帖之后的再次审核', body: '不能删除旧帖后反复注册同一条邀请关系领取奖励。', pending: '图片审核', now: at });
  assert.equal(store.approveTopic(retry.id, at, authority()).referralEarned, 0);
});

test('an inactive authority result cannot reward or reopen a bound invitation, and immutable attribution cannot be replaced', async t => {
  const { store } = await fixture(t);
  const created = post(store, 'new-reader');
  assert.throws(() => store.approveTopic(created.id, at, authority('different-inviter')), /邀请|归属/);
  assert.equal(store.topic(created.id)?.pending, true);
  assert.equal(store.approveTopic(created.id, at, null).referralEarned, 0);
  assert.equal(store.referrals.summary(reader('inviter'), Date.parse(at)).records[0]?.status, 'ineligible');
  store.referrals.bind('new-reader', authority());
  assert.equal(store.referrals.needsReview('new-reader'), false);
  assert.throws(() => store.referrals.bind('inviter', authority()), /邀请/);
});

test('account cleanup closes waiting invitations, preserves other members settled rewards and keeps minimal deduplication evidence', async t => {
  const { store } = await fixture(t);
  const created = post(store, 'settled-reader');
  store.approveTopic(created.id, at, authority());
  post(store, 'waiting-reader');
  store.purgeReaderData('settled-reader', () => {});
  store.purgeReaderData('waiting-reader', () => {});
  assert.equal(store.ledger.balance(reader('inviter')), 15, 'retention cleanup does not claw back another member’s settled balance');
  const state = store.referrals.summary(reader('inviter'), Date.parse(at));
  assert.equal(state.rewardedThisMonth, 1);
  assert.equal(state.records.find(row => row.inviteeId === 'settled-reader')?.inviteeDeleted, true);
  assert.equal(state.records.find(row => row.inviteeId === 'waiting-reader')?.status, 'ineligible');
  store.referrals.bind('waiting-reader', authority());
  assert.equal(store.referrals.needsReview('waiting-reader'), false);
});
