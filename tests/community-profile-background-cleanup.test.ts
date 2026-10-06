import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import filesystem, { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityHostStore, prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { createCommunityHostRuntime } from '../server/community-host-runtime.ts';
import { createCommunityService } from '../server/community-service.ts';
import { createCommunityRuntime } from '../server/community-runtime.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { cleanReaderFiles } from '../server/reader-file-cleanup.ts';
import { createCommunityDemo } from '../scripts/fixtures/community-demo.mjs';
import type { Payload } from 'payload';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const reader = { kind: 'reader' as const, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const owner = { kind: 'owner' as const, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const community = 'https://community.sansphase.com';
const names = (id: string) => [`community-image-${id}.webp`, `community-thumb-${id}.webp`];

async function fixture(t: test.TestContext, enqueueFailure = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'background-cleanup-'));
  await prepareCommunityHostDirectory(directory);
  const host = createCommunityHostStore(directory);
  const queueFile = (filename: string, reason: string) => {
    if (enqueueFailure && filename.startsWith('community-thumb-')) throw Error('simulated queue failure');
    host.queueFile(filename, reason);
  };
  const store = createCommunityStore(directory, { queueFile });
  const config = { directory, siteOrigin: community, mainSiteOrigin: 'https://www.sansphase.com', authorId: owner.id, bridgeSecret: 'cleanup-test-secret-with-at-least-32-characters' };
  const client = { async request<T>(): Promise<T> { throw Error('This cleanup fixture never contacts an account authority.'); } };
  let runtime = createCommunityHostRuntime(config, client);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  t.after(async () => { await runtime.close(); store.close(); host.close(); db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const add = async () => {
    const id = randomUUID();
    store.addImage({ id, uploader: reader, width: 1200, height: 400, purpose: 'profile' });
    for (const filename of names(id)) await writeFile(resolve(directory, 'uploads', filename), filename);
    return id;
  };
  const absent = async (id: string) => {
    assert.equal(store.image(id), null);
    for (const filename of names(id)) await assert.rejects(readFile(resolve(directory, 'uploads', filename)), { code: 'ENOENT' });
  };
  return { directory, host, store, db, add, absent,
    drain: () => runtime.drainFileQueue(),
    restart: async () => { await runtime.close(); runtime = createCommunityHostRuntime(config, client); },
  };
}

test('fresh replaced, approved, rejected and reset backgrounds retire immediately through the existing durable queue', async t => {
  const { store, host, add, drain, absent } = await fixture(t);
  const first = await add(); store.profileBackgrounds.submit(reader, first); store.profileBackgrounds.review(reader, first, true, owner, '');
  const second = await add(); store.profileBackgrounds.submit(reader, second);
  const third = await add(); store.profileBackgrounds.submit(reader, third);
  assert.equal(store.image(second), null, 'the superseded pending image does not wait 24 hours');
  assert.deepEqual(host.fileQueue().map(row => row.filename).sort(), names(second).sort());
  await drain(); await absent(second);
  assert.equal(store.profileBackgrounds.state(reader).approved?.id, first);
  store.profileBackgrounds.review(reader, third, true, owner, '');
  await drain(); await absent(first);
  const rejected = await add(); store.profileBackgrounds.submit(reader, rejected);
  store.profileBackgrounds.review(reader, rejected, false, owner, '不适合公开');
  await drain(); await absent(rejected);
  assert.equal(store.profileBackgrounds.state(reader).approved?.id, third);
  const pending = await add(); store.profileBackgrounds.submit(reader, pending);
  store.profileBackgrounds.remove(reader); await drain(); await absent(third); await absent(pending);
  assert.deepEqual(store.profileBackgrounds.state(reader), { approved: null, pending: null });
  assert.equal(host.fileQueue().length, 0);
  assert.equal(store.sweepImages(Date.now()).length, 0);
});

test('background retirement preserves approved, pending and every shared image reference', async t => {
  const { store, db, host, add, drain, directory } = await fixture(t);
  const same = await add(); store.profileBackgrounds.submit(reader, same); store.profileBackgrounds.review(reader, same, true, owner, '');
  store.profileBackgrounds.submit(reader, same);
  store.profileBackgrounds.review(reader, same, false, owner, '保留当前背景');
  assert.equal(store.profileBackgrounds.state(reader).approved?.id, same);
  assert.equal(host.fileQueue().length, 0, 'rejecting the already approved image cannot delete the live background');
  store.profileBackgrounds.remove(reader); await drain();
  for (const reference of ['approved', 'pending', 'shop', 'banner', 'topic', 'reply']) {
    const id = await add(); store.profileBackgrounds.submit(reader, id);
    const sharedMember = `${reference}-other`;
    if (reference === 'approved' || reference === 'pending') db.prepare(`INSERT INTO community_profile_backgrounds(member_kind,member_id,${reference}_image,updated_at${reference === 'pending' ? ',pending_at' : ''}) VALUES('reader',?,?,?${reference === 'pending' ? ',?' : ''})`)
      .run(sharedMember, id, new Date().toISOString(), ...(reference === 'pending' ? [new Date().toISOString()] : []));
    if (reference === 'shop') {
      const item = store.economy.saveItem(null, { cat: 'digital', name: '共享素材', description: '', price: 1, stock: null, limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '', note: '', active: false });
      db.prepare('UPDATE community_shop_items SET image=? WHERE id=?').run(id, item);
    }
    if (reference === 'banner') db.prepare("INSERT INTO community_banner_entries(scope,position,topic_id,topic_board,title,cover) VALUES('home',0,?,'qa','',?)").run(randomUUID(), id);
    if (reference === 'topic' || reference === 'reply') db.prepare(`UPDATE community_images SET ${reference}_id=? WHERE id=?`).run(randomUUID(), id);
    // Simulate a surviving legacy/shared reference rather than bypassing the
    // normal upload purpose checks in production APIs.
    store.profileBackgrounds.remove(reader); await drain();
    assert.ok(store.image(id), `${reference} reference protects its registry`);
    for (const filename of names(id)) assert.equal(await readFile(resolve(directory, 'uploads', filename), 'utf8'), filename);
  }
  assert.equal(host.fileQueue().length, 0);
});

test('a rolled-back background retirement cannot delete registered files even with a separately committed queue', async t => {
  const { store, host, add, drain, directory } = await fixture(t);
  const id = await add(); store.profileBackgrounds.submit(reader, id);
  assert.throws(() => store.transaction(() => { store.profileBackgrounds.remove(reader); throw Error('rollback'); }), /rollback/);
  assert.equal(store.profileBackgrounds.state(reader).pending?.id, id);
  assert.ok(store.image(id)); assert.equal(host.fileQueue().length, 2);
  assert.equal((await drain()).retained, 2);
  for (const filename of names(id)) assert.equal(await readFile(resolve(directory, 'uploads', filename), 'utf8'), filename);
  store.profileBackgrounds.remove(reader); assert.equal((await drain()).removed, 2);
  assert.equal(host.fileQueue().length, 0);
});

test('enqueue failure rolls back replacement references and retains the original registered picture', async t => {
  const { store, host, add, drain } = await fixture(t, true);
  const first = await add(), next = await add(); store.profileBackgrounds.submit(reader, first);
  assert.throws(() => store.profileBackgrounds.submit(reader, next), /simulated queue failure/);
  assert.equal(store.profileBackgrounds.state(reader).pending?.id, first);
  assert.ok(store.image(first)); assert.ok(store.image(next));
  assert.equal(host.fileQueue().length, 1);
  assert.equal((await drain()).retained, 1, 'partially queued candidates remain protected after rollback');
});

test('a blocked background file remains queued across restart and is retried without losing unrelated files', async t => {
  const { store, host, add, drain, restart, directory, absent } = await fixture(t);
  const id = await add(); store.profileBackgrounds.submit(reader, id);
  const blocked = resolve(directory, 'uploads', names(id)[0]);
  await rm(blocked); await mkdir(blocked);
  await writeFile(resolve(directory, 'uploads', 'unknown.keep'), 'preserve');
  store.profileBackgrounds.remove(reader);
  assert.deepEqual(await drain(), { removed: 1, retained: 1 });
  assert.equal(host.fileQueue().length, 1); assert.equal(host.fileQueue()[0].attempts, 1);
  await restart();
  assert.equal(host.fileQueue().length, 1);
  await rm(blocked, { recursive: true }); await writeFile(blocked, 'restored regular file');
  assert.deepEqual(await drain(), { removed: 1, retained: 0 }); await absent(id);
  assert.equal(await readFile(resolve(directory, 'uploads', 'unknown.keep'), 'utf8'), 'preserve');
});

test('unlink permission failures remain in the persistent queue and succeed after a runtime restart', async t => {
  const { store, host, add, drain, restart, directory, absent } = await fixture(t);
  const id = await add(), blocked = resolve(directory, 'uploads', names(id)[0]);
  store.profileBackgrounds.submit(reader, id);
  const original = filesystem.unlink;
  const unlink = t.mock.method(filesystem, 'unlink', async (path: Parameters<typeof original>[0]) => {
    if (String(path) === blocked) throw Object.assign(Error('simulated permission failure'), { code: 'EACCES' });
    return original(path);
  });
  syncBuiltinESMExports();
  try {
    store.profileBackgrounds.remove(reader);
    assert.deepEqual(await drain(), { removed: 1, retained: 1 });
    assert.equal(host.fileQueue().length, 1);
    assert.equal(await readFile(blocked, 'utf8'), names(id)[0]);
    await restart(); assert.deepEqual(await drain(), { removed: 0, retained: 1 });
    assert.equal(host.fileQueue()[0].attempts, 2);
  } finally { unlink.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(await drain(), { removed: 1, retained: 0 }); await absent(id);
});

test('the ordinary stale-upload sweep queues files before removing their registry', async t => {
  const { store, host, add, drain, absent, directory } = await fixture(t);
  const id = await add();
  assert.deepEqual(store.sweepImages(Date.now() + 24 * 3600_000 + 1000), [id]);
  assert.equal(host.fileQueue().length, 2, 'sweep failures retain the same retry path as background replacements');
  for (const filename of names(id)) assert.equal(await readFile(resolve(directory, 'uploads', filename), 'utf8'), filename);
  await drain(); await absent(id); assert.equal(host.fileQueue().length, 0);
});

test('background mutation drains retired files after its audit transaction commits and before the response', async t => {
  const { store, add, drain, absent, directory } = await fixture(t);
  acceptCommunityConvention(store, [reader]);
  const id = await add(); store.profileBackgrounds.submit(reader, id);
  const profileState = async () => ({ id: reader.id, uid: '10001', nickname: '读者', signature: '', avatar: null, pendingSignature: null, pendingAvatar: false });
  const unsupported = async () => { throw Error('Unused profile action.'); };
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let committedDrain = false;
  service = createCommunityService({ store, directory, siteOrigin: origin,
    identify: async () => ({ ...reader, name: '读者', vip: false }),
    people: async authors => new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: '读者', uid: '10001', avatar: null, bio: '', vip: false, joinedAt: null }])),
    profile: { state: profileState, signature: unsupported, avatar: unsupported, removeAvatar: unsupported, pendingAvatar: unsupported, reviews: unsupported, reviewImage: unsupported, review: unsupported },
    drainFileQueue: async () => { if (!store.image(id)) committedDrain = true; return drain(); },
  });
  const response = await fetch(origin + '/api/community/profile/background/remove', { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200); assert.equal(committedDrain, true);
  await absent(id);
});

test('a cleanup queue outage after upload commit does not remove the newly registered pending background', async t => {
  const { store, add, drain, absent, directory, host } = await fixture(t);
  acceptCommunityConvention(store, [reader]);
  const first = await add(); store.profileBackgrounds.submit(reader, first);
  const profileState = async () => ({ id: reader.id, uid: '10001', nickname: '读者', signature: '', avatar: null, pendingSignature: null, pendingAvatar: false });
  const unsupported = async () => { throw Error('Unused profile action.'); };
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  service = createCommunityService({ store, directory, siteOrigin: origin,
    identify: async () => ({ ...reader, name: '读者', vip: false }),
    people: async authors => new Map(authors.map(author => [`${author.kind}:${author.id}`, { name: '读者', uid: '10001', avatar: null, bio: '', vip: false, joinedAt: null }])),
    profile: { state: profileState, signature: unsupported, avatar: unsupported, removeAvatar: unsupported, pendingAvatar: unsupported, reviews: unsupported, reviewImage: unsupported, review: unsupported },
    drainFileQueue: async () => { if (!store.image(first)) throw Error('simulated cleanup queue outage'); return drain(); },
  });
  const { default: sharp } = await import('sharp');
  const bytes = await sharp({ create: { width: 600, height: 200, channels: 3, background: '#315a74' } }).png().toBuffer();
  const body = new FormData(); body.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'background.png');
  const response = await fetch(origin + '/api/community/profile/background', { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1' }, body });
  assert.equal(response.status, 200, 'cleanup retry must not turn a committed upload into an error');
  const current = (await response.json()).background.pending.id as string;
  assert.notEqual(current, first); assert.ok(store.image(current));
  for (const filename of names(current)) assert.ok((await readFile(resolve(directory, 'uploads', filename))).length > 0);
  assert.equal(host.fileQueue().length, 2, 'retired files stay durably queued for the next retry');
  await drain(); await absent(first);
});

test('the main-site local runtime uses its existing reader workflow queue for background replacement', async t => {
  const { directory, add, absent } = await fixture(t);
  const workflow = createReaderWorkflow(directory, 'local-cleanup-secret-with-at-least-32-characters');
  const payload = { find: async () => ({ docs: [{ id: reader.id, nickname: '读者', avatar: null, signature: '' }], totalDocs: 1 }) } as unknown as Payload;
  const runtime = createCommunityRuntime({ directory, payload, siteOrigin: 'http://127.0.0.1:1', authorId: owner.id,
    uidStore: { get: () => '10001', readerId: () => reader.id }, ownerName: async () => '作者',
    readerIdentity: async () => ({ id: reader.id, nickname: '读者' }), ownerIdentity: async () => null,
    queueFile: workflow.queueFile, drainFileQueue: () => cleanReaderFiles({ workflow, payload, directory }),
  });
  try {
    const first = await add(), second = await add();
    runtime.store!.profileBackgrounds.submit(reader, first); runtime.store!.profileBackgrounds.submit(reader, second);
    assert.equal(workflow.cleanupFiles().length, 2);
    const response = { writeHead: () => {}, end: () => {} };
    await runtime.service.handle({ method: 'GET', url: '/api/community/me', headers: {} }, response);
    await absent(first); assert.ok(runtime.store!.image(second)); assert.equal(workflow.cleanupFiles().length, 0);
  } finally { runtime.close(); }
});

test('the disposable browser preview deletes superseded pending backgrounds before returning the next upload', async t => {
  const removed: string[] = [], original = filesystem.unlink;
  const unlink = t.mock.method(filesystem, 'unlink', async (path: Parameters<typeof original>[0]) => { await original(path); removed.push(String(path)); });
  syncBuiltinESMExports();
  const demo = await createCommunityDemo();
  let service: ReturnType<typeof demo.service>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); demo.close(); unlink.mock.restore(); syncBuiltinESMExports(); });
  const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;
  service = demo.service(port);
  const post = (path: string, body: unknown) => fetch(`${origin}/api/community/${path}`, { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const convention = await (await fetch(origin + '/api/community/convention')).json();
  assert.equal((await post('convention/read', { version: convention.version })).status, 200);
  const readAt = Date.now(); t.mock.method(Date, 'now', () => readAt + 10001);
  assert.equal((await post('agree', { version: convention.version })).status, 200);
  const { default: sharp } = await import('sharp');
  const png = await sharp({ create: { width: 600, height: 200, channels: 3, background: '#315a74' } }).png().toBuffer();
  const upload = async () => {
    const body = new FormData(); body.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'background.png');
    const response = await fetch(origin + '/api/community/profile/background', { method: 'POST', headers: { Origin: origin, 'X-Reader-Request': '1' }, body });
    assert.equal(response.status, 200); return (await response.json()).background.pending.id as string;
  };
  const first = await upload(), second = await upload();
  assert.notEqual(first, second);
  for (const filename of names(first)) assert.ok(removed.some(path => path.endsWith(filename)), `${filename} is removed during replacement`);
  assert.ok(!removed.some(path => names(second).some(filename => path.endsWith(filename))), 'the active pending upload stays on disk');
});
