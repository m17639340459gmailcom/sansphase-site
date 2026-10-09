import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import { beijingDay } from '../src/community-rules.mjs';

const now = Date.parse('2026-10-10T02:00:00.000Z'), day = 86400000;
const reader = { kind: 'reader', id: 'cost-reader' }, owner = { kind: 'owner', id: 'owner' };
const joinedAt = '2026-01-01T00:00:00.000Z';
const context = { level: 1, owner: false, joinedAt, now };
const input = { cat: 'digital', name: '本地合成兑换资源', description: '查询预算与资格回归', price: 5, stock: null,
  limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '兑换后才能读取的私有交付内容', note: '', active: true };
let template;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-economy-cost-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

async function setup(t) {
  t.mock.method(Date, 'now', () => now);
  const directory = await mkdtemp(resolve(tmpdir(), 'community-economy-cost-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory), db = new DatabaseSync(resolve(directory, 'content.db'));
  store.members.visit(reader);
  acceptCommunityConvention(store, [reader, owner]);
  db.prepare('UPDATE community_members SET level=1,level_day=?,created_at=? WHERE member_kind=? AND member_id=?')
    .run(beijingDay(now), joinedAt, reader.kind, reader.id);
  let beforePeople;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const service = createCommunityService({ store, directory, siteOrigin: origin, ownerId: owner.id,
    identify: async req => ({ ...(req.headers.cookie === 'owner' ? owner : reader), name: '合成测试成员', vip: false }),
    people: async authors => {
      await beforePeople?.(authors);
      return new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.kind === 'owner' ? 'owner' : '10001',
        avatar: null, bio: '', vip: false, active: true, joinedAt }]));
    },
  });
  t.after(async () => {
    await new Promise(done => server.close(done)); db.close(); store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const get = (path, identity = 'reader') => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: identity } });
  const shop = async identity => { const response = await get('shop', identity); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const redeem = id => fetch(`${origin}/api/community/shop/redeem`, { method: 'POST', headers: {
    Cookie: 'reader', Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json',
  }, body: JSON.stringify({ item: id, requestKey: randomUUID() }) });
  const item = (overrides = {}) => store.economy.saveItem(null, { ...input, ...overrides }, now);
  return { store, db, get, shop, redeem, item, onPeople: hook => { beforePeople = hook; } };
}

function captureSQL(t) {
  let recording = false, queries = [];
  for (const method of ['all', 'get', 'run']) {
    const original = StatementSync.prototype[method];
    t.mock.method(StatementSync.prototype, method, function (...args) {
      const value = Reflect.apply(original, this, args);
      if (recording) queries.push({ method, sql: this.sourceSQL.replace(/\s+/g, ' ').trim(), args,
        rows: Array.isArray(value) ? value.length : method === 'get' && value ? 1 : 0 });
      return value;
    });
  }
  return async run => { queries = []; recording = true; try { return { value: await run(), queries }; } finally { recording = false; } };
}
const ownedReads = queries => queries.filter(query => query.sql.startsWith('SELECT item FROM community_owned WHERE'));
const balanceReads = queries => queries.filter(query => query.sql.startsWith('SELECT COALESCE(SUM(amount), 0) AS total FROM community_ledger WHERE') && !query.sql.includes(' AND day'));
const dateReads = queries => queries.filter(query => /(?:FROM|JOIN) community_checkins/.test(query.sql) && !query.sql.includes('community_badge_events'));

