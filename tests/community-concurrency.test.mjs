import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

const storeURL = new URL('../server/community-store.ts', import.meta.url).href;
const workerSource = `
  import { parentPort, workerData } from 'node:worker_threads';
  import { createCommunityStore } from ${JSON.stringify(storeURL)};
  const store = createCommunityStore(workerData.directory);
  const signal = new Int32Array(workerData.signal);
  parentPort.postMessage({ ready: true });
  Atomics.wait(signal, 0, 0);
  try {
    const member = { kind: 'reader', id: workerData.member };
    const result = workerData.operation === 'feature' ? store.setFeatured(workerData.topic, true, { actor: { kind: 'owner', id: 'owner' }, now: new Date(workerData.now).toISOString() })
      : workerData.operation === 'topic' ? store.createTopic({ board: 'qa', author: member, title: '并发发帖奖励测试', body: '记录具体环境与问题，验证并发奖励不会超过限制。', now: new Date(workerData.now).toISOString() })
      : workerData.operation === 'rate' ? store.rateLimits.consume(member, 'topic', 1, workerData.now)
      : workerData.operation === 'like' ? store.like({ kind: 'topic', id: workerData.topic }, member, true, { rewarding: true, now: new Date(workerData.now).toISOString() })
      : workerData.operation === 'request-redeem' ? store.requests.run(member, 'shop/redeem', workerData.key, { item: workerData.item }, () => store.economy.redeem(member, workerData.item, { level: 1, owner: false, joinedAt: '2025-01-01T00:00:00Z', now: workerData.now }), () => store.rateLimits.consume(member, 'action', 1, workerData.now))
      : workerData.operation === 'checkin' ? store.economy.checkin(member, { now: workerData.now })
      : store.economy.redeem(member, workerData.item, {
        level: 2, owner: false, joinedAt: '2025-01-01T00:00:00.000Z', now: workerData.now,
        shipping: { name: '并发测试', phone: '13800138000', address: '本地测试用虚构收货地址' },
      });
    parentPort.postMessage({ ok: true, result });
  } catch (error) { parentPort.postMessage({ ok: false, status: error.status || 500, error: error.message }); }
  finally { store.close(); }
`;

