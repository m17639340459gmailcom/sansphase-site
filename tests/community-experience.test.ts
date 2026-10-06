import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const reader = (id: string) => ({ kind: 'reader' as const, id });
const owner = { kind: 'owner' as const, id: 'owner' };
const at = '2026-10-06T02:00:00.000Z';
const next = '2026-10-07T02:00:00.000Z';
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-experience-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));
async function open(t: test.TestContext, realAccounts = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-experience-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.prepare('UPDATE community_experience_config SET started_at=? WHERE id=1').run('2026-10-06T00:00:00.000Z');
  if (realAccounts) {
    db.exec('CREATE TABLE readers(id TEXT PRIMARY KEY,_verified INTEGER,disabled INTEGER,vip_until TEXT)');
    const insertReader = db.prepare('INSERT INTO readers(id,_verified,disabled,vip_until) VALUES(?,1,0,?)');
    for (const id of ['a', 'b', 'c']) insertReader.run(id, '2026-10-06T03:00:00.000Z');
  }
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [owner, reader('a'), reader('b'), reader('c')]);
  t.after(async () => { store.close(); db.close(); await cleanup(directory); });
  return { store, db, directory };
}
const topic = (store: ReturnType<typeof createCommunityStore>, author = reader('a'), overrides = {}) =>
  store.createTopic({ board: 'qa', author, title: '经验结算测试', body: '有效内容测试正文，用于验证独立的经验结算。', now: at, ...overrides });