for (const count of [40, 100]) {
  test(`real shop GET with ${count} products retains complete public DTOs with one ownership and balance read`, async t => {
    const f = await setup(t);
    const ids = Array.from({ length: count }, (_, index) => f.item({ name: `实际接口合成资源 ${index}`, price: index + 5,
      minLevel: index % 7 === 0 ? 2 : 0, minDays: index % 11 === 0 ? 400 : 0, stock: index % 13 === 0 ? 0 : null,
      limitPer: index % 17 === 0 ? 'month' : null, limitN: index % 17 === 0 ? 1 : null }));
    f.store.ledger.credit(reader, 70, 'fixture', null, new Date(now).toISOString());
    f.db.prepare('INSERT INTO community_owned(member_kind,member_id,item,created_at) VALUES(?,?,?,?)').run(reader.kind, reader.id, ids[1], joinedAt);
    const expected = f.store.economy.items().filter(item => item.active).map(item => ({ ...item, delivery: undefined,
      state: f.store.economy.redeemState(reader, item, context) }));
    const capture = captureSQL(t), { value, queries } = await capture(() => f.shop());
    assert.deepEqual(value.items, JSON.parse(JSON.stringify(expected)), 'every original product and failure reason is retained');
    assert.equal(value.balance, 70); assert.equal(value.level, 1); assert.equal(value.owner, false);
    assert.deepEqual(value.inventory, { makeup: 0, pin: 0, highlight: 0 });
    assert.ok(Array.isArray(value.cats)); assert.ok(Array.isArray(value.categories));
    assert.equal(JSON.stringify(value).includes(input.delivery), false);
    t.diagnostic(JSON.stringify({ products: count, sql: queries.length, owned: ownedReads(queries).length, balance: balanceReads(queries).length }));
    assert.equal(ownedReads(queries).length, 1, 'the catalogue reads the owned set once for the final synchronous GET phase');
    assert.equal(balanceReads(queries).length, 1, 'one ledger sum serves all states and the response balance');
  });
}

test('shop qualification and funds changed while profiles await are used together, and every subsequent GET is fresh', async t => {
  const f = await setup(t), gated = f.item({ minLevel: 3, minDays: 200, price: 20 });
  const first = await f.shop();
  assert.equal(first.items.find(item => item.id === gated).state.code, 'level');
  let changed = false;
  f.onPeople(() => {
    if (changed) return; changed = true;
    f.db.prepare('UPDATE community_members SET level=3,level_day=? WHERE member_kind=? AND member_id=?').run(beijingDay(now), reader.kind, reader.id);
    f.store.ledger.credit(reader, 25, 'after-profile', null, new Date(now).toISOString());
  });
  const second = await f.shop();
  assert.equal(second.level, 3); assert.equal(second.balance, 25);
  assert.equal(second.items.find(item => item.id === gated).state.code, 'ok');
  f.db.prepare('INSERT INTO community_owned(member_kind,member_id,item,created_at) VALUES(?,?,?,?)').run(reader.kind, reader.id, gated, joinedAt);
  f.store.ledger.debit(reader, 25, 'fixture', null, new Date(now).toISOString());
  const third = await f.shop();
  assert.equal(third.balance, 0); assert.equal(third.items.find(item => item.id === gated).state.code, 'owned');
});

