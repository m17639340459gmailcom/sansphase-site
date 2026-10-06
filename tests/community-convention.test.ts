import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';

const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-convention-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function setup(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-convention-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  store.members.setSteward({ kind: 'reader', id: 'moderator' }, true, ['qa']);
  let service: ReturnType<typeof createCommunityService>;
  let bodyStarted: (() => void) | null = null;
  const server = createServer((req, res) => {
    if (req.headers['x-test-slow-body']) req.on('newListener', event => { if (event === 'readable') bodyStarted?.(); });
    void service.handle(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({
    store, siteOrigin: origin, directory,
    identify: async req => {
      const id = String(req.headers.cookie || '').split(';')[0];
      if (!['reader', 'other', 'moderator', 'owner'].includes(id)) return null;
      return { kind: id === 'owner' ? 'owner' : 'reader', id, name: id, vip: false };
    },
    people: async authors => new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: author.id, uid: author.id, avatar: null, vip: false, joinedAt: null, bio: '' }])),
  });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await cleanup(directory); });
  const get = (path: string, identity = 'reader') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: identity } });
  const post = (path: string, body: Record<string, unknown>, identity = 'reader', headers: Record<string, string> = {}) => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { cookie: identity, origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const sql = (statement: string, ...values: string[]) => {
    const db = new DatabaseSync(resolve(directory, 'content.db'));
    try { return db.prepare(statement).run(...values); } finally { db.close(); }
  };
  const current = async () => await (await get('convention')).json() as { version: string; body: string };
  const consent = async (identity = 'reader') => {
    const convention = await current();
    assert.equal((await post('convention/read', { version: convention.version }, identity)).status, 200);
    sql('UPDATE community_members SET convention_read_at = convention_read_at - 10000 WHERE member_id = ?', identity.split(';')[0]);
    assert.equal((await post('agree', { version: convention.version }, identity)).status, 200);
    return convention;
  };
  const slowPost = async (path: string, body: Record<string, unknown>, duringBody: () => Promise<void>) => {
    const payload = JSON.stringify(body);
    let started: () => void = () => {};
    const ready = new Promise<void>(resolve => { started = resolve; });
    bodyStarted = started;
    const client = request(`${origin}/api/community/${path}`, {
      method: 'POST', headers: { cookie: 'reader', origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Test-Slow-Body': '1' },
    });
    const response = new Promise<number>((resolve, reject) => {
      client.on('response', incoming => { incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode || 0)); });
      client.on('error', reject);
    });
    client.write(payload.slice(0, 1));
    try {
      await Promise.race([ready, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Error('body was not read')), 3000); timer.unref(); })]);
      await duringBody(); client.end(payload.slice(1));
      return await response;
    } finally { bodyStarted = null; client.destroy(); }
  };
  return { directory, store, get, post, sql, current, consent, slowPost };
}

test('convention and contacts require login and legacy unversioned agreement never counts as current consent', async t => {
  const { get, sql, current } = await setup(t);
  for (const path of ['convention', 'moderation-contacts', 'summary']) assert.equal((await get(path, '')).status, 401, path);
  const convention = await current();
  assert.ok(convention.version && convention.body.length > 100);
  sql("INSERT OR IGNORE INTO community_members(member_kind,member_id,created_at) VALUES('reader','reader','2026-10-01')");
  sql("UPDATE community_members SET agreed_at='2026-10-01T00:00:00Z' WHERE member_id='reader'");
  for (const identity of ['reader', 'owner']) {
    const me = await (await get('me', identity)).json();
    assert.deepEqual(me.convention, { version: convention.version, agreed: false });
    assert.equal(me.agreed, false);
  }
});

test('reading is persisted and only the server ten-second deadline enables current-version consent', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { get, post, current, directory } = await setup(t);
  const { version } = await current();
  assert.equal((await post('agree', { version })).status, 428, 'cannot agree without starting a read');
  const read = await (await post('convention/read', { version })).json() as { version: string; eligibleAt: string };
  assert.equal(read.version, version);
  assert.equal(Date.parse(read.eligibleAt), Date.now() + 10000);
  const waitingReopened = createCommunityStore(directory);
  try { assert.deepEqual(waitingReopened.convention.read({ kind: 'reader', id: 'reader' }, version), read); }
  finally { waitingReopened.close(); }
  t.mock.timers.tick(9999);
  const repeated = await (await post('convention/read', { version })).json();
  assert.deepEqual(repeated, read, 'same-version read does not reset the deadline');
  assert.equal((await post('agree', { version })).status, 428);
  t.mock.timers.tick(1);
  assert.deepEqual(await (await post('agree', { version })).json(), { agreed: true, version });
  assert.deepEqual((await (await get('me')).json()).convention, { version, agreed: true });
  const reopened = createCommunityStore(directory);
  try { assert.deepEqual(reopened.convention.state({ kind: 'reader', id: 'reader' }), { version, agreed: true }); }
  finally { reopened.close(); }
  assert.equal((await post('agree', { version }, 'other')).status, 428, 'one account cannot reuse another account read');
  assert.equal((await post('agree', {})).status, 400, 'legacy agree payload is rejected');
  assert.equal((await post('agree', { version, startedAt: '2000-01-01', member: 'other' })).status, 400);
  assert.equal((await post('convention/read', { version }, 'reader', { origin: 'https://foreign.example' })).status, 403);
});