// Separate workers open separate SQLite connections, then start at one shared barrier.
// HTTP Promise.all alone would only exercise the single server's serial JS callbacks.
async function race(directory, operations) {
  const signal = new SharedArrayBuffer(4);
  const workers = [];
  let ready = 0;
  try {
    return await Promise.all(operations.map(operation => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`), {
        workerData: { directory, signal, now: Date.parse('2026-10-05T02:00:00.000Z'), ...operation },
      });
      workers.push(worker);
      let finished = false;
      worker.on('message', message => {
        if (message.ready) {
          if (++ready === operations.length) { Atomics.store(new Int32Array(signal), 0, 1); Atomics.notify(new Int32Array(signal), 0); }
        } else { finished = true; resolve(message); }
      });
      worker.on('error', reject);
      worker.on('exit', code => { if (!finished) reject(new Error(`Race worker exited without a result (${code})`)); });
    })));
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

async function open(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-community-race-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store };
}

test('twelve connections racing for the last item create one order and debit only its winner', { timeout: 20000 }, async t => {
  const { directory, store } = await open(t);
  const item = store.economy.saveItem(null, {
    cat: 'goods', name: '最后一件测试物品', description: '本地并发测试', price: 100,
    stock: 1, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', note: '', active: true,
  });
  const members = Array.from({ length: 12 }, (_, i) => ({ kind: 'reader', id: `racer-${i}` }));
  for (const member of members) store.ledger.credit(member, 100, 'test', null, '2026-10-05T01:00:00.000Z');
  const results = await race(directory, members.map(member => ({ member: member.id, item })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => result.status === 409), JSON.stringify(results));
  assert.equal(store.economy.item(item).left, 0);
  assert.equal(store.economy.goodsOrders().length, 1);
  const balances = members.map(member => store.ledger.balance(member));
  assert.equal(balances.filter(balance => balance === 0).length, 1);
  assert.equal(balances.filter(balance => balance === 100).length, 11);
});

test('concurrent spending cannot overdraw one account even when the item has spare stock', { timeout: 15000 }, async t => {
  const { directory, store } = await open(t);
  const member = { kind: 'reader', id: 'same-reader' };
  store.ledger.credit(member, 100, 'test', null, '2026-10-05T01:00:00.000Z');
  const item = store.economy.saveItem(null, {
    cat: 'goods', name: '多件测试物品', description: '本地并发测试', price: 100,
    stock: 10, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', note: '', active: true,
  });
  const results = await race(directory, Array.from({ length: 6 }, () => ({ member: member.id, item })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => result.status === 402), JSON.stringify(results));
  assert.equal(store.ledger.balance(member), 0);
  assert.equal(store.economy.item(item).left, 9);
  assert.equal(store.economy.goodsOrders().length, 1);
});

test('concurrent same-day check-ins grant the reward once across six connections', { timeout: 15000 }, async t => {
  const { directory, store } = await open(t);
  const member = { kind: 'reader', id: 'checker' };
  const results = await race(directory, Array.from({ length: 6 }, () => ({ member: member.id, operation: 'checkin' })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.ok(results.filter(result => !result.ok).every(result => result.status === 409), JSON.stringify(results));
  assert.equal(store.ledger.balance(member), 1);
  assert.equal(store.ledger.history(member).filter(entry => entry.reason === 'checkin').length, 1);
});

test('six connections replay one repeatable card intent without new orders, charges or rate events', { timeout: 15000 }, async t => {
  const { directory, store } = await open(t);
  const member = { kind: 'reader', id: 'replaying-reader' };
  store.ledger.credit(member, 500, 'test', null, '2026-10-05T01:00:00.000Z');
  const results = await race(directory, Array.from({ length: 6 }, () => ({ member: member.id, operation: 'request-redeem', key: 'shared-intent-000001', item: 'card-highlight' })));
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.ok(results.every(result => result.result.order === results[0].result.order));
  assert.equal(store.ledger.balance(member), 440);
  assert.equal(store.economy.inventory(member).highlight, 1);
  assert.equal(store.economy.orders(member).length, 1);
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_rate_events').get().count, 1); }
  finally { db.close(); }
});

test('six concurrent connections cannot issue currency through likes', { timeout: 15000 }, async t => {
  const { directory, store } = await open(t);
  const author = { kind: 'reader', id: 'same-author' }, fan = { kind: 'reader', id: 'same-fan' };
  const topic = () => store.createTopic({ board: 'qa', author, title: '并发点赞测试', body: '这是一条用于并发测试的主题正文', now: '2026-10-05T01:00:00.000Z' }).id;
  const first = topic();
  assert.equal(store.like({ kind: 'topic', id: first }, fan, true, { rewarding: true, now: '2026-10-05T01:00:00.000Z' }).earned, 0);
  store.like({ kind: 'topic', id: first }, fan, false, { now: '2026-10-05T01:01:00.000Z' });
  const results = await race(directory, Array.from({ length: 6 }, () => ({ member: fan.id, operation: 'like', topic: topic() })));
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(results.reduce((sum, result) => sum + result.result.earned, 0), 0);
  assert.equal(store.ledger.history(author).filter(entry => entry.reason === 'like').length, 0);
});

test('six concurrent connections share the existing three-topic short-window quota', { timeout: 15000 }, async t => {
  const { directory } = await open(t);
  const results = await race(directory, Array.from({ length: 6 }, () => ({ member: 'shared-rate-reader', operation: 'rate' })));
  assert.equal(results.filter(result => result.ok).length, 3);
  assert.ok(results.filter(result => !result.ok).every(result => result.status === 429), JSON.stringify(results));
});

test('six connections publishing as the same member share one daily topic award', { timeout: 15000 }, async t => {
  const { directory, store } = await open(t);
  const results = await race(directory, Array.from({ length: 6 }, () => ({ member: 'same-writer', operation: 'topic' })));
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.equal(results.reduce((sum, result) => sum + result.result.earned, 0), 2);
  assert.equal(store.ledger.balance({ kind: 'reader', id: 'same-writer' }), 2);
});

test('six connections featuring different topics share the author monthly award quota', { timeout: 15000 }, async t => {
  const { directory, store } = await open(t);
  const author = { kind: 'reader', id: 'same-featured-author' };
  const topics = Array.from({ length: 6 }, (_, i) => store.createTopic({ board: 'qa', author, title: `并发精华主题 ${i}`, body: '具体问题与解决经验。', now: '2026-10-05T01:00:00.000Z' }).id);
  const results = await race(directory, topics.map(topic => ({ member: author.id, operation: 'feature', topic })));
  assert.ok(results.every(result => result.ok && result.result === true), JSON.stringify(results));
  assert.equal(store.ledger.history(author).filter(entry => entry.reason === 'featured').length, 2);
  assert.equal(store.ledger.balance(author), 2 + 15 * 2);
  const repeats = await race(directory, topics.map(topic => ({ member: author.id, operation: 'feature', topic })));
  assert.ok(repeats.every(result => result.ok && result.result === false), JSON.stringify(repeats));
  assert.equal(store.ledger.balance(author), 32);
});
