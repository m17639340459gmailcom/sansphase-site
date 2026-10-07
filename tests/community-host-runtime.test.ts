import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPreviewServer } from '../server.mjs';
import { createIdentityAuthority } from '../server/community-identity-authority.ts';
import { prepareIdentityStore } from '../server/community-identity-store.ts';
import { createIdentityClient, signIdentityRequest } from '../server/community-identity-protocol.ts';
import { createCommunityHostStore, prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { communityHostProductionOptions, createCommunityHostRuntime } from '../server/community-host-runtime.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const main = 'https://www.sansphase.com';
const community = 'https://community.sansphase.com';
const secret = 'test-bridge-secret-with-at-least-32-characters';
const authorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const readerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const avatarId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const reader = { id: readerId, uid: '10001', nickname: '测试读者', signature: '', avatar: `/api/reader/avatar/${avatarId}.webp`, vip: true, vipStartedAt: '2026-10-01T00:00:00.000Z', vipUntil: '2027-10-01T00:00:00.000Z' };
const observer = { ...reader, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', uid: '10002', nickname: '旁观读者' };
let template: string;
test.before(async () => { template = await mkdtemp(resolve(tmpdir(), 'host-runtime-template-')); await prepareCommunityHostDirectory(template); });
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
async function fixture(t: test.TestContext) {
  const base = await mkdtemp(resolve(tmpdir(), 'host-runtime-'));
  const directory = resolve(base, 'private-community');
  const root = resolve(base, 'public');
  const mainDirectory = resolve(base, 'private-main');
  await mkdir(directory); await mkdir(root); await mkdir(resolve(directory, 'uploads')); await mkdir(mainDirectory);
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  await copyFile(resolve(template, 'community-host.db'), resolve(directory, 'community-host.db'));
  await writeFile(resolve(root, 'index.html'), '<!doctype html><html><head></head><body><main id="app"></main></body></html>');
  prepareIdentityStore(mainDirectory);
  const state = { enabled: true, vip: true, unavailable: false };
  let paused: { operation: string; started: () => void; release: Promise<void> } | null = null;
  const authority = createIdentityAuthority({ directory: mainDirectory, siteOrigin: main, communityOrigin: community, ownerId: authorId, secret, stateEncryptionKey: 'separate-test-encryption-key-at-least-32-chars',
    readerIdentity: async req => { if (state.unavailable) throw Error('private source failure'); const account = req.headers.cookie === 'sansphase_reader_session=main.token' ? reader : req.headers.cookie === 'sansphase_reader_session=main.observer' ? observer : null; return state.enabled && account ? { ...account, vip: state.vip } : null; },
    ownerIdentity: async () => null,
    people: async authors => new Map(authors.flatMap(author => { const account = [reader, observer].find(item => item.id === author.id); return account ? [[`${author.kind}:${author.id}`, { name: account.nickname, uid: account.uid, avatar: avatarId, bio: account.signature, vip: state.vip, joinedAt: '2026-01-01T00:00:00Z' }] as const] : []; })),
    findMember: async uid => { const account = [reader, observer].find(item => item.uid === uid); return account ? { kind: 'reader', id: account.id } : null; },
    findByNames: async names => new Map(names.filter(name => name === reader.nickname).map(name => [name, { kind: 'reader' as const, id: readerId }])),
    avatar: async () => Buffer.from('approved-avatar'),
  });
  const mainServer = createServer((req, res) => { void (req.url === '/api/community-entry' ? authority.handleEntry(req, res) : authority.handleBridge(req, res)); });
  await new Promise<void>(done => mainServer.listen(0, '127.0.0.1', done));
  const localMain = `http://127.0.0.1:${(mainServer.address() as { port: number }).port}`;
  const client = createIdentityClient({ origin: main, secret, fetch: async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, main);
    const response = await fetch(localMain + url.pathname, options);
    const operation = JSON.parse(String(options?.body || '{}')).operation;
    if (paused?.operation === operation) { const gate = paused; paused = null; gate.started(); await gate.release; }
    return response;
  } });
  const runtime = createCommunityHostRuntime({ directory, siteOrigin: community, mainSiteOrigin: main, bridgeSecret: secret, authorId }, client);
  const server = createPreviewServer({ ...runtime, root });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); await new Promise<void>(done => mainServer.close(() => done())); authority.close(); await runtime.close(); await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const entry = async (expectedStatus = 200, mainToken = 'main.token') => {
    const issued = await fetch(localMain + '/api/community-entry', { method: 'POST', headers: { Origin: main, 'X-Reader-Request': '1', Cookie: `sansphase_reader_session=${mainToken}` } });
    assert.equal(issued.status, 200);
    const issuedBody = await issued.json();
    const bindingCookie = issued.headers.getSetCookie()[0];
    assert.ok(bindingCookie.includes('Domain=sansphase.com; Path=/api/community-entry'));
    const ticket = new URL(issuedBody.url).hash.slice('#community-entry='.length);
    const response = await fetch(local + '/api/community-entry', { method: 'POST', headers: { Origin: community, 'X-Reader-Request': '1', Cookie: bindingCookie.split(';')[0], 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) });
    assert.equal(response.status, expectedStatus);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))?.split(';')[0] || '';
    return { cookie, ticket, bindingCookie, response };
  };
  const pause = (operation: string) => {
    let started!: () => void, release!: () => void;
    const waiting = new Promise<void>(done => { started = done; });
    const held = new Promise<void>(done => { release = done; });
    paused = { operation, started, release: held };
    return { waiting, release };
  };
  const purge = async () => {
    const path = '/api/community-identity/purge', body = JSON.stringify({ operation: 'purge', input: { readerId } });
    const response = await fetch(local + path, { method: 'POST', headers: signIdentityRequest({ secret, method: 'POST', path, body }), body });
    assert.equal(response.status, 200); return response;
  };
  return { directory, runtime, local, state, entry, pause, purge };
}

