import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { createTeahouseService } from '../server/teahouse-service.ts';
import { createTeahouseStore } from '../server/teahouse-store.ts';
import type { TeahouseActor, TeahouseMessage } from '../src/teahouse-types.ts';

type Reply<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
async function fixture(t: test.TestContext, prepare?: (directory: string) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'teahouse-lifecycle-'));
  prepare?.(directory);
  const old: TeahouseActor = { kind: 'reader', id: randomUUID(), name: '即将注销会员', role: 'moderator', vip: true };
  const live: TeahouseActor = { kind: 'reader', id: randomUUID(), name: '保留会员', role: null, vip: true };
  const actors = new Map([['old', old], ['live', live]]);
  const activities: string[] = [];
  let beforeAuthors: (() => Promise<void>) | undefined;
  const server = createServer((req, res) => { void service.handle(req, res).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const service = createTeahouseService({
    server, directory, origin, accessCheckMs: 30,
    identify: async (req) => actors.get(String(req.headers.cookie ?? '').replace('session=', '')) ?? null,
    authors: async (_req, authors) => { const snapshot = authors.map(author => ({ ...author })); await beforeAuthors?.(); return snapshot; },
    onActivity: (req) => { activities.push(String(req.headers.cookie ?? '').replace('session=', '')); },
  });
  const sockets: Socket[] = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await service.close();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  });
  async function connect(key: string) {
    const socket = io(origin, { path: '/api/teahouse/socket.io', transports: ['websocket'], reconnection: false, extraHeaders: { Cookie: `session=${key}`, Origin: origin } });
    sockets.push(socket);
    await new Promise<void>((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); });
    return socket;
  }
  const request = (path: string, key = 'live') => fetch(origin + path, { headers: { Cookie: `session=${key}`, Origin: origin }, signal: AbortSignal.timeout(3000) });
  async function attachment(actor = old) {
    const saved = service.store.registerAttachment(actor, { id: randomUUID(), mime: 'image/webp', size: 5, width: 1, height: 1 });
    await mkdir(join(directory, 'images'), { recursive: true });
    await writeFile(join(directory, 'images', `${saved.id}.webp`), Buffer.from('image'));
    return saved;
  }
  return { directory, service, old, live, actors, activities, connect, request, attachment, onAuthors: (hook?: () => Promise<void>) => { beforeAuthors = hook; } };
}
const emit = <T>(socket: Socket, event: string, input: unknown) => socket.timeout(3000).emitWithAck(event, input) as Promise<Reply<T>>;

test('account purge disconnects stale sessions, clears member content and announces the deletion', async (t) => {
  const f = await fixture(t);
  const old = await f.connect('old'), live = await f.connect('live');
  const attachment = await f.attachment();
  const own = f.service.store.sendMessage(f.old, { id: randomUUID(), text: '将删除原文', attachmentIds: [attachment.id] });
  const kept = f.service.store.sendMessage(f.live, { id: randomUUID(), text: '保持正常' });
  f.service.store.saveAnnouncement(f.old, { title: '删除公告', text: '正文' });
  const notified = new Promise<{ id: string }>((done) => live.once('reader:purged', done));
  const revoked = new Promise<void>((done) => old.once('disconnect', () => done()));
  await f.service.purgeReaderData(f.old.id);
  assert.equal((await notified).id, f.old.id);
  await revoked;
  assert.equal((await f.request('/api/teahouse/session', 'old')).status, 401);
  assert.equal((await f.request(attachment.url)).status, 404);
  await assert.rejects(access(join(f.directory, 'images', `${attachment.id}.webp`)));
  const history = await (await f.request('/api/teahouse/messages')).json();
  const removed = history.messages.find((message: TeahouseMessage) => message.id === own.id);
  assert.equal(removed.withdrawn, true);
  assert.equal(removed.text, undefined);
  assert.equal(removed.author.name, '已注销用户');
  assert.equal(history.messages.find((message: TeahouseMessage) => message.id === kept.id).text, '保持正常');
  assert.equal((await (await f.request('/api/teahouse/announcements')).json()).announcements.length, 0);
  assert.equal(f.service.store.pendingFileDeletions().length, 0);
});

