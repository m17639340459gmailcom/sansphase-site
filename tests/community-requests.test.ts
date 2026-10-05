import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-requests-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => rm(template, { recursive: true, force: true }));
async function open(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-requests-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store };
}
const actor = { kind: 'reader' as const, id: 'reader-a' };
const owner = { kind: 'owner' as const, id: 'owner' };
const key = 'request-intent-000001';

test('completed request records survive reopening, isolate actor and path, and contain no copied request text', async t => {
  const { directory, store } = await open(t);
  const payload = { title: '私有测试正文', shipping: { name: '虚构姓名', phone: '13800138000' }, ids: ['a', 'b'] };
  const value = { id: 'first-result', balance: 12 };
  assert.deepEqual(store.requests.run(actor, 'shop/redeem', key, payload, () => value), value);
  const sql = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    const rows = sql.prepare('SELECT * FROM community_requests').all();
    assert.equal(rows.length, 1);
    assert.ok(!JSON.stringify(rows).includes(payload.title));
    assert.ok(!JSON.stringify(rows).includes(payload.shipping.phone));
    sql.exec("UPDATE community_requests SET created_at='2025-01-01T00:00:00.000Z'");
  } finally { sql.close(); }
  const reopened = createCommunityStore(directory);
  try {
    assert.deepEqual(reopened.requests.run(actor, 'shop/redeem', key, { ids: ['a', 'b'], shipping: { phone: '13800138000', name: '虚构姓名' }, title: '私有测试正文' }, () => { throw Error('must not re-execute'); }), value);
    assert.throws(() => reopened.requests.run(actor, 'shop/redeem', key, { ...payload, ids: ['b', 'a'] }, () => value), { status: 409 });
    assert.equal(reopened.requests.run({ ...actor, id: 'reader-b' }, 'shop/redeem', key, payload, () => 'other actor'), 'other actor');
    assert.equal(reopened.requests.run(actor, 'topics', key, payload, () => 'other path'), 'other path');
  } finally { reopened.close(); }
});

test('failed business mutations and request results roll back together while a validated action attempt stays counted', async t => {
  const { directory, store } = await open(t);
  store.ledger.credit(actor, 100, 'test', null, new Date().toISOString());
  const item = store.economy.saveItem(null, { cat: 'goods', name: '事务回滚测试', description: '', price: 10, stock: 3, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', note: '', active: true });
  const payload = { item }, context = { level: 1, owner: false, joinedAt: '2025-01-01T00:00:00Z', shipping: { name: '虚构', phone: '13800138000', address: '本地虚构测试地址' } };
  const execute = () => {
    const result = store.economy.redeem(actor, item, context);
    store.members.notify(owner, { type: 'system', actor, text: '新订单测试' });
    return result;
  };
  assert.throws(() => store.requests.run(actor, 'shop/redeem', key, payload, () => { execute(); throw Error('injected failure after debit and notice'); }, () => store.rateLimits.consume(actor, 'action', 1)), /injected failure/);
  assert.equal(store.ledger.balance(actor), 100);
  assert.equal(store.economy.item(item)?.left, 3);
  assert.equal(store.economy.orders(actor).length, 0);
  assert.equal(store.members.inbox(owner).length, 0);
  const sql = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try {
    assert.equal((sql.prepare('SELECT COUNT(*) AS count FROM community_requests').get() as { count: number }).count, 0);
    assert.equal((sql.prepare('SELECT COUNT(*) AS count FROM community_rate_events').get() as { count: number }).count, 1);
  } finally { sql.close(); }
  const result = store.requests.run(actor, 'shop/redeem', key, payload, execute, () => store.rateLimits.consume(actor, 'action', 1));
  assert.deepEqual(store.requests.run(actor, 'shop/redeem', key, payload, execute, () => { throw Error('cached retry must not consume quota'); }), result);
  assert.equal(store.ledger.balance(actor), 90);
  assert.equal(store.economy.item(item)?.left, 2);
  assert.equal(store.economy.orders(actor).length, 1);
  assert.equal(store.members.inbox(owner).length, 1);
});

test('keyless compatibility is explicit and async or unpersistable operations cannot commit keyed writes', async t => {
  const { store } = await open(t);
  let executions = 0;
  for (let i = 0; i < 2; i++) store.requests.run(actor, 'legacy-operation', undefined, {}, () => ++executions);
  assert.equal(executions, 2, 'legacy callers without a key do not get retry deduplication');
  assert.throws(() => store.requests.run(actor, 'bad-operation', key, {}, () => {
    store.ledger.credit(actor, 10, 'test', null, new Date().toISOString());
    return Promise.resolve('async');
  }), /must be synchronous/);
  assert.equal(store.ledger.balance(actor), 0);
  assert.throws(() => store.requests.run(actor, 'bad-operation', key, {}, () => {
    store.ledger.credit(actor, 10, 'test', null, new Date().toISOString());
    return undefined;
  }), /cannot be persisted/);
  assert.equal(store.ledger.balance(actor), 0);
});

test('deeply nested unknown request fields are rejected as input errors before fingerprint recursion can overflow', async t => {
  const { store } = await open(t);
  const payload = JSON.parse(`{"unexpected":${'['.repeat(6000)}0${']'.repeat(6000)}}`);
  assert.throws(() => store.requests.run(actor, 'topics', key, payload, () => { throw Error('must not execute'); }), { status: 400 });
});