test('standalone host exchanges real protocol tickets, boots only community and returns account projection without credentials', async t => {
  const env = await fixture(t), { cookie, ticket, bindingCookie } = await env.entry();
  const html = await (await fetch(env.local + '/', { headers: { cookie } })).text();
  assert.ok(html.includes('data-community-only="true" data-community-boot="pending"'));
  const bootstrap = await (await fetch(env.local + '/api/content?view=bootstrap', { headers: { cookie } })).json();
  assert.equal(bootstrap.communityOnly, true); assert.equal(bootstrap.mainSiteOrigin, main); assert.equal(bootstrap.communityEnabled, true);
  assert.equal(bootstrap.reader.avatar, `/api/community/avatar/10001.webp?v=${avatarId}`);
  for (const privateValue of ['main.token', 'password', 'email', 'phone']) assert.ok(!JSON.stringify(bootstrap).includes(privateValue));
  assert.equal((await fetch(env.local + '/api/content?view=list&kind=notes', { headers: { cookie } })).status, 404);
  assert.equal((await fetch(env.local + '/api/reader/register', { method: 'POST', headers: { cookie } })).status, 404);
  const me = await (await fetch(env.local + '/api/community/me', { headers: { cookie } })).json();
  assert.equal(me.name, reader.nickname); assert.equal(me.vip, true);
  assert.equal(me.avatar, bootstrap.reader.avatar);
  assert.equal(await (await fetch(env.local + '/api/community/avatar/10001.webp', { headers: { cookie } })).text(), 'approved-avatar');
  const repeat = await fetch(env.local + '/api/community-entry', { method: 'POST', headers: { Origin: community, 'X-Reader-Request': '1', Cookie: bindingCookie.split(';')[0] }, body: JSON.stringify({ ticket }) });
  assert.equal(repeat.status, 401);
  env.state.vip = false;
  assert.equal((await (await fetch(env.local + '/api/community/me', { headers: { cookie } })).json()).vip, false);
  env.state.unavailable = true;
  assert.equal((await fetch(env.local + '/api/community/me', { headers: { cookie } })).status, 503);
  env.state.unavailable = false; env.state.enabled = false;
  assert.equal((await fetch(env.local + '/api/community/me', { headers: { cookie } })).status, 401);
});

test('standalone formal host publishes only author-listed products and refuses local preview sample sales', async t => {
  const env = await fixture(t);
  const store = createCommunityStore(env.directory), member = { kind: 'reader' as const, id: readerId };
  const product = { cat: 'digital' as const, name: '作者上架的正式资源', description: '已确认发布', price: 40, stock: null,
    limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '资源内容', note: '', active: true };
  let item: string;
  try {
    acceptCommunityConvention(store, [member]);
    store.ledger.credit(member, 1000, 'test', null, new Date().toISOString());
    item = store.economy.saveItem(null, product);
    store.economy.saveItem(null, { ...product, name: '未上架草稿', active: false });
  } finally { store.close(); }
  const { cookie } = await env.entry();
  const shop = await fetch(env.local + '/api/community/shop', { headers: { cookie } });
  assert.equal(shop.status, 200);
  assert.deepEqual((await shop.json()).items.map((entry: { id: string }) => entry.id), [item]);
  const redeem = await fetch(env.local + '/api/community/shop/redeem', { method: 'POST',
    headers: { cookie, Origin: community, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'frame-gold' }) });
  assert.equal(redeem.status, 409);
  assert.match((await redeem.json()).error, /下架/);
  const mine = await (await fetch(env.local + '/api/community/shop/mine', { headers: { cookie } })).json();
  assert.equal(mine.balance, 1000);
  assert.deepEqual(mine.orders, []);
  assert.deepEqual(mine.looks, []);
});