test('physical cleanup failure rejects purge confirmation and succeeds safely on retry', async (t) => {
  const f = await fixture(t);
  const image = await f.attachment();
  f.service.store.sendMessage(f.old, { id: randomUUID(), text: '清理测试', attachmentIds: [image.id] });
  const path = join(f.directory, 'images', `${image.id}.webp`);
  await rm(path); await mkdir(path);
  await assert.rejects(f.service.purgeReaderData(f.old.id), /cleanup|清理/i);
  assert.equal(f.service.store.readerDeleted(f.old.id), true);
  assert.deepEqual(f.service.store.pendingFileDeletions(), [image.id]);
  assert.equal((await f.request(image.url)).status, 404);
  await rmdir(path);
  await writeFile(path, Buffer.from('image'));
  await f.service.purgeReaderData(f.old.id);
  assert.deepEqual(f.service.store.pendingFileDeletions(), []);
  await assert.rejects(access(path));
});

test('cleanup queue never removes an attachment that is still registered', async (t) => {
  const f = await fixture(t);
  const image = await f.attachment(f.live);
  const db = new DatabaseSync(join(f.directory, 'db', 'chat.sqlite'));
  try { db.prepare('INSERT INTO teahouse_file_deletions(id) VALUES(?)').run(image.id); }
  finally { db.close(); }
  await assert.rejects(f.service.purgeReaderData(f.old.id), /cleanup|清理/i);
  assert.equal((await readFile(join(f.directory, 'images', `${image.id}.webp`))).toString(), 'image');
  assert.deepEqual(f.service.store.pendingFileDeletions(), [image.id]);
});

test('only fresh successful user writes count as activity; reads, fanout and idempotent retries do not', async (t) => {
  const f = await fixture(t);
  const old = await f.connect('old'); await f.connect('live');
  await f.request('/api/teahouse/session'); await f.request('/api/teahouse/messages');
  const input = { id: randomUUID(), text: '活动记录测试' };
  assert.equal((await emit(old, 'message:send', input)).ok, true);
  assert.deepEqual(f.activities, ['old']);
  assert.equal((await emit(old, 'message:send', input)).ok, true);
  assert.deepEqual(f.activities, ['old']);
  assert.equal((await emit(old, 'message:withdraw', { id: input.id })).ok, true);
  assert.equal((await emit(old, 'message:withdraw', { id: input.id })).ok, true);
  assert.deepEqual(f.activities, ['old', 'old']);
  await new Promise<void>((done) => setTimeout(done, 100));
  await f.request('/api/teahouse/announcements');
  assert.deepEqual(f.activities, ['old', 'old']);
});

test('history waiting for profiles cannot reveal deleted account snapshots after cleanup', { timeout: 7000 }, async (t) => {
  const f = await fixture(t);
  const original = f.service.store.sendMessage(f.old, { id: randomUUID(), text: '清理前原文' });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(done => { release = done; });
  const started = new Promise<void>(done => { entered = done; });
  t.after(release);
  f.onAuthors(async () => { entered(); await waiting; });
  const pending = f.request('/api/teahouse/messages');
  await started;
  await f.service.purgeReaderData(f.old.id);
  release();
  const history = await (await pending).json();
  const current = history.messages.find((message: TeahouseMessage) => message.id === original.id);
  assert.equal(current.withdrawn, true);
  assert.equal(current.text, undefined);
  assert.equal(current.author.name, '已注销用户');
  assert.equal(current.author.avatarUrl, undefined);
});

test('attachment cleanup preserves files when the image directory is replaced by a junction', async (t) => {
  const f = await fixture(t);
  const attachment = await f.attachment();
  f.service.store.sendMessage(f.old, { id: randomUUID(), text: '清理测试', attachmentIds: [attachment.id] });
  const images = join(f.directory, 'images');
  await rename(images, join(f.directory, 'original-images'));
  const protectedDirectory = join(f.directory, 'protected');
  await mkdir(protectedDirectory);
  const protectedFile = join(protectedDirectory, `${attachment.id}.webp`);
  await writeFile(protectedFile, 'protected-data');
  await symlink(protectedDirectory, images, 'junction');
  await assert.rejects(f.service.purgeReaderData(f.old.id), /cleanup|清理/i);
  assert.equal((await readFile(protectedFile)).toString(), 'protected-data');
  assert.deepEqual(f.service.store.pendingFileDeletions(), [attachment.id]);
  assert.equal((await f.request(attachment.url)).status, 404);
});

