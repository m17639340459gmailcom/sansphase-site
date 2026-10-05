import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

type Audit = (action: string, details: Record<string, unknown>) => Promise<void>;
async function fixture(t: test.TestContext, audit: Audit) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-audit-test-'));
  new DatabaseSync(resolve(directory, 'content.db')).close(); await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [{ kind: 'owner', id: 'owner' }]);
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  service = createCommunityService({ store, directory, siteOrigin: origin, simplePosting: false,
    identify: async () => ({ kind: 'owner', id: 'owner', name: 'Synthetic', vip: true }),
    people: async () => new Map(), audit });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const post = (path: string, body: unknown) => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const read = (sql: string) => { const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } };
  const execute = (sql: string) => { const db = new DatabaseSync(resolve(directory, 'content.db')); try { db.exec(sql); } finally { db.close(); } };
  return { store, post, read, execute, directory };
}
const item = { cat: 'digital', name: '审计测试商品', description: '只使用隔离假数据', price: 5, stock: null, minLevel: 0, minDays: 0, delivery: 'https://example.invalid/test', active: true };

test('a failed private audit mirror cannot make a committed new product look like a failed save', async t => {
  const f = await fixture(t, async () => { throw Object.assign(Error('synthetic audit failure'), { code: 'EACCES' }); });
  const response = await f.post('manage/items', item);
  assert.equal(response.status, 201, 'a completed business operation must not falsely invite a repeated save');
  const result = await response.json(); assert.equal(typeof result.id, 'string');
  assert.equal(f.store.economy.items().filter(product => product.name === item.name).length, 1);
  const events = f.read('SELECT action,details,mirrored_at FROM community_audit_events');
  assert.equal(events.length, 1); assert.equal(events[0].action, 'community-item-create');
  assert.deepEqual(JSON.parse(String(events[0].details)), { item: result.id }); assert.equal(events[0].mirrored_at, null);
});

test('an audit database failure rolls back the product mutation instead of leaving an untracked success', async t => {
  const f = await fixture(t, async () => {});
  f.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON community_audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit storage failure'); END");
  const response = await f.post('manage/items', item);
  assert.equal(response.status, 500);
  assert.equal(f.store.economy.items().filter(product => product.name === item.name).length, 0);
  assert.equal(f.read('SELECT id FROM community_audit_events').length, 0);
});

test('pending audit events survive reopening and are mirrored once with their original identity and time', async t => {
  let failed = true;
  const f = await fixture(t, async () => { if (failed) throw Error('unavailable file'); });
  const response = await f.post('manage/items', item); assert.equal(response.status, 201);
  const events = f.read('SELECT id,created_at FROM community_audit_events');
  const reopened = createCommunityStore(f.directory);
  const mirrored: Array<{ id: string; actor: unknown; at: string; action: string; details: unknown }> = [];
  try {
    failed = false;
    await reopened.audit.flush(async event => { mirrored.push({ id: event.id, actor: event.actor, at: event.createdAt, action: event.action, details: event.details }); });
    await reopened.audit.flush(async event => { mirrored.push({ id: event.id, actor: event.actor, at: event.createdAt, action: event.action, details: event.details }); });
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0].id, events[0].id); assert.equal(mirrored[0].at, events[0].created_at);
    assert.deepEqual(mirrored[0].actor, { kind: 'owner', id: 'owner' }); assert.equal(mirrored[0].action, 'community-item-create');
    assert.equal(f.read('SELECT id FROM community_audit_events WHERE mirrored_at IS NULL').length, 0);
  } finally { reopened.close(); }
});

test('legacy file callbacks still receive the verified actor and durable audit event metadata', async t => {
  const mirrors: Array<{ action: string; details: Record<string, unknown> }> = [];
  const f = await fixture(t, async (action, details) => { mirrors.push({ action, details }); });
  const response = await f.post('manage/categories', { name: '测试分类' }); assert.equal(response.status, 201);
  assert.equal(mirrors.length, 1); assert.equal(mirrors[0].action, 'community-category-create');
  assert.equal(mirrors[0].details.actor, 'owner:owner'); assert.equal(typeof mirrors[0].details.auditEventId, 'string');
  assert.equal(typeof mirrors[0].details.auditCreatedAt, 'string');
});