test('redemption priority remains closed, owned, soldout, level, days, limit and short, including owner restrictions', async t => {
  const f = await setup(t), id = f.item({ stock: 1, minLevel: 3, minDays: 400, limitPer: 'once', limitN: 1, price: 8 });
  let item = f.store.economy.item(id);
  const judge = overrides => f.store.economy.redeemState(reader, { ...item, ...overrides }, context);
  assert.equal(judge({ active: false, left: 0 }).code, 'closed');
  f.db.prepare('INSERT INTO community_owned(member_kind,member_id,item,created_at) VALUES(?,?,?,?)').run(reader.kind, reader.id, id, joinedAt);
  assert.equal(judge({ left: 0 }).code, 'owned');
  f.db.prepare('DELETE FROM community_owned WHERE item=?').run(id);
  assert.equal(judge({ left: 0 }).code, 'soldout');
  assert.equal(judge({}).code, 'level');
  assert.equal(judge({ minLevel: 0 }).code, 'days');
  assert.equal(judge({ minLevel: 0, minDays: 0 }).code, 'short');
  f.db.prepare(`INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), reader.kind, reader.id, id, item.name, 8, 'done', joinedAt);
  assert.equal(judge({ minLevel: 0, minDays: 0 }).code, 'limit');
  f.store.ledger.credit(owner, 100, 'fixture', null, joinedAt);
  assert.equal(f.store.economy.redeemState(owner, item, { ...context, owner: true, joinedAt: null, level: 0 }).code, 'ok');
  assert.equal(f.store.economy.redeemState(owner, { ...item, left: 0 }, { ...context, owner: true }).code, 'soldout');
  f.db.prepare('INSERT INTO community_owned(member_kind,member_id,item,created_at) VALUES(?,?,?,?)').run(owner.kind, owner.id, id, joinedAt);
  assert.equal(f.store.economy.redeemState(owner, item, { ...context, owner: true }).code, 'owned');
  f.db.prepare('DELETE FROM community_owned WHERE member_kind=? AND member_id=? AND item=?').run(owner.kind, owner.id, id);
  const ownerOrder = randomUUID();
  f.db.prepare(`INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(ownerOrder, owner.kind, owner.id, id, item.name, 8, 'done', joinedAt);
  assert.equal(f.store.economy.redeemState(owner, item, { ...context, owner: true }).code, 'limit');
  f.db.prepare('DELETE FROM community_orders WHERE id=?').run(ownerOrder);
  f.store.ledger.debit(owner, 100, 'fixture', null, joinedAt);
  assert.equal(f.store.economy.redeemState(owner, item, { ...context, owner: true }).code, 'short');
  item = { ...item, active: false };
  assert.equal(f.store.economy.redeemState(owner, item, { ...context, owner: true }).code, 'closed');
});

test('the actual owner catalogue and fresh checks both retain owned and once-limit restrictions', async t => {
  const f = await setup(t), digital = f.item({ name: '作者已经拥有的资源', minLevel: 3, minDays: 1000 });
  const goods = f.item({ cat: 'goods', name: '作者限购一次的实物', limitPer: 'once', limitN: 1, minLevel: 3, minDays: 1000 });
  f.store.ledger.credit(owner, 100, 'fixture', null, joinedAt);
  f.db.prepare('INSERT INTO community_owned(member_kind,member_id,item,created_at) VALUES(?,?,?,?)').run(owner.kind, owner.id, digital, joinedAt);
  f.db.prepare(`INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), owner.kind, owner.id, goods, '作者限购一次的实物', 5, 'done', joinedAt);
  const catalogue = await f.shop('owner');
  assert.equal(catalogue.owner, true); assert.equal(catalogue.level, 4); assert.equal(catalogue.balance, 100);
  for (const [id, code] of [[digital, 'owned'], [goods, 'limit']]) {
    const fresh = f.store.economy.redeemState(owner, f.store.economy.item(id), { level: 4, owner: true, joinedAt: null, now });
    assert.equal(fresh.code, code);
    assert.deepEqual(catalogue.items.find(item => item.id === id).state, fresh);
  }
});

for (const per of ['month', 'year', 'once']) {
  test(`catalogue and fresh judgment preserve ${per} limit boundary and non-cancelled statuses`, async t => {
    const f = await setup(t), id = f.item({ cat: 'goods', limitPer: per, limitN: 1, price: 8 });
    const boundary = per === 'month' ? '2026-09-30T16:00:00.000Z' : '2025-12-31T16:00:00.000Z';
    const before = new Date(Date.parse(boundary) - 1).toISOString();
    f.store.ledger.credit(reader, 100, 'fixture', null, joinedAt);
    const insert = status => f.db.prepare(`INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), reader.kind, reader.id, id, input.name, 8, status, before);
    insert('done');
    assert.equal((await f.shop()).items.find(item => item.id === id).state.code, per === 'once' ? 'limit' : 'ok');
    f.db.prepare('DELETE FROM community_orders WHERE item=?').run(id);
    insert('cancelled');
    f.db.prepare('UPDATE community_orders SET created_at=? WHERE item=?').run(boundary, id);
    assert.equal((await f.shop()).items.find(item => item.id === id).state.code, 'ok');
    for (const status of ['pending', 'done', 'shipped']) {
      f.db.prepare('DELETE FROM community_orders WHERE item=?').run(id);
      f.db.prepare(`INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(randomUUID(), reader.kind, reader.id, id, input.name, 8, status, boundary);
      const state = f.store.economy.redeemState(reader, f.store.economy.item(id), context);
      assert.equal(state.code, 'limit');
      assert.deepEqual((await f.shop()).items.find(item => item.id === id).state, state);
    }
  });
}

for (const changed of ['stock', 'balance', 'limit']) {
  test(`a GET state never authorizes a later POST after ${changed} changes`, async t => {
    const f = await setup(t), id = f.item({ cat: 'card', kind: 'makeup', stock: 1, limitPer: 'once', limitN: 1, price: 8 });
    f.store.ledger.credit(reader, 100, 'fixture', null, joinedAt);
    assert.equal((await f.shop()).items.find(item => item.id === id).state.code, 'ok');
    if (changed === 'stock') f.db.prepare('UPDATE community_shop_items SET stock_left=0 WHERE id=?').run(id);
    if (changed === 'balance') f.store.ledger.debit(reader, 100, 'fixture', null, new Date(now).toISOString());
    if (changed === 'limit') f.db.prepare(`INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), reader.kind, reader.id, id, input.name, 8, 'done', joinedAt);
    const beforeBalance = f.store.ledger.balance(reader), beforeOrders = f.store.economy.orders(reader).length;
    const response = await f.redeem(id);
    assert.equal(response.status, changed === 'balance' ? 402 : 409);
    assert.match((await response.json()).error, changed === 'stock' ? /兑完/ : changed === 'balance' ? /星尘/ : /兑换过/);
    assert.equal(f.store.ledger.balance(reader), beforeBalance);
    assert.equal(f.store.economy.orders(reader).length, beforeOrders);
    assert.deepEqual(f.store.economy.inventory(reader), { makeup: 0, pin: 0, highlight: 0 });
  });
}

