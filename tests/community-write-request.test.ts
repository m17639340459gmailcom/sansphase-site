import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCommunityWriteRequest } from '../src/community-write-request.ts';

type Call = { path: string; body: string; key: string | null; headers: Headers };
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] || null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }, clear: () => values.clear() };
}
function fixture(result: (call: Call) => Promise<unknown> = async () => ({ ok: true }), storage?: () => Storage | null) {
  const calls: Call[] = [];
  let id: string | null = 'reader:10001';
  const options = { identity: () => id, storage, request: async <T>(path: string, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('X-Reader-Request'), '1');
    const call = { path, body: String(init?.body), key: headers.get('X-Idempotency-Key'), headers };
    calls.push(call); return await result(call) as T;
  } };
  return { calls, options, create: () => createCommunityWriteRequest(options), identity: (next: string | null) => { id = next; } };
}
const fail = (status = 0) => Object.assign(Error('request failed'), { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('only repeatable purchase, publishing, reply and thanks paths receive a request key', async () => {
  const f = fixture(); const writer = f.create();
  for (const path of ['shop/redeem', 'topics', 'topics/post1/replies', 'topics/post1/thank', 'replies/reply1/thank']) {
    await writer.send(path, { item: 'card1' }); assert.match(f.calls.at(-1)?.key || '', uuid);
  }
  for (const path of ['checkin', 'shop/equip', 'topics/post1', 'manage/banners', 'topics/post1/replies/extra', 'shop/redeem?item=x']) {
    await writer.send(path); assert.equal(f.calls.at(-1)?.key, null);
    assert.equal(f.calls.at(-1)?.body, '{}');
  }
});

test('a confirmed success releases the pending key for the next active purchase', async () => {
  const f = fixture(); const writer = f.create();
  assert.deepEqual(await writer.send('shop/redeem', { item: 'card1' }), { ok: true });
  await writer.send('shop/redeem', { item: 'card1' });
  assert.notEqual(f.calls[0].key, f.calls[1].key);
});

test('identity switching stays blocked while a protected request is in progress, uncertain or restored after refresh', async () => {
  const storage = memoryStorage(); let finish!: (value: unknown) => void;
  let attempt = 0;
  const f = fixture(async () => { if (!attempt++) return new Promise(resolve => { finish = resolve; }); throw fail(); }, () => storage);
  const writer = f.create();
  assert.equal(writer.hasPending(), false);
  const write = writer.send('shop/redeem', { item: 'card1' });
  assert.equal(writer.hasPending(), true, 'preparing the request key also belongs to the in-flight operation');
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.create().hasPending(), true, 'a reload keeps an unresolved key');
  finish({}); await write; assert.equal(writer.hasPending(), false);
  await assert.rejects(writer.send('topics', { body: 'draft' }));
  assert.equal(writer.hasPending(), true);
  assert.equal(f.create().hasPending(), true);
  writer.clear(); assert.equal(writer.hasPending(), false);
});

for (const status of [0, 500, 503]) test(`an uncertain ${status} result reuses the pending key on retry`, async () => {
  let attempt = 0;
  const f = fixture(async () => { if (!attempt++) throw fail(status); return { order: 'one' }; }); const writer = f.create();
  await assert.rejects(writer.send('shop/redeem', { item: 'card1' }));
  await writer.send('shop/redeem', { item: 'card1' });
  assert.equal(f.calls[0].key, f.calls[1].key);
});

test('an unclassified fetch failure also keeps its key rather than assuming no write occurred', async () => {
  let attempt = 0;
  const f = fixture(async () => { if (!attempt++) throw TypeError('Failed to fetch'); return {}; }); const writer = f.create();
  await assert.rejects(writer.send('topics', { body: '正文' })); await writer.send('topics', { body: '正文' });
  assert.equal(f.calls[0].key, f.calls[1].key);
});

for (const status of [400, 403, 409, 422]) test(`a definite ${status} rejection releases its key for a new corrected attempt`, async () => {
  let attempt = 0;
  const f = fixture(async () => { if (!attempt++) throw fail(status); return {}; }); const writer = f.create();
  await assert.rejects(writer.send('topics', { title: 'draft' })); await writer.send('topics', { title: 'draft' });
  assert.notEqual(f.calls[0].key, f.calls[1].key);
});

test('rate limiting preserves a key even when it is the first rejected attempt', async () => {
  let attempt = 0;
  const f = fixture(async () => { if (!attempt++) throw fail(429); return {}; }); const writer = f.create();
  await assert.rejects(writer.send('topics', { body: 'draft' })); await writer.send('topics', { body: 'draft' });
  assert.equal(f.calls[0].key, f.calls[1].key);
});

test('after an uncertain result, later definite failures and refresh retain the original retry identity', async () => {
  const storage = memoryStorage(); const statuses = [0, 403, 409, 429, 422];
  const f = fixture(async () => { const status = statuses.shift(); if (status !== undefined) throw fail(status); return {}; }, () => storage);
  for (let index = 0; index < 5; index++) await assert.rejects(f.create().send('shop/redeem', { item: 'card1' }));
  await f.create().send('shop/redeem', { item: 'card1' });
  assert.equal(new Set(f.calls.map(call => call.key)).size, 1); assert.equal(storage.length, 0);
});

test('persisted pending metadata restores the same key after refresh without storing private content', async () => {
  const storage = memoryStorage(); let attempt = 0;
  const f = fixture(async () => { if (!attempt++) throw fail(0); return {}; }, () => storage);
  const body = { item: 'parcel', shipping: { name: '私有收件名', phone: '13900139000', address: '私有详细地址' } };
  await assert.rejects(f.create().send('shop/redeem', body));
  assert.equal(storage.length, 1);
  const persisted = storage.getItem(storage.key(0)!)!;
  for (const value of ['私有收件名', '13900139000', '私有详细地址', 'parcel']) assert.ok(!persisted.includes(value));
  assert.ok(persisted.includes(createHash('sha256').update(JSON.stringify(body)).digest('hex')));
  await f.create().send('shop/redeem', body);
  assert.equal(f.calls[0].key, f.calls[1].key); assert.equal(storage.length, 0);
});

test('a refresh while the response is pending treats the outcome as uncertain before any failure was received', async () => {
  const storage = memoryStorage(); let finish!: (value: unknown) => void; let attempt = 0;
  const f = fixture(async () => {
    if (!attempt++) return await new Promise(resolve => { finish = resolve; });
    if (attempt === 2) throw fail(403); return {};
  }, () => storage);
  const old = f.create().send('shop/redeem', { item: 'card1' });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(f.create().send('shop/redeem', { item: 'card1' }));
  await f.create().send('shop/redeem', { item: 'card1' });
  assert.equal(new Set(f.calls.map(call => call.key)).size, 1);
  finish({}); await old;
});

test('changed content or target creates a separate pending key', async () => {
  const f = fixture(async () => { throw fail(0); }); const writer = f.create();
  for (const [path, body] of [['topics/post1/thank', { amount: 5 }], ['topics/post1/thank', { amount: 10 }], ['topics/post2/thank', { amount: 5 }]] as const)
    await assert.rejects(writer.send(path, body));
  assert.equal(new Set(f.calls.map(call => call.key)).size, 3);
});

test('unavailable session storage retains uncertain keys in memory', async () => {
  let attempt = 0;
  const f = fixture(async () => { if (!attempt++) throw fail(); return {}; }, () => { throw Error('blocked storage'); }); const writer = f.create();
  await assert.rejects(writer.send('shop/redeem', { item: 'card1' })); await writer.send('shop/redeem', { item: 'card1' });
  assert.equal(f.calls[0].key, f.calls[1].key);
});

test('simultaneous duplicate submissions share the pending request while confirmed requests remain independent', async () => {
  const finishes: Array<(value: unknown) => void> = [];
  const f = fixture(() => new Promise(resolve => finishes.push(resolve))); const writer = f.create();
  const first = writer.send('shop/redeem', { item: 'card1' }), second = writer.send('shop/redeem', { item: 'card1' });
  while (finishes.length !== 1) await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.calls.length, 1);
  finishes[0]({}); await Promise.all([first, second]);
});