test('moderated deletion, penalty, mute and notices roll back together when durable auditing fails', async t => {
  const f = await fixture(t, async () => {});
  const author = { kind: 'reader' as const, id: 'synthetic-reader' };
  f.store.ledger.credit(author, 100, 'test', null, new Date().toISOString());
  const topic = f.store.createTopic({ board: 'qa', title: '审核原始内容', body: '隔离数据的有效正文内容', author });
  const before = f.store.ledger.balance(author), notices = f.store.members.inbox(author).length;
  f.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON community_audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit storage failure'); END");
  assert.equal((await f.post(`topics/${topic.id}/delete`, { reason: '删除测试内容', mute: 7 })).status, 500);
  assert.ok(f.store.topic(topic.id)); assert.equal(f.store.members.muted(author), null);
  assert.equal(f.store.ledger.balance(author), before); assert.equal(f.store.members.inbox(author).length, notices);
  assert.equal(f.read('SELECT id FROM community_audit_events').length, 0);
});

test('a failed file mirror leaves deletion and batch moderation committed with durable audit entries', async t => {
  const f = await fixture(t, async () => { throw Error('unavailable file'); });
  const author = { kind: 'reader' as const, id: 'synthetic-reader' };
  f.store.ledger.credit(author, 100, 'test', null, new Date().toISOString());
  const topic = f.store.createTopic({ board: 'qa', title: '审核原始内容', body: '隔离数据的有效正文内容', author });
  assert.equal((await f.post(`topics/${topic.id}/delete`, { reason: '删除测试内容', mute: 7 })).status, 200);
  assert.equal(f.store.topic(topic.id), null); assert.ok(f.store.members.muted(author));
  const ids = [1, 2].map(index => f.store.createTopic({ board: 'qa', title: `待审测试${index}`, body: '隔离数据的有效正文内容', author, pending: 'test' }).id);
  const response = await f.post('manage/review', { ids, action: 'approve' }); assert.equal(response.status, 200);
  for (const id of ids) assert.equal(f.store.topic(id)?.pending, false);
  assert.deepEqual(f.read('SELECT action FROM community_audit_events ORDER BY rowid').map(row => row.action), ['community-delete-topic', 'community-bulk-approve-topics']);
  assert.equal(f.read('SELECT id FROM community_audit_events WHERE mirrored_at IS NULL').length, 2);
});

test('concurrent mirror calls serialize the same pending batch without appending each event twice', async t => {
  const f = await fixture(t, async () => {});
  for (let index = 0; index < 2; index++) f.store.audit.run({ kind: 'owner', id: 'owner' }, 'community-synthetic', () => {}, { index });
  const ids: string[] = []; let release!: () => void;
  const mirror = async (event: { id: string }) => { ids.push(event.id); if (ids.length === 1) await new Promise<void>(done => { release = done; }); };
  const first = f.store.audit.flush(mirror);
  while (!release) await new Promise(done => setTimeout(done, 0));
  const second = f.store.audit.flush(mirror); release(); await Promise.all([first, second]);
  assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 2);
});

test('audit mirror failures log only bounded event metadata and never the reason, actor or private filename', async t => {
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const f = await fixture(t, async () => { throw Object.assign(Error('private-filename /private/data path'), { code: 'EACCES' }); });
  f.store.audit.run({ kind: 'owner', id: 'private-account' }, 'community-synthetic', () => {}, { reason: 'private-sensitive-note' });
  await f.store.audit.flush(async () => { throw Object.assign(Error('private-filename /private/data path'), { code: 'EACCES' }); });
  assert.equal(logs.length, 1); assert.equal(JSON.parse(logs[0]).code, 'EACCES');
  assert.doesNotMatch(logs[0], /private-filename|private-account|private-sensitive-note/);
});