test('persistent image queue protects registered files and signed purge removes only designated reader data', async t => {
  const env = await fixture(t), { cookie } = await env.entry();
  const store = createCommunityStore(env.directory);
  const host = createCommunityHostStore(env.directory);
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const image = `community-image-${id}.webp`, thumb = `community-thumb-${id}.webp`;
  store.addImage({ id, uploader: { kind: 'reader', id: readerId }, width: 32, height: 32 });
  const topic = store.createTopic({ board: 'qa', author: { kind: 'reader', id: readerId }, title: '待删除的帖子', body: '正文内容正文内容', images: [id] });
  await writeFile(resolve(env.directory, 'uploads', image), 'registered image');
  await writeFile(resolve(env.directory, 'uploads', thumb), 'registered thumb');
  await writeFile(resolve(env.directory, 'uploads', 'unknown.keep'), 'preserve');
  host.queueFile(image, 'simulated-rollback');
  assert.equal((await env.runtime.drainFileQueue()).retained, 1);
  assert.equal(await readFile(resolve(env.directory, 'uploads', image), 'utf8'), 'registered image');
  store.close(); host.close();
  const path = '/api/community-identity/purge';
  const body = JSON.stringify({ operation: 'purge', input: { readerId } });
  const response = await fetch(env.local + path, { method: 'POST', headers: signIdentityRequest({ secret, method: 'POST', path, body }), body });
  assert.equal(response.status, 200);
  await assert.rejects(readFile(resolve(env.directory, 'uploads', image)), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(env.directory, 'uploads', thumb)), { code: 'ENOENT' });
  assert.equal(await readFile(resolve(env.directory, 'uploads', 'unknown.keep'), 'utf8'), 'preserve');
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT 1 FROM community_topics WHERE id=?').get(topic.id), undefined); } finally { db.close(); }
  assert.equal((await fetch(env.local + '/api/community/me', { headers: { cookie } })).status, 401);
});

test('community production start requires fixed origins, patched Node, private config and loopback', () => {
  const env = { NODE_ENV: 'production', SITE_ORIGIN: community, COMMUNITY_CONFIG_FILE: resolve(tmpdir(), 'private-community.json') };
  assert.equal(communityHostProductionOptions(env, '24.21.0').host, '127.0.0.1');
  for (const version of ['22.21.0', '24.20.0', '25.0.0']) assert.throws(() => communityHostProductionOptions(env, version), /Node/);
  assert.throws(() => communityHostProductionOptions({ ...env, HOST: '0.0.0.0' }, '24.21.0'), /loopback/);
  assert.throws(() => communityHostProductionOptions({ ...env, SITE_ORIGIN: 'http://community.sansphase.com' }, '24.21.0'), /HTTPS/);
});

test('a delayed verified session cannot recreate deleted community membership after purge', async t => {
  const env = await fixture(t), { cookie } = await env.entry();
  const gate = env.pause('session');
  const reading = fetch(env.local + '/api/community/convention', { headers: { cookie } });
  await gate.waiting;
  await env.purge();
  gate.release();
  assert.equal((await reading).status, 401);
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try { for (const table of ['community_members', 'community_visits']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_kind='reader' AND member_id=?`).get(readerId)?.count, 0); }
  finally { db.close(); }
});

test('a POST paused in remote profile lookup cannot recreate experience after reader purge', async t => {
  const env = await fixture(t), { cookie } = await env.entry();
  const seed = createCommunityStore(env.directory);
  acceptCommunityConvention(seed, [{ kind: 'reader', id: readerId }]); seed.close();
  const gate = env.pause('people');
  const posting = fetch(env.local + '/api/community/active/visit', { method: 'POST', headers: { cookie, Origin: community, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: '{}' });
  await gate.waiting;
  await env.purge();
  gate.release();
  assert.equal((await posting).status, 401);
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try { for (const table of ['community_members', 'community_visits', 'community_experience_ledger', 'community_vip_growth_days']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_kind='reader' AND member_id=?`).get(readerId)?.count, 0); }
  finally { db.close(); }
});

test('exchange response held across purge cannot create a new session for a deleted reader', async t => {
  const env = await fixture(t);
  const gate = env.pause('exchange');
  const entering = env.entry(401);
  await gate.waiting;
  await env.purge();
  gate.release();
  const result = await entering;
  assert.equal(result.cookie, '');
  const db = new DatabaseSync(resolve(env.directory, 'community-host.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_host_sessions').get()?.count, 0); }
  finally { db.close(); }
});

for (const operation of ['member', 'people']) test(`another reader's delayed ${operation} lookup cannot recreate a deleted profile`, async t => {
  const env = await fixture(t), { cookie } = await env.entry(200, 'main.observer');
  const gate = env.pause(operation);
  const reading = fetch(env.local + '/api/community/members/10001?tab=badges', { headers: { cookie } });
  await gate.waiting;
  await env.purge();
  gate.release();
  const response = await reading;
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try {
    for (const table of ['community_members', 'community_visits', 'community_badge_honors']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_kind='reader' AND member_id=?`).get(readerId)?.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM community_members WHERE member_kind='reader' AND member_id=?").get(observer.id)?.count, 1);
  } finally { db.close(); }
  assert.equal(response.status, 404);
});
