import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity, communitySchemaReady } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const cleanup = directory => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const buyer = { kind: 'reader', id: 'card-buyer' };
const owner = { kind: 'owner', id: 'owner' };
const now = Date.parse('2026-10-08T10:00:00+08:00');
const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base = { name: '补签卡', description: '补签最近七天内漏掉的一天，不补发每日星尘。', price: 30, stock: null, limitPer: 'month', limitN: 2, minLevel: 0, minDays: 0, delivery: '', note: '', active: true };
const card = { ...base, cat: 'card', kind: 'makeup' };
const digital = { ...base, cat: 'digital', delivery: '误分类时的旧交付链接' };
const context = { level: 0, owner: false, joinedAt: '2026-01-01T00:00:00Z', now };
const editable = (store, id) => store.economy.customItems().find(item => item.id === id).canChangeKind;
let template;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-card-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));
async function open(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-card-test-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  t.after(async () => { store.close(); await cleanup(directory); });
  return { directory, store };
}
const sql = (directory, operation) => {
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try { db.exec('PRAGMA busy_timeout=5000'); return operation(db); } finally { db.close(); }
};

test('a formal custom makeup card redeems into counted inventory, repeats within its limit, and is used by the existing calendar', async t => {
  const { store, directory } = await open(t);
  const id = store.economy.saveItem(null, { ...card, image }, now);
  const item = store.economy.item(id);
  assert.deepEqual([item.cat, item.kind, item.ref, item.image, item.active, editable(store, id)], ['card', 'card', 'makeup', image, true, true]);
  assert.equal('canChangeKind' in item, false, 'public product DTO does not leak management eligibility or trigger its lookups');
  assert.deepEqual(sql(directory, db => ({ ...db.prepare('SELECT cat,kind FROM community_shop_items WHERE id=?').get(id) })), { cat: 'card', kind: 'makeup' });
  store.ledger.credit(buyer, 100, 'test', null, new Date(now).toISOString());
  store.economy.redeem(buyer, id, context);
  assert.deepEqual([store.economy.inventory(buyer).makeup, store.ledger.balance(buyer), store.economy.owned(buyer).has(id), editable(store, id)], [1, 70, false, false]);
  const used = store.economy.makeup(buyer, '2026-10-07', { now });
  assert.deepEqual([used.cost, store.economy.inventory(buyer).makeup, store.ledger.balance(buyer)], ['card', 0, 70]);
  store.economy.redeem(buyer, id, context);
  assert.equal(store.economy.inventory(buyer).makeup, 1);
  assert.throws(() => store.economy.redeem(buyer, id, context), /次数用完/);
  assert.equal(store.economy.orders(buyer).length, 2);
});

test('an unredeemed mistaken digital product changes purpose in place without changing artwork, creation date or finances', async t => {
  const { store, directory } = await open(t);
  const id = store.economy.saveItem(null, { ...digital, image }, now - 1000);
  store.economy.saveItem(id, { ...card, delivery: 'must not remain on a card', effect: { style: 'solid', colors: ['#123456'] } }, now);
  const row = sql(directory, db => ({ ...db.prepare('SELECT id,cat,kind,image,created_at,delivery,effect FROM community_shop_items WHERE id=?').get(id) }));
  assert.deepEqual(row, { id, cat: 'card', kind: 'makeup', image, created_at: new Date(now - 1000).toISOString(), delivery: '', effect: null });
  assert.equal(store.economy.item(id).ref, 'makeup');
  assert.equal(store.ledger.balance(buyer), 0);
  assert.deepEqual(store.economy.inventory(buyer), { makeup: 0, pin: 0, highlight: 0 });
  assert.deepEqual(store.economy.orders(buyer), []);
});