test('startup and periodic cleanup failures emit sanitized retry events while foreground failures remain visible', { timeout: 7000 }, async (t) => {
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const imageId = randomUUID();
  const failureText = 'PRIVATE-SYNTHETIC-BODY-MUST-NOT-BE-LOGGED';
  const f = await fixture(t, directory => {
    const store = createTeahouseStore({ directory });
    store.registerAttachment({ kind: 'reader', id: 'expired-upload', name: '测试', role: null, vip: true }, { id: imageId, mime: 'image/webp', size: 5, width: 1, height: 1 });
    store.close();
    const db = new DatabaseSync(join(directory, 'db', 'chat.sqlite'));
    try {
      db.prepare('UPDATE teahouse_attachments SET created_at=0 WHERE id=?').run(imageId);
      db.exec(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON teahouse_attachments BEGIN SELECT RAISE(ABORT,'${failureText}'); END`);
    } finally { db.close(); }
  });
  const db = new DatabaseSync(join(f.directory, 'db', 'chat.sqlite'));
  try {
    for (let attempt = 0; logs.length < 2 && attempt < 30; attempt++) await new Promise<void>(done => setTimeout(done, 20));
    assert.ok(logs.length >= 2, 'startup and interval both record a retry event');
    for (const line of logs) {
      const record = JSON.parse(line);
      assert.equal(record.event, 'teahouse-background-retry');
      assert.equal(record.operation, 'cleanup');
      assert.equal(line.includes(failureText), false);
      assert.deepEqual(Object.keys(record).sort(), ['at', 'event', 'operation']);
    }
    const socket = await f.connect('old');
    const message = f.service.store.sendMessage(f.old, { id: randomUUID(), text: '前台撤回错误测试' });
    const response = await emit(socket, 'message:withdraw', { id: message.id });
    assert.equal(response.ok, false, 'foreground withdrawal does not hide maintenance failure');
    await assert.rejects(f.service.purgeReaderData(f.old.id), new RegExp(failureText));
    db.exec('DROP TRIGGER fail_cleanup');
    for (let attempt = 0; f.service.store.attachmentRegistered(imageId) && attempt < 30; attempt++) await new Promise<void>(done => setTimeout(done, 20));
    assert.equal(f.service.store.attachmentRegistered(imageId), false, 'next interval retries successfully');
    assert.equal((await f.request('/api/teahouse/messages')).status, 200, 'service remains available');
  } finally { db.exec('DROP TRIGGER IF EXISTS fail_cleanup'); db.close(); }
});

test('shutdown closes the database after cleanup failure and repeated close shares the same result', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'teahouse-close-'));
  const server = createServer();
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  const service = createTeahouseService({ server, directory, origin: 'http://127.0.0.1:49999', identify: async () => null, accessCheckMs: 60_000 });
  t.after(async () => {
    await service.close().catch(() => {});
    service.store.close();
    await new Promise<void>(done => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>(done => setImmediate(done)); // Let startup maintenance finish before injecting a shutdown-only failure.
  const failureText = 'PRIVATE-SHUTDOWN-DETAIL-MUST-NOT-BE-LOGGED';
  t.mock.method(service.store, 'pruneUnboundAttachments', () => { throw Error(failureText); });
  const first = service.close();
  const second = service.close();
  assert.equal(first, second, 'repeated close returns the exact same promise');
  await assert.rejects(first, new RegExp(failureText));
  assert.throws(() => service.store.readMessages({ kind: 'reader', id: 'after-close', name: '测试', role: null, vip: true }), /not open|closed/i);
  assert.equal(logs.join('').includes(failureText), false);
});

test('a host identity-view change disconnects only sockets whose handshake request matches', async (t) => {
  const f = await fixture(t);
  const first = await f.connect('old'), second = await f.connect('old'), untouched = await f.connect('live');
  const revoked = [first, second].map(socket => new Promise<{ error: string; reason?: string }>(done => socket.once('access:revoked', done)));
  const disconnected = [first, second].map(socket => new Promise<void>(done => socket.once('disconnect', () => done())));
  assert.equal(f.service.disconnectRequests(req => req.headers.cookie === 'session=old'), undefined);
  for (const event of await Promise.all(revoked)) assert.deepEqual(event, { error: '登录身份已变化，请重新进入。', reason: 'identity-changed' });
  await Promise.all(disconnected);
  assert.equal(untouched.connected, true);
  assert.equal((await emit(untouched, 'message:send', { id: randomUUID(), text: '其他会员正常发言' })).ok, true);
  assert.deepEqual(f.activities, ['live']);
  assert.equal(f.service.store.readerDeleted(f.old.id), false, 'view changes must not delete an account or its history');
});