test('every normal write including legacy checkbox posting is blocked until consent, while muted users may read and agree', async t => {
  const { store, get, post, current, consent } = await setup(t);
  for (const [path, body] of [
    ['checkin', {}], ['inbox/read-all', {}], ['shop/redeem', { item: 'makeup' }],
    ['topics', { board: 'qa', title: '尝试绕过同意', body: '完整正文', agree: true }],
    ['me/contact', { qq: '1234567', email: '' }], ['manage/convention', { body: '公约正文', version: 'old' }],
  ] as Array<[string, Record<string, unknown>]>) assert.equal((await post(path, body)).status, 428, path);
  store.members.mute({ kind: 'reader', id: 'reader' }, 7, '其他', { kind: 'owner', id: 'owner' });
  assert.equal((await get('convention')).status, 200);
  const { version } = await current();
  assert.equal((await post('convention/read', { version })).status, 200);
  await consent();
  assert.equal((await get('moderation-contacts')).status, 200);
  assert.equal((await post('checkin', {})).status, 200);
});

test('only the author publishes a real change, version conflicts fail, and new text invalidates everyone including its author', async t => {
  const { get, post, consent, current, directory } = await setup(t);
  const original = await consent('owner');
  await consent('reader'); await consent('moderator');
  assert.equal((await post('manage/convention', { ...original, body: original.body + '\n\n新增规范。' }, 'reader')).status, 403);
  assert.equal((await post('manage/convention', { ...original, body: original.body + '\n\n新增规范。' }, 'moderator')).status, 403);
  assert.deepEqual(await (await post('manage/convention', { ...original, body: original.body + '\n' }, 'owner')).json(), original);
  const savedResponse = await post('manage/convention', { ...original, body: original.body + '\n\n新增规范。' }, 'owner');
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json() as { version: string; body: string };
  assert.notEqual(saved.version, original.version);
  assert.equal((await current()).version, saved.version);
  for (const identity of ['owner', 'reader', 'moderator']) assert.deepEqual((await (await get('me', identity)).json()).convention, { version: saved.version, agreed: false });
  assert.equal((await post('agree', { version: original.version })).status, 409);
  assert.equal((await post('convention/read', { version: original.version })).status, 409);
  await consent('owner');
  assert.equal((await post('manage/convention', { ...original, body: '不能用旧版本覆盖。' }, 'owner')).status, 409);
  const reopened = createCommunityStore(directory);
  try { assert.deepEqual(reopened.convention.current(), saved); } finally { reopened.close(); }
});

test('author text is bounded safe Markdown and rejected edits do not alter the current agreement', async t => {
  const { post, consent, current } = await setup(t);
  const original = await consent('owner');
  for (const body of ['', 'x'.repeat(20001), '<script>alert(1)</script>', '# 公约\n<img src=x onerror=alert(1)>', '[点击](javascript:alert(1))', '[点击](data:text/html,a)', '# 公约\u0000正文']) {
    assert.equal((await post('manage/convention', { version: original.version, body }, 'owner')).status, 400, body.slice(0, 60));
    assert.deepEqual(await current(), original);
  }
});

test('in-flight writes recheck version after reading their body when the author publishes an update', async t => {
  const { post, consent, slowPost, store } = await setup(t);
  const original = await consent('owner'); await consent('reader');
  const status = await slowPost('checkin', {}, async () => {
    assert.equal((await post('manage/convention', { version: original.version, body: original.body + '\n\n新版补充。' }, 'owner')).status, 200);
  });
  assert.equal(status, 428);
  assert.equal(store.economy.checked({ kind: 'reader', id: 'reader' }), false);
});

test('publication and required reconsent roll back if durable auditing fails', async t => {
  const { directory, post, get, consent, current, sql } = await setup(t);
  const original = await consent('owner');
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec("CREATE TRIGGER reject_convention_audit BEFORE INSERT ON community_audit_events WHEN NEW.action='community-convention' BEGIN SELECT RAISE(ABORT,'synthetic convention audit failure'); END");
  db.close();
  assert.equal((await post('manage/convention', { version: original.version, body: original.body + '\n\n应该回滚的新段落。' }, 'owner')).status, 500);
  assert.deepEqual(await current(), original);
  assert.deepEqual((await (await get('me', 'owner')).json()).convention, { version: original.version, agreed: true });
  sql('DROP TRIGGER reject_convention_audit');
});

test('separate connections enforce optimistic version conflicts and renewed ten-second reads', async t => {
  const { directory, store, consent } = await setup(t);
  const original = await consent('owner');
  const otherStore = createCommunityStore(directory);
  try {
    const owner = { kind: 'owner' as const, id: 'owner' };
    const saved = store.convention.replace(owner, original.version, original.body + '\n\n第一个连接发布。');
    assert.throws(() => otherStore.convention.replace(owner, original.version, original.body + '\n\n不能覆盖。'), { status: 409 });
    assert.deepEqual(otherStore.convention.current(), saved);
    assert.equal(otherStore.convention.state(owner).agreed, false);
    assert.throws(() => otherStore.convention.agree(owner, saved.version), { status: 428 });
    const readAt = Date.now();
    const read = otherStore.convention.read(owner, saved.version, readAt);
    assert.equal(Date.parse(read.eligibleAt), readAt + 10000, 'old-version elapsed reading never carries into the new version');
    assert.throws(() => otherStore.convention.agree(owner, saved.version, readAt + 9999), { status: 428 });
  } finally { otherStore.close(); }
});