for (const previous of ['digital', 'goods-pending', 'goods-shipped', 'goods-cancelled', 'card', 'owned-only']) {
  test(`a ${previous} entitlement or order blocks changing product purpose while normal text and availability remain editable`, async t => {
    const { store, directory } = await open(t);
    const input = previous.startsWith('goods') ? { ...base, cat: 'goods', stock: 2 } : previous === 'card' ? card : digital;
    const id = store.economy.saveItem(null, input, now);
    store.ledger.credit(buyer, 100, 'test', null, new Date(now).toISOString());
    if (previous === 'owned-only') sql(directory, db => db.prepare('INSERT INTO community_owned VALUES(?,?,?,?)').run(buyer.kind, buyer.id, id, new Date(now).toISOString()));
    else {
      const redeemed = store.economy.redeem(buyer, id, { ...context, shipping: { name: '测试', phone: '13800138000', address: '仅测试地址' } });
      if (previous === 'goods-shipped') store.economy.ship(redeemed.order, now);
      if (previous === 'goods-cancelled') store.economy.cancel(redeemed.order, now);
    }
    const before = sql(directory, db => ({ ...db.prepare('SELECT * FROM community_shop_items WHERE id=?').get(id) }));
    const orders = store.economy.orders(buyer), owned = [...store.economy.owned(buyer)], inventory = store.economy.inventory(buyer), balance = store.ledger.balance(buyer);
    assert.equal(editable(store, id), false);
    assert.throws(() => store.economy.saveItem(id, previous === 'card' ? digital : card, now + 1), /兑换|用途/);
    assert.deepEqual(sql(directory, db => ({ ...db.prepare('SELECT * FROM community_shop_items WHERE id=?').get(id) })), before);
    assert.deepEqual([store.economy.orders(buyer), [...store.economy.owned(buyer)], store.economy.inventory(buyer), store.ledger.balance(buyer)], [orders, owned, inventory, balance]);
    store.economy.saveItem(id, { ...input, name: '改正文案', active: false }, now + 2);
    assert.equal(store.economy.item(id).active, false);
  });
}

test('an already redeemed makeup card cannot become another card subtype', async t => {
  const { store } = await open(t);
  const id = store.economy.saveItem(null, card, now);
  store.ledger.credit(buyer, 30, 'test', null, new Date(now).toISOString());
  store.economy.redeem(buyer, id, context);
  assert.throws(() => store.economy.saveItem(id, { ...card, kind: 'pin' }), /兑换|用途/);
  assert.equal(store.economy.inventory(buyer).makeup, 1);
  assert.equal(store.economy.item(id).ref, 'makeup');
});

test('controlled availability updates change only active and updated_at and refuse missing products and non-booleans', async t => {
  const { store, directory } = await open(t);
  const id = store.economy.saveItem(null, { ...digital, image }, now);
  const before = sql(directory, db => ({ ...db.prepare('SELECT * FROM community_shop_items WHERE id=?').get(id) }));
  assert.equal(store.economy.setItemActive(id, false, now + 1), id);
  const after = sql(directory, db => ({ ...db.prepare('SELECT * FROM community_shop_items WHERE id=?').get(id) }));
  assert.deepEqual(after, { ...before, active: 0, updated_at: new Date(now + 1).toISOString() });
  assert.throws(() => store.economy.setItemActive('missing', true), /没有这个物品/);
  assert.throws(() => store.economy.setItemActive(id, 'false'), /上架状态/);
});

test('an aborted inventory write rolls back custom-card debit, stock and order atomically', async t => {
  const { store, directory } = await open(t);
  const id = store.economy.saveItem(null, { ...card, stock: 1 }, now);
  store.ledger.credit(buyer, 50, 'test', null, new Date(now).toISOString());
  sql(directory, db => db.exec("CREATE TRIGGER card_test_abort BEFORE INSERT ON community_inventory BEGIN SELECT RAISE(ABORT,'synthetic inventory failure'); END"));
  assert.throws(() => store.economy.redeem(buyer, id, context), /synthetic inventory failure/);
  assert.deepEqual([store.ledger.balance(buyer), store.economy.item(id).left, store.economy.orders(buyer).length, store.economy.inventory(buyer).makeup], [50, 1, 0, 0]);
});