test('account changes and sign-out never share pending keys', async () => {
  const storage = memoryStorage(); const f = fixture(async () => { throw fail(); }, () => storage); const writer = f.create();
  await assert.rejects(writer.send('shop/redeem', { item: 'card1' }));
  f.identity('reader:10002'); await assert.rejects(writer.send('shop/redeem', { item: 'card1' }));
  assert.notEqual(f.calls[0].key, f.calls[1].key);
  const persisted = storage.getItem(storage.key(0)!)!;
  assert.ok(!persisted.includes('reader:10001'));
  f.identity(null); await assert.rejects(writer.send('shop/redeem', { item: 'card1' })); assert.equal(f.calls.length, 2);
  f.identity('reader:10002'); await assert.rejects(writer.send('shop/redeem', { item: 'card1' }));
  assert.notEqual(f.calls[1].key, f.calls[2].key);
});

for (const nextId of ['reader:10001', 'reader:10002']) test(`clear removes only pending-write metadata, and late success cannot remove a new retry key for ${nextId}`, async () => {
  const storage = memoryStorage(); storage.setItem('unrelated-draft', 'keep');
  let finish!: (value: unknown) => void; let attempt = 0;
  const f = fixture(async () => { if (!attempt++) return await new Promise(resolve => { finish = resolve; }); throw fail(); }, () => storage);
  const writer = f.create(); const old = writer.send('topics', { body: 'same' });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
  writer.clear(); f.identity(nextId);
  await assert.rejects(writer.send('topics', { body: 'same' })); finish({}); await old;
  await assert.rejects(writer.send('topics', { body: 'same' }));
  assert.equal(f.calls[1].key, f.calls[2].key); assert.notEqual(f.calls[0].key, f.calls[1].key);
  assert.equal(storage.getItem('unrelated-draft'), 'keep');
});

