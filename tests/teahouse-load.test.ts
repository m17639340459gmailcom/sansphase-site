import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { createTeahouseService } from '../server/teahouse-service.ts';
import type { TeahouseActor, TeahouseHistory, TeahouseMessage } from '../src/teahouse-types.ts';

type Reply<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
const deadline = 10_000; // Test deadlock guard, not a production latency objective.

test('12 local clients receive concurrent messages once and replay withdrawals after reconnect', { timeout: 30_000 }, async (t) => {
  const started = performance.now();
  const directory = await mkdtemp(join(tmpdir(), 'teahouse-load-'));
  const actors = new Map<string, TeahouseActor>();
  for (let i = 0; i < 12; i++) {
    actors.set(String(i), { kind: 'reader', id: `load-${i}`, name: `测试会员${i}`, role: null, vip: true });
  }
  const server = createServer((req, res) => {
    void service.handle(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end(); }
    }).catch(() => { res.destroy(); });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const service = createTeahouseService({
    server, directory, origin, accessCheckMs: 1000,
    identify: async (req) => actors.get(String(req.headers.cookie ?? '').replace('session=', '')) ?? null,
  });
  const sockets: Socket[] = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await service.close();
    await new Promise<void>((done) => server.close(() => done()));
    const insideTemp = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(insideTemp.startsWith('teahouse-load-') && !insideTemp.includes('..'), 'cleanup stays within its generated test directory');
    await rm(directory, { recursive: true, force: true });
  });

  async function history(key: string, query = ''): Promise<TeahouseHistory> {
    const response = await fetch(`${origin}/api/teahouse/messages${query}`, {
      headers: { Cookie: `session=${key}`, Origin: origin }, signal: AbortSignal.timeout(deadline),
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<TeahouseHistory>;
  }
  async function connect(key: string): Promise<Socket> {
    const socket = io(origin, {
      path: '/api/teahouse/socket.io', transports: ['websocket'], reconnection: false,
      extraHeaders: { Cookie: `session=${key}`, Origin: origin },
      autoConnect: false, timeout: deadline,
    });
    sockets.push(socket);
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(Error('local connection exceeded test deadline')), deadline);
      socket.once('connect', () => { clearTimeout(timer); done(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
      socket.connect();
    });
    return socket;
  }
  const ackTimes: number[] = [];
  async function emit(socket: Socket, event: string, data: unknown): Promise<TeahouseMessage> {
    const before = performance.now();
    const reply = await socket.timeout(deadline).emitWithAck(event, data) as Reply<TeahouseMessage>;
    ackTimes.push(performance.now() - before);
    assert.equal(reply.ok, true, 'synthetic message operation must succeed');
    if (!reply.ok) throw Error(`synthetic operation returned ${reply.status}`);
    return reply.data;
  }

  // Seed more than a page in this isolated store without consuming the two
  // live senders' rate windows. No seed payload is logged or sent to production.
  for (let i = 0; i < 55; i++) {
    const actor: TeahouseActor = { kind: 'reader', id: `seed-${Math.floor(i / 19)}`, name: '历史测试会员', role: null, vip: true };
    service.store.sendMessage(actor, { id: randomUUID(), text: `本地历史 ${i}` });
  }
  const initial = await history('11');
  assert.equal(initial.messages.length, 50);
  assert.equal(initial.hasMore, true);
  const earlier = await history('11', `?before=${initial.messages[0].seq}`);
  assert.equal(earlier.messages.length, 5);
  assert.equal(earlier.hasMore, false);

  const clients = await Promise.all(Array.from({ length: 12 }, (_, i) => connect(String(i))));
  const streams = clients.map(() => new Map<string, TeahouseMessage[]>());
  const waiters = new Set<() => void>();
  clients.forEach((socket, index) => socket.on('message:changed', (message: TeahouseMessage) => {
    const existing = streams[index].get(message.id) ?? [];
    existing.push(message);
    streams[index].set(message.id, existing);
    for (const wake of waiters) wake();
  }));
  async function until(condition: () => boolean): Promise<void> {
    if (condition()) return;
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => { waiters.delete(check); reject(Error('local fanout exceeded test deadline')); }, deadline);
      const check = () => { if (condition()) { clearTimeout(timer); waiters.delete(check); done(); } };
      waiters.add(check);
      check();
    });
  }

  const sendStarted = performance.now();
  const batches = await Promise.all([0, 1].map(async (speaker) => {
    const messages: TeahouseMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(await emit(clients[speaker], 'message:send', { id: randomUUID(), text: `本地并发 ${speaker}:${i}` }));
    }
    return messages;
  }));
  const sent = batches.flat();
  await until(() => streams.every((stream) => sent.every((message) => stream.has(message.id))));
  const sendElapsed = performance.now() - sendStarted;
  for (const stream of streams) {
    assert.equal(stream.size, 20);
    for (const message of sent) assert.equal(stream.get(message.id)?.length, 1, 'one creation broadcast per unique message');
  }

  // Retrying an acknowledged send must not create another broadcast. Later
  // events below serve as a network barrier before checking event counts again.
  await emit(clients[0], 'message:send', { id: batches[0][1].id, text: '本地重试' });
  const beforeOffline = await history('11');
  clients[11].disconnect();
  const missed = await emit(clients[1], 'message:send', { id: randomUUID(), text: '离线期间测试一' });
  const missedAndRemoved = await emit(clients[1], 'message:send', { id: randomUUID(), text: '离线期间测试二' });
  const removedEarlier = batches[0][0];
  await emit(clients[0], 'message:withdraw', { id: removedEarlier.id });
  await emit(clients[1], 'message:withdraw', { id: missedAndRemoved.id });
  await until(() => streams.slice(0, 11).every((stream) => stream.get(missedAndRemoved.id)?.at(-1)?.withdrawn === true));
  for (const stream of streams) assert.equal(stream.get(batches[0][1].id)?.length, 1, 'idempotent retry does not fan out again');
  assert.equal(streams[11].has(missed.id), false);
  assert.equal(streams[11].get(removedEarlier.id)?.at(-1)?.withdrawn, false);

  await connect('11');
  let cursor = beforeOffline.cursor;
  const replayed: TeahouseMessage[] = [];
  for (let page = 0; page < 10; page++) {
    const result = await history('11', `?after=${cursor}&limit=1`);
    assert.ok(result.messages.length <= 1);
    assert.ok(result.cursor >= cursor);
    replayed.push(...result.messages);
    cursor = result.cursor;
    if (!result.hasMore) break;
    assert.ok(page < 9, 'replay must finish within the known synthetic event count');
  }
  assert.equal(replayed.length, 3);
  const merged = new Map(beforeOffline.messages.map((message) => [message.id, message]));
  for (const message of replayed) merged.set(message.id, message);
  assert.equal(merged.get(missed.id)?.withdrawn, false);
  for (const message of [removedEarlier, missedAndRemoved]) {
    const current = merged.get(message.id)!;
    assert.equal(current.withdrawn, true);
    assert.equal(current.text, undefined);
    assert.deepEqual(current.attachments, []);
  }
  assert.equal((await history('11', `?after=${cursor}`)).messages.length, 0);
  assert.ok(ackTimes.every((ms) => ms < deadline));
  t.diagnostic(`Local only: 12 connections; 20 concurrent-stream messages delivered once; send phase ${Math.round(sendElapsed)} ms; max ACK ${Math.round(Math.max(...ackTimes))} ms; scenario ${Math.round(performance.now() - started)} ms. Timing is not a production capacity or latency guarantee.`);
});