test('invalid card combinations are rejected in economy and persisted schema', async t => {
  const { store, directory } = await open(t);
  for (const input of [{ ...card, kind: 'frame' }, { ...card, kind: 'unknown' }, { ...card, kind: undefined }, { ...digital, kind: 'makeup' }, { ...base, cat: 'goods', kind: 'makeup' }]) {
    assert.throws(() => store.economy.saveItem(null, input), /用途|道具|类型/);
  }
  sql(directory, db => {
    for (const [cat, kind] of [['card', null], ['card', 'frame'], ['digital', 'makeup'], ['goods', 'makeup']]) {
      assert.throws(() => db.prepare('INSERT INTO community_shop_items(id,cat,kind,name,description,price,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(`invalid-${cat}-${kind}`, cat, kind, '测试', '测试说明', 1, '2026-10-08', '2026-10-08'), /CHECK/);
    }
  });
});

async function api(t) {
  const { directory, store } = await open(t);
  acceptCommunityConvention(store, [owner, buyer]);
  let origin = '';
  const server = createServer((req, res) => service.handle(req, res));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  const service = createCommunityService({ store, directory, siteOrigin: origin, ownerId: owner.id,
    identify: async req => req.headers.cookie === 'owner=yes' ? { ...owner, name: '测试站长', vip: false } : { ...buyer, name: '测试读者', vip: false },
    people: async authors => new Map(authors.map(person => [`${person.kind}:${person.id}`, { name: '测试成员', uid: person.kind === 'owner' ? 'owner' : '10002', avatar: null, vip: false, active: true, joinedAt: '2026-01-01T00:00:00Z', bio: '' }])),
  });
  t.after(() => new Promise(done => server.close(done)));
  const post = (path, body, cookie = 'owner=yes', headers = {}) => fetch(`${origin}/api/community/${path}`, { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', cookie, ...headers }, body: JSON.stringify(body) });
  return { store, directory, post };
}

test('owner APIs create and correct true cards through existing item paths, and reject forged or cross-purpose refs', async t => {
  const { store, post } = await api(t);
  const payload = { ...base, cat: 'card', kind: 'card', ref: 'makeup' };
  const response = await post('manage/items', payload);
  assert.equal(response.status, 201, await response.clone().text());
  const { id } = await response.json();
  assert.deepEqual([store.economy.item(id).kind, store.economy.item(id).ref], ['card', 'makeup']);
  for (const altered of [{ ...payload, ref: 'unknown' }, { ...payload, ref: undefined }, { ...payload, kind: 'frame' }, { ...digital, ref: 'makeup' }]) assert.equal((await post('manage/items', altered)).status, 400);
  assert.equal((await post('manage/items', payload, 'reader=yes')).status, 403);
  const original = await (await post('manage/items', digital)).json();
  assert.equal((await post(`manage/items/${original.id}`, payload)).status, 200);
  assert.equal(store.economy.item(original.id).ref, 'makeup');
});

test('availability API accepts only exact boolean-only existing-item patches and protects owner audit transaction', async t => {
  const { store, directory, post } = await api(t);
  const id = store.economy.saveItem(null, digital, now);
  assert.equal((await post(`manage/items/${id}`, { active: false })).status, 200);
  assert.equal(store.economy.item(id).active, false);
  assert.equal((await post(`manage/items/${id}`, { active: true, unrelated: 1 })).status, 400);
  assert.equal((await post(`manage/items/${id}`, { active: 'false' })).status, 400);
  assert.equal((await post('manage/items', { active: true })).status, 400);
  assert.equal((await post('manage/items/not-found', { active: true })).status, 404);
  assert.equal((await post(`manage/items/${id}`, { active: true }, 'reader=yes')).status, 403);
  sql(directory, db => db.exec("CREATE TRIGGER card_test_audit_abort BEFORE INSERT ON community_audit_events WHEN NEW.action='community-item-update' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END"));
  assert.equal((await post(`manage/items/${id}`, { active: true })).status, 500);
  assert.equal(store.economy.item(id).active, false, 'failed audit restores availability');
});

test('replayed formal makeup-card redemption returns the same order without a second charge or card', async t => {
  const { store, post } = await api(t);
  const id = store.economy.saveItem(null, card, now);
  store.ledger.credit(buyer, 100, 'test', null, new Date(now).toISOString());
  const headers = { 'X-Idempotency-Key': 'makeup-card-test-replay-0001' };
  const first = await post('shop/redeem', { item: id }, 'reader=yes', headers);
  assert.equal(first.status, 201, await first.clone().text());
  const result = await first.json();
  assert.deepEqual(await (await post('shop/redeem', { item: id }, 'reader=yes', headers)).json(), result);
  assert.deepEqual([store.ledger.balance(buyer), store.economy.inventory(buyer).makeup, store.economy.orders(buyer).length], [70, 1, 1]);
});

const workerSource = `
  import { parentPort, workerData } from 'node:worker_threads';
  import { createCommunityStore } from ${JSON.stringify(new URL('../server/community-store.ts', import.meta.url).href)};
  const store=createCommunityStore(workerData.directory), signal=new Int32Array(workerData.signal);
  parentPort.postMessage({ready:true}); Atomics.wait(signal,0,0);
  try {
    const result=workerData.operation==='correct' ? store.economy.saveItem(workerData.id,workerData.card,workerData.now)
      : store.economy.redeem(workerData.buyer,workerData.id,workerData.context);
    parentPort.postMessage({ok:true,result});
  } catch(error) {parentPort.postMessage({ok:false,status:error.status||500,error:error.message});}
  finally {store.close();}
`;
async function race(directory, id, operations) {
  const signal = new SharedArrayBuffer(4), workers = [];
  let ready = 0;
  try {
    return await Promise.all(operations.map(operation => new Promise((resolveResult, reject) => {
      const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`), { workerData: { directory, id, signal, now, card, buyer, context, operation } });
      workers.push(worker);
      let finished = false;
      worker.on('message', message => {
        if (message.ready) { if (++ready === operations.length) { Atomics.store(new Int32Array(signal), 0, 1); Atomics.notify(new Int32Array(signal), 0); } }
        else { finished = true; resolveResult(message); }
      });
      worker.on('error', reject);
      worker.on('exit', code => { if (!finished) reject(new Error(`Card race worker exited without a result (${code})`)); });
    })));
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}

test('independent SQLite connections serialize a purpose correction racing a redemption without changing purchased rights', { timeout: 20000 }, async t => {
  const { store, directory } = await open(t);
  const id = store.economy.saveItem(null, digital, now);
  store.ledger.credit(buyer, 100, 'test', null, new Date(now).toISOString());
  const [changed, redeemed] = await race(directory, id, ['correct', 'redeem']);
  assert.equal(redeemed.ok, true, JSON.stringify(redeemed));
  if (changed.ok) {
    assert.equal(redeemed.result.item.kind, 'card');
    assert.deepEqual([store.economy.inventory(buyer).makeup, store.economy.owned(buyer).has(id)], [1, false]);
  } else {
    assert.equal(changed.status, 400, JSON.stringify(changed));
    assert.equal(redeemed.result.item.kind, 'digital');
    assert.deepEqual([store.economy.inventory(buyer).makeup, store.economy.owned(buyer).has(id)], [0, true]);
  }
  assert.deepEqual([store.ledger.balance(buyer), store.economy.orders(buyer).length, editable(store, id)], [70, 1, false]);
});

test('concurrent custom-card redemption grants the final card and debits only one buyer', { timeout: 20000 }, async t => {
  const { store, directory } = await open(t);
  const id = store.economy.saveItem(null, { ...card, stock: 1 }, now);
  store.ledger.credit(buyer, 100, 'test', null, new Date(now).toISOString());
  const results = await race(directory, id, ['redeem', 'redeem', 'redeem']);
  assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
  assert.ok(results.filter(result => !result.ok).every(result => result.status === 409));
  assert.deepEqual([store.ledger.balance(buyer), store.economy.inventory(buyer).makeup, store.economy.orders(buyer).length, store.economy.item(id).left], [70, 1, 1, 0]);
});

test('card schema upgrade preserves legacy products, owned items, cancelled orders, indexes and triggers, and runs once', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-card-migration-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  t.after(() => cleanup(directory));
  sql(directory, db => {
    const legacy = `CREATE TABLE card_legacy_shop (
      id TEXT PRIMARY KEY, cat TEXT NOT NULL CHECK(cat IN ('digital','goods')),
      name TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL,
      stock INTEGER, stock_left INTEGER, limit_per TEXT CHECK(limit_per IN ('month','year','once')), limit_n INTEGER,
      min_level INTEGER NOT NULL DEFAULT 0, min_days INTEGER NOT NULL DEFAULT 0,
      delivery TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, image TEXT,
      category TEXT REFERENCES community_shop_categories(id), kind TEXT CHECK(kind IN ('frame','color','cover')), effect TEXT,
      maintenance_provenance TEXT DEFAULT 'preserve-this-column'
    )`;
    db.exec(`PRAGMA foreign_keys=OFF; ${legacy}; DROP TABLE community_shop_items; ALTER TABLE card_legacy_shop RENAME TO community_shop_items;
      CREATE INDEX card_legacy_name_idx ON community_shop_items(name);
      CREATE TABLE card_legacy_trigger_events(item TEXT);
      CREATE TABLE card_legacy_child(item TEXT REFERENCES community_shop_items(id) ON DELETE CASCADE);
      CREATE TRIGGER card_legacy_name_trigger AFTER UPDATE OF name ON community_shop_items BEGIN INSERT INTO card_legacy_trigger_events VALUES(NEW.id); END;`);
    db.prepare('INSERT INTO community_shop_items(id,cat,kind,name,description,price,stock,stock_left,created_at,updated_at,image,delivery) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('legacy-digital', 'digital', null, '误上架补签卡', '已有说明', 30, 3, 2, '2026-10-01', '2026-10-01', image, 'old download');
    db.prepare('INSERT INTO community_owned VALUES(?,?,?,?)').run(buyer.kind, buyer.id, 'legacy-digital', '2026-10-01');
    db.prepare('INSERT INTO card_legacy_child VALUES(?)').run('legacy-digital');
    db.prepare('INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run('legacy-order', buyer.kind, buyer.id, 'legacy-digital', '旧商品', 30, 'cancelled', '2026-10-01');
    assert.equal(communitySchemaReady(db), false);
  });
  assert.throws(() => createCommunityStore(directory), /Community migration is required/);
  const beforeFiles = await readdir(directory);
  const upgraded = await migrateCommunity(directory);
  assert.equal(upgraded.changed, true);
  assert.equal((await migrateCommunity(directory)).changed, false);
  assert.deepEqual((await readdir(directory)).sort(), [...beforeFiles, 'schema-backups'].sort());
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1);
  sql(directory, db => {
    assert.equal(communitySchemaReady(db), true);
    const row = db.prepare('SELECT cat,kind,image,stock,stock_left,delivery FROM community_shop_items WHERE id=?').get('legacy-digital');
    assert.deepEqual({ ...row }, { cat: 'digital', kind: null, image, stock: 3, stock_left: 2, delivery: 'old download' });
    assert.equal(db.prepare('SELECT maintenance_provenance FROM community_shop_items').get().maintenance_provenance, 'preserve-this-column');
    assert.equal(db.prepare('SELECT item FROM community_owned').get().item, 'legacy-digital');
    assert.equal(db.prepare('SELECT status FROM community_orders').get().status, 'cancelled');
    assert.equal(db.prepare('SELECT item FROM card_legacy_child').get().item, 'legacy-digital');
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='card_legacy_name_idx'").get());
    db.prepare('UPDATE community_shop_items SET name=? WHERE id=?').run('编辑后的名称', 'legacy-digital');
    assert.equal(db.prepare('SELECT item FROM card_legacy_trigger_events').get().item, 'legacy-digital');
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
  const snapshot = new DatabaseSync(upgraded.backup, { readOnly: true });
  try {
    assert.match(String(snapshot.prepare("SELECT sql FROM sqlite_master WHERE name='community_shop_items'").get().sql), /cat IN \('digital','goods'\)/);
    assert.equal(snapshot.prepare('SELECT item FROM community_owned').get().item, 'legacy-digital');
  } finally { snapshot.close(); }
});

test('the earliest shop schema without equipment columns gains cards without altering old digital delivery', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-card-early-schema-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  t.after(() => cleanup(directory));
  sql(directory, db => {
    db.exec(`DROP TABLE community_shop_items; CREATE TABLE community_shop_items (
      id TEXT PRIMARY KEY, cat TEXT NOT NULL CHECK(cat IN ('digital','goods')),
      name TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL,
      stock INTEGER, stock_left INTEGER, limit_per TEXT CHECK(limit_per IN ('month','year','once')), limit_n INTEGER,
      min_level INTEGER NOT NULL DEFAULT 0, min_days INTEGER NOT NULL DEFAULT 0,
      delivery TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); INSERT INTO community_shop_items(id,cat,name,description,price,created_at,updated_at,delivery)
      VALUES('old-pack','digital','原数字资源','保留原说明',20,'2026-01-01','2026-01-01','keep old delivery');`);
    assert.equal(communitySchemaReady(db), false);
  });
  assert.equal((await migrateCommunity(directory)).changed, true);
  sql(directory, db => {
    assert.equal(communitySchemaReady(db), true);
    assert.deepEqual({ ...db.prepare('SELECT cat,kind,image,delivery FROM community_shop_items').get() }, { cat: 'digital', kind: null, image: null, delivery: 'keep old delivery' });
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
  assert.equal((await migrateCommunity(directory)).changed, false);
});

test('an unrecognized legacy category is preserved and blocks schema migration instead of being silently recoded', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-card-unknown-schema-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  t.after(() => cleanup(directory));
  sql(directory, db => {
    db.exec(`DROP TABLE community_shop_items; CREATE TABLE community_shop_items (
      id TEXT PRIMARY KEY, cat TEXT NOT NULL CHECK(cat IN ('digital','goods','unknown_future_kind')),
      name TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL,
      stock INTEGER, stock_left INTEGER, limit_per TEXT, limit_n INTEGER,
      min_level INTEGER NOT NULL DEFAULT 0, min_days INTEGER NOT NULL DEFAULT 0,
      delivery TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      image TEXT, category TEXT REFERENCES community_shop_categories(id), kind TEXT CHECK(kind IN ('frame','color','cover')), effect TEXT
    ); INSERT INTO community_shop_items(id,cat,name,description,price,created_at,updated_at)
      VALUES('future-product','unknown_future_kind','未知但保留的商品','未知结构不要改写',20,'2026-01-01','2026-01-01');`);
  });
  const before = sql(directory, db => String(db.prepare("SELECT sql FROM sqlite_master WHERE name='community_shop_items'").get().sql));
  await assert.rejects(migrateCommunity(directory), /Shop card schema cannot be upgraded safely/);
  sql(directory, db => {
    assert.equal(String(db.prepare("SELECT sql FROM sqlite_master WHERE name='community_shop_items'").get().sql), before);
    assert.equal(db.prepare('SELECT cat FROM community_shop_items').get().cat, 'unknown_future_kind');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='community_shop_items_cards_upgrade'").get().n, 0);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  });
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1, 'failed upgrade retains its pre-migration backup');
});