test('migration creates empty experience and VIP day ledgers without converting old stardust or visits', async t => {
  const { store, db, directory } = await open(t);
  store.ledger.credit(reader('a'), 10000, 'initial', null, at);
  store.ledger.reward(reader('a'), 2, 'topic', { kind: 'topic', id: 'old' }, at, 1);
  store.members.visit(reader('a'), Date.parse(at));
  assert.equal(store.experience.state(reader('a'))?.points, 0);
  assert.equal(store.experience.vipState(reader('a'), true)?.days, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_experience_visits').get()?.n, 0);
  assert.equal((await migrateCommunity(directory)).changed, false);
  assert.equal(store.ledger.balance(reader('a')), 10002);
});

test('a valid active visit awards once per Beijing date; VIP activation later that day cannot re-award', async t => {
  const { store } = await open(t);
  const a = reader('a');
  assert.equal(store.experience.visit(a, { vip: false, now: '2026-10-06T15:59:59.000Z' }).awarded, 10);
  assert.equal(store.experience.visit(a, { vip: true, now: '2026-10-06T15:59:59.900Z' }).awarded, 0);
  assert.equal(store.experience.vipState(a, true)?.days, 0);
  assert.equal(store.experience.visit(a, { vip: true, now: '2026-10-06T16:00:00.000Z' }).awarded, 20);
  assert.equal(store.experience.vipState(a, true)?.days, 1);
  assert.equal(store.experience.state(a)?.points, 30);
  assert.equal(store.ledger.balance(a), 0);
});

test('VIP threshold day uses the upgraded multiplier; expiry preserves days and renewal resumes them', async t => {
  const { store, db } = await open(t);
  const a = reader('a');
  const insert = db.prepare("INSERT INTO community_vip_growth_days(member_kind,member_id,day,created_at) VALUES('reader',?,?,?)");
  for (let n = 1; n <= 29; n++) insert.run('a', `2026-09-${String(n).padStart(2, '0')}`, `2026-09-${String(n).padStart(2, '0')}T02:00:00.000Z`);
  const result = store.experience.visit(a, { vip: true, now: at });
  assert.equal(result.awarded, 30);
  assert.equal(result.vipGrowth?.level, 2);
  assert.equal(result.vipGrowth?.days, 30);
  assert.equal(store.experience.visit(a, { vip: false, now: next }).awarded, 10);
  assert.equal(store.experience.vipState(a, false)?.level, null);
  assert.equal(store.experience.vipState(a, false)?.multiplier, 1);
  assert.equal(store.experience.vipState(a, false)?.days, 30);
  assert.equal(store.experience.visit(a, { vip: true, now: '2026-10-08T02:00:00.000Z' }).awarded, 30);
  assert.equal(store.experience.vipState(a, true)?.days, 31);
});

test('content experience requires that day active login, public valid content and one slot per category', async t => {
  const { store } = await open(t);
  const a = reader('a'), b = reader('b');
  topic(store, a);
  assert.equal(store.experience.state(a)?.points, 0, 'no background reward before active login');
  store.experience.visit(a, { vip: false, now: at });
  store.experience.visit(b, { vip: true, now: at });
  const first = topic(store, a);
  topic(store, a);
  store.addReply({ topicId: first.id, author: a, body: '自己的主题不发回复经验，正文达到十个字。', now: at });
  store.addReply({ topicId: first.id, author: b, body: '短回复', now: at });
  const reply = store.addReply({ topicId: first.id, author: b, body: '这是他人主题上的有效回答，足够十个字。', now: at });
  store.addReply({ topicId: first.id, author: b, body: '每天第二条有效回复也不能重复发经验。', now: at });
  store.accept(reply.id, at);
  assert.equal(store.experience.state(a)?.points, 30);
  assert.equal(store.experience.state(b)?.points, 50, 'VIP boosts login only; reply and acceptance remain 10 + 20');
  topic(store, b, { board: 'vip' });
  topic(store, b, { pending: '等待审核' });
  assert.equal(store.experience.state(b)?.points, 50, 'private and pending content earn no experience');
  topic(store, b);
  assert.equal(store.experience.state(b)?.points, 70);
  topic(store, a, { now: next });
  assert.equal(store.experience.state(a)?.points, 30, 'a later content event cannot imply a new login');
});

test('approval and acceptance while absent do not bank retroactive experience; invalid/self answers do not earn', async t => {
  const { store } = await open(t);
  const a = reader('a'), b = reader('b');
  const pending = topic(store, a, { pending: '等待审核' });
  store.approveTopic(pending.id, at);
  store.experience.visit(a, { vip: false, now: at });
  assert.equal(store.experience.state(a)?.points, 10);
  const unanswered = topic(store, a);
  const absent = store.addReply({ topicId: unanswered.id, author: b, body: '有效回复，但当日还没有主动进入社区。', now: at });
  store.accept(absent.id, at);
  store.experience.visit(b, { vip: false, now: at });
  assert.equal(store.experience.state(b)?.points, 10);
  const another = topic(store, a);
  const short = store.addReply({ topicId: another.id, author: b, body: '短回答', now: at });
  store.accept(short.id, at);
  assert.equal(store.experience.state(b)?.points, 10, 'accepted answer must itself be valid');
  const ownTopic = topic(store, b);
  const ownReply = store.addReply({ topicId: ownTopic.id, author: b, body: '自己不能采纳自己的回答，不发采纳经验。', now: at });
  assert.throws(() => store.accept(ownReply.id, at), /自己的回答/);
});

test('hidden/deleted topic reclaims all associated experience without returning daily slots or rewarding restore', async t => {
  const { store, db } = await open(t);
  const a = reader('a'), b = reader('b');
  store.experience.visit(a, { vip: false, now: at });
  store.experience.visit(b, { vip: false, now: at });
  const first = topic(store, a);
  const reply = store.addReply({ topicId: first.id, author: b, body: '公开主题里的有效回复正文超过十个字。', now: at });
  store.accept(reply.id, at);
  assert.equal(store.experience.state(b)?.points, 40);
  store.hide({ kind: 'topic', id: first.id }, '举报隐藏', at);
  assert.equal(store.experience.state(a)?.points, 10);
  assert.equal(store.experience.state(b)?.points, 10);
  store.restore({ kind: 'topic', id: first.id }, at);
  topic(store, a);
  const another = topic(store, reader('c'));
  store.addReply({ topicId: another.id, author: b, body: '回收之后今天的回复额度仍然已经用过。', now: at });
  assert.equal(store.experience.state(a)?.points, 10);
  assert.equal(store.experience.state(b)?.points, 10);
  store.deleteTopic(first.id, { now: at });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_experience_ledger WHERE kind='revert'").get()?.n, 3);
  store.experience.visit(b, { vip: false, now: next });
  store.addReply({ topicId: another.id, author: b, body: '次日登录后新内容可以重新获得当天经验。', now: next });
  assert.equal(store.experience.state(b)?.points, 30);
});

test('shortening or hiding a reply and moving a topic to VIP reclaims experience in the same transaction', async t => {
  const { store } = await open(t);
  const a = reader('a'), b = reader('b');
  store.experience.visit(a, { vip: false, now: at });
  store.experience.visit(b, { vip: false, now: at });
  const first = topic(store, a);
  const answer = store.addReply({ topicId: first.id, author: b, body: '初始有效回答足够十个字，后来改成短句。', now: at });
  store.accept(answer.id, at);
  store.editReply(answer.id, { body: '短句', editor: b, now: at });
  assert.equal(store.experience.state(b)?.points, 10);
  store.move(first.id, 'vip', at);
  assert.equal(store.experience.state(a)?.points, 10);
  store.move(first.id, 'qa', at);
  assert.equal(store.experience.state(a)?.points, 10);
});

test('experience state uses server thresholds and real points; max level is complete and owner has no state', async t => {
  const { store, db } = await open(t);
  assert.equal(store.experience.state(owner), null);
  assert.equal(store.experience.vipState(owner, true), null);
  assert.equal(store.experience.visit(owner, { vip: true, now: at }).awarded, 0);
  assert.equal(store.experience.state(reader('a'))?.remaining, 1200);
  const insert = db.prepare("INSERT INTO community_experience_ledger(id,member_kind,member_id,amount,kind,reason,day,ref_kind,ref_id,created_at) VALUES(?,'reader',?,?,'earn','login',?,'day',?,?)");
  insert.run('points', 'a', 1200, '2026-10-05', '2026-10-05', at);
  assert.deepEqual(store.experience.state(reader('a')), { level: 2, points: 1200, configured: true, startThreshold: 1200, nextLevel: 3, nextThreshold: 3600, remaining: 2400, progress: 0 });
  insert.run('max', 'b', 72000, '2026-10-05', '2026-10-05', at);
  assert.equal(store.experience.state(reader('b'))?.level, 10);
  assert.equal(store.experience.state(reader('b'))?.nextThreshold, null);
  assert.equal(store.experience.state(reader('b'))?.remaining, 0);
  assert.equal(store.experience.state(reader('b'))?.progress, 1);
});

test('consent, enable date and rollback protect login and content receipts', async t => {
  const { store, db } = await open(t);
  assert.throws(() => store.experience.visit(reader('unagreed'), { vip: true, now: at }), /公约/);
  assert.equal(store.experience.visit(reader('a'), { vip: true, now: '2026-10-05T02:00:00.000Z' }).awarded, 0);
  assert.throws(() => store.transaction(() => {
    store.experience.visit(reader('a'), { vip: true, now: at });
    topic(store);
    throw Error('rollback');
  }), /rollback/);
  assert.equal(store.experience.state(reader('a'))?.points, 0);
  assert.equal(store.experience.vipState(reader('a'), true)?.days, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_experience_visits').get()?.n, 0);
});

test('transaction rechecks current Payload account status and membership expiry instead of trusting a stale viewer', async t => {
  const { store, db } = await open(t, true);
  db.prepare('UPDATE readers SET disabled=1 WHERE id=?').run('a');
  assert.throws(() => store.experience.visit(reader('a'), { vip: true, now: at }), /有效账号/);
  db.prepare('UPDATE readers SET disabled=0,_verified=0 WHERE id=?').run('a');
  assert.throws(() => store.experience.visit(reader('a'), { vip: true, now: at }), /有效账号/);
  db.prepare('UPDATE readers SET _verified=1 WHERE id=?').run('a');
  assert.equal(store.experience.visit(reader('a'), { vip: false, now: at }).awarded, 20, 'real current membership wins over stale viewer');
  assert.equal(store.experience.visit(reader('b'), { vip: true, now: '2026-10-06T04:00:00.000Z' }).awarded, 10, 'expiry during request stops VIP multiplier');
  assert.equal(store.experience.vipState(reader('b'), false)?.days, 0);
  const parent = topic(store, reader('a'));
  store.experience.visit(reader('c'), { vip: true, now: at });
  db.prepare('UPDATE readers SET disabled=1 WHERE id=?').run('c');
  const reply = store.addReply({ topicId: parent.id, author: reader('c'), body: '今日曾登录但现在账号已被停用，不能再获经验。', now: at });
  store.accept(reply.id, at);
  assert.equal(store.experience.state(reader('c'))?.points, 20);
});

test('permanent inactive-account cleanup removes its receipts, preserves other accounts and anonymizes removed refs', async t => {
  const { store, db } = await open(t, true);
  const a = reader('a'), b = reader('b');
  store.experience.visit(a, { vip: true, now: at });
  store.experience.visit(b, { vip: true, now: at });
  const parent = topic(store, a);
  const reply = store.addReply({ topicId: parent.id, author: b, body: '其他成员在待删除账号主题里的有效回答。', now: at });
  store.accept(reply.id, at);
  assert.equal(store.experience.state(b)?.points, 50);
  db.prepare('DELETE FROM readers WHERE id=?').run('a');
  store.purgeReaderData('a', () => {});
  assert.equal(store.experience.state(a)?.points, 0);
  assert.equal(store.experience.vipState(a, false)?.days, 0);
  assert.equal(store.experience.state(b)?.points, 50, 'retention cleanup is not a content violation');
  assert.equal(store.experience.vipState(b, true)?.days, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_experience_ledger WHERE member_id='b' AND ref_kind='reply'").get()?.n, 0);
});

test('independent SQLite workers cannot award the same login or VIP day twice', { timeout: 15000 }, async t => {
  const { store, directory } = await open(t);
  const source = new URL('../server/community-store.ts', import.meta.url).href;
  const signal = new SharedArrayBuffer(4), workers: Worker[] = [];
  let ready = 0;
  const run = () => new Promise<{ awarded: number }>((done, reject) => {
    const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads'); import(workerData.source).then(({createCommunityStore}) => { const store=createCommunityStore(workerData.directory); parentPort.postMessage({ready:true}); Atomics.wait(new Int32Array(workerData.signal),0,0); try { parentPort.postMessage(store.experience.visit({kind:'reader',id:'a'},{vip:true,now:workerData.at})); } finally { store.close(); } });`, { eval: true, workerData: { source, directory, at, signal } });
    workers.push(worker);
    let finished = false;
    worker.on('message', message => {
      if (message.ready) {
        if (++ready === 2) { Atomics.store(new Int32Array(signal), 0, 1); Atomics.notify(new Int32Array(signal), 0); }
      } else { finished = true; done(message); }
    });
    worker.once('error', reject);
    worker.once('exit', code => { if (!finished) reject(Error(`Experience worker exited without a result (${code})`)); });
  });
  try {
    const results = await Promise.all([run(), run()]);
    assert.equal(results.reduce((sum, item) => sum + item.awarded, 0), 20);
    assert.equal(store.experience.state(reader('a'))?.points, 20);
    assert.equal(store.experience.vipState(reader('a'), true)?.days, 1);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});