test('clear during hashing cancels the old pending submission before calling the account API', async () => {
  const f = fixture(); const writer = f.create();
  const pending = writer.send('topics', { body: 'old' }); writer.clear();
  await assert.rejects(pending); assert.equal(f.calls.length, 0);
});

test('malformed or excessive stored pending records never supply trusted request keys', async () => {
  const storage = memoryStorage(); const f = fixture(async () => { throw fail(); }, () => storage);
  await assert.rejects(f.create().send('topics', { body: 'draft' }));
  const name = storage.key(0)!;
  for (const damaged of ['null', '{}', '[{}]', '{"version":999,"entries":[]}', 'x'.repeat(50000)]) {
    storage.setItem(name, damaged); const writer = f.create();
    await assert.rejects(writer.send('topics', { body: 'draft' })); assert.match(f.calls.at(-1)?.key || '', uuid);
  }
  const valid = JSON.parse(storage.getItem(name)!);
  const original = JSON.stringify(valid);
  storage.setItem(name, JSON.stringify({ version: 1, entries: Array(33).fill(valid.entries[0]) }));
  await assert.rejects(f.create().send('topics', { body: 'draft' }));
  assert.notEqual(f.calls.at(-1)?.key, valid.entries[0].key, 'over-capacity metadata is not restored');
  storage.setItem(name, original);
  valid.entries[0].key = 'not-a-uuid'; storage.setItem(name, JSON.stringify(valid));
  await assert.rejects(f.create().send('topics', { body: 'draft' })); assert.match(f.calls.at(-1)?.key || '', uuid);
});

test('bounded pending storage preserves uncertain earlier requests and refuses to evict them silently', async () => {
  const storage = memoryStorage(); const f = fixture(async () => { throw fail(); }, () => storage); const writer = f.create();
  for (let index = 0; index < 32; index++) await assert.rejects(writer.send('topics', { body: `draft-${index}` }));
  await assert.rejects(writer.send('topics', { body: 'draft-new' })); assert.equal(f.calls.length, 32);
  await assert.rejects(writer.send('topics', { body: 'draft-0' })); assert.equal(f.calls[0].key, f.calls.at(-1)?.key);
  assert.equal(JSON.parse(storage.getItem(storage.key(0)!)!).entries.length, 32);
});