function seedDates(db, id, offsets, { kind = 'reader', reward = 2 } = {}) {
  const insert = db.prepare('INSERT INTO community_checkins(member_kind,member_id,day,streak,reward,created_at) VALUES(?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const offset of offsets) insert.run(kind, id, beijingDay(now - offset * day), 9999, reward, new Date(now - offset * day).toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function oldRanking(store, db, limit = 10) {
  return db.prepare("SELECT DISTINCT member_kind,member_id FROM community_checkins WHERE day>=? AND member_kind='reader'")
    .all(beijingDay(now - day)).map(row => { const member = { kind: row.member_kind, id: row.member_id }; return { member, streak: store.economy.currentStreak(member, now) }; })
    .filter(entry => entry.streak > 0).sort((a, b) => b.streak - a.streak).slice(0, limit);
}

test('100-reader streak ranking uses one history batch, retains original tie order and reads only candidate date rows', async t => {
  const f = await setup(t);
  for (let index = 0; index < 100; index++) seedDates(f.db, `streak-${index}`, Array.from({ length: 30 }, (_, i) => i));
  seedDates(f.db, 'stale-reader', Array.from({ length: 1000 }, (_, i) => i + 5));
  seedDates(f.db, 'excluded-owner', Array.from({ length: 30 }, (_, i) => i), { kind: 'owner' });
  const expected = oldRanking(f.store, f.db, 100), capture = captureSQL(t);
  const { value, queries } = await capture(() => f.store.economy.streakRanking(now, 100));
  assert.deepEqual(value, expected);
  t.diagnostic(JSON.stringify({ readers: 100, sql: queries.length, rows: queries.reduce((sum, query) => sum + query.rows, 0) }));
  assert.equal(queries.length, 2, 'candidate selection and one bound batch replace checked/date lookups for every reader');
  const history = dateReads(queries).filter(query => !query.sql.includes('SELECT DISTINCT'));
  assert.equal(history.length, 1); assert.equal(history[0].rows, 3000);
  assert.ok(history[0].args.includes(JSON.stringify(expected.map(entry => entry.member.id))), 'candidate IDs occupy one JSON SQL binding');
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN ${history[0].sql}`).all(...history[0].args).map(row => row.detail);
  t.diagnostic(JSON.stringify({ rankingPlan: plan }));
  assert.ok(plan.some(detail => /SEARCH c USING .*\(member_kind=\? AND member_id=\? AND day>\? AND day<\?\)/.test(detail)),
    'the batch seeks each candidate in the existing member/day primary-key index');
  assert.equal(plan.some(detail => /^SCAN c\b/.test(detail)), false, 'do not repeatedly scan the complete attendance table');
  const http = await capture(async () => { const response = await f.get('rank'); assert.equal(response.status, 200); return response.json(); });
  assert.deepEqual(http.value.streaks.map(entry => [entry.person.name, entry.streak]), expected.slice(0, 10).map(entry => [entry.member.id, entry.streak]));
  assert.equal(http.queries.filter(query => query.sql.startsWith('SELECT c.member_id, c.day')).length, 1);
  assert.equal(http.queries.filter(query => query.sql.includes('FROM community_checkins WHERE member_kind = ? AND member_id = ? AND day = ?')).length, 0,
    'the actual rank endpoint does not restore per-candidate checked-today queries');
});

test('ranking keeps today/yesterday start, gaps, future exclusion, attendance-only makeups and the original 800-day cap', async t => {
  const f = await setup(t);
  seedDates(f.db, 'today-three', [0, 1, 2, 4]);
  seedDates(f.db, 'yesterday-two', [1, 2, 4]);
  seedDates(f.db, 'makeup-three', [0, 1, 2], { reward: 0 });
  seedDates(f.db, 'future-only', [-1, -2]);
  seedDates(f.db, 'future-and-yesterday', [-1, 1, 2]);
  seedDates(f.db, 'stale-only', [2, 3]);
  seedDates(f.db, 'today-801', Array.from({ length: 801 }, (_, i) => i));
  seedDates(f.db, 'yesterday-801', Array.from({ length: 801 }, (_, i) => i + 1));
  seedDates(f.db, 'gap-after-one', [0, 2]);
  const expected = oldRanking(f.store, f.db, 100), capture = captureSQL(t);
  const { value, queries } = await capture(() => f.store.economy.streakRanking(now, 100));
  assert.deepEqual(value, expected);
  assert.equal(value.find(entry => entry.member.id === 'today-801').streak, 800);
  assert.equal(value.find(entry => entry.member.id === 'yesterday-801').streak, 800);
  assert.equal(value.find(entry => entry.member.id === 'makeup-three').streak, 3);
  assert.equal(value.some(entry => entry.member.id === 'future-only' || entry.member.id === 'stale-only'), false);
  assert.equal(value.find(entry => entry.member.id === 'gap-after-one').streak, 1);
  assert.equal(queries.length, 2);
});

test('an empty streak ranking avoids its history query and the next call immediately sees new check-in dates', async t => {
  const f = await setup(t), capture = captureSQL(t);
  const empty = await capture(() => f.store.economy.streakRanking(now));
  assert.deepEqual(empty.value, []); assert.equal(empty.queries.length, 1);
  seedDates(f.db, reader.id, [0, 1, 2]);
  assert.deepEqual(f.store.economy.streakRanking(now), [{ member: reader, streak: 3 }]);
  f.db.prepare('DELETE FROM community_checkins WHERE member_kind=? AND member_id=? AND day=?').run(reader.kind, reader.id, beijingDay(now - day));
  assert.deepEqual(f.store.economy.streakRanking(now), [{ member: reader, streak: 1 }]);
});
