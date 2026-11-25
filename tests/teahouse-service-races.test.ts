import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import sharp from "sharp";
import { createTeahouseService } from "../server/teahouse-service.ts";
import type {
  TeahouseActor,
  TeahouseAuthor,
  TeahouseMessage,
  TeahouseAnnouncement,
} from "../src/teahouse-types.ts";

type Ack<T> =
  { ok: true; data: T } | { ok: false; error: string; status: number };
function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    async wait() {
      enter();
      await waiting;
    },
  };
}
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "tea-races-"));
  const actors = new Map<string, TeahouseActor>([
    [
      "vip",
      {
        kind: "reader",
        id: "vip",
        name: "会员旧昵称",
        role: null,
        vip: true,
        icon: "vip:1",
      },
    ],
    [
      "manager",
      {
        kind: "reader",
        id: "manager",
        name: "版主",
        role: "moderator",
        vip: false,
        icon: "staff:moderator",
      },
    ],
    [
      "other",
      {
        kind: "reader",
        id: "other",
        name: "另一位会员",
        role: null,
        vip: true,
        icon: "vip:1",
      },
    ],
  ]);
  let onIdentify: ((req: IncomingMessage) => Promise<void>) | undefined;
  let onAuthors:
    | ((
        req: IncomingMessage,
        authors: readonly TeahouseAuthor[],
      ) => Promise<void>)
    | undefined;
  let service: ReturnType<typeof createTeahouseService>;
  const server = createServer((req, res) => {
    void service.handle(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  service = createTeahouseService({
    server,
    directory,
    origin,
    accessCheckMs: 60_000,
    identify: async (req) => {
      await onIdentify?.(req);
      const actor = actors.get(
        String(req.headers.cookie || "").replace("session=", ""),
      );
      return actor ? { ...actor } : null;
    },
    authors: async (req, authors) => {
      await onAuthors?.(req, authors);
      return authors.map((author) => {
        const current = actors.get(author.id);
        return current
          ? {
              kind: current.kind,
              id: current.id,
              name: current.name,
              ...(current.avatarUrl ? { avatarUrl: current.avatarUrl } : {}),
              icon: current.icon ?? null,
            }
          : { ...author, name: "已注销用户", icon: null };
      });
    },
  });
  const sockets: Socket[] = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await service.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  async function connect(who = "vip") {
    const socket = io(origin, {
      path: "/api/teahouse/socket.io",
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Cookie: `session=${who}`, Origin: origin },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  return {
    service,
    directory,
    actors,
    connect,
    request: (path: string, who = "vip") =>
      fetch(origin + path, {
        headers: { Cookie: `session=${who}`, Origin: origin },
      }),
    onIdentify(hook?: (req: IncomingMessage) => Promise<void>) {
      onIdentify = hook;
    },
    onAuthors(
      hook?: (
        req: IncomingMessage,
        authors: readonly TeahouseAuthor[],
      ) => Promise<void>,
    ) {
      onAuthors = hook;
    },
  };
}
const emit = <T>(socket: Socket, event: string, payload: unknown) =>
  socket.timeout(4000).emitWithAck(event, payload) as Promise<Ack<T>>;

function event<T>(socket: Socket, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off(name, receive); reject(Error(`Missing ${name} event`)); }, 4000);
    const receive = (value: T) => { clearTimeout(timeout); resolve(value); };
    socket.once(name, receive);
  });
}

test('sender acknowledgement does not wait for a paused recipient and delayed delivery re-reads withdrawals', { timeout: 7000 }, async (t) => {
  const f = await fixture(t), sender = await f.connect(), receiver = await f.connect('other');
  const paused = gate();
  f.onIdentify(async req => { if (req.headers.cookie === 'session=other') await paused.wait(); });
  const delivered = event<TeahouseMessage>(receiver, 'message:changed');
  try {
    const id = randomUUID();
    const pending = emit<TeahouseMessage>(sender, 'message:send', { id, text: '接收者暂时等待时发送' });
    await paused.entered;
    const ack = await Promise.race([pending, new Promise<never>((_, reject) => {
      const timeout = setTimeout(() => reject(Error('ACK is waiting for the paused recipient')), 700); timeout.unref();
    })]);
    assert.equal(ack.ok, true);
    f.service.store.withdrawMessage(f.actors.get('manager')!, id);
    paused.release();
    const current = await delivered;
    assert.equal(current.id, id);
    assert.equal(current.withdrawn, true);
    assert.equal(current.text, undefined);
  } finally { paused.release(); await delivered.catch(() => {}); }
});

test('bounded pending changes request cursor replay on overflow without blocking new acknowledgements', { timeout: 12000 }, async (t) => {
  const f = await fixture(t), receiver = await f.connect('other');
  const senders: Socket[] = [];
  for (let index = 0; index < 4; index++) {
    const who = `speaker-${index}`;
    f.actors.set(who, { kind: 'reader', id: who, name: '测试发言人', role: null, vip: true });
    senders.push(await f.connect(who));
  }
  const paused = gate(), batches: number[] = [];
  f.onIdentify(async req => { if (req.headers.cookie === 'session=other') await paused.wait(); });
  f.onAuthors(async (_req, authors) => { batches.push(authors.length); });
  const replayHint = event<void>(receiver, 'history:sync');
  const ids: string[] = [];
  try {
    for (let index = 0; index < 70; index++) {
      const id = randomUUID(); ids.push(id);
      const ack = await emit<TeahouseMessage>(senders[index % senders.length], 'message:send', { id, text: `有界发送 ${index}` });
      assert.equal(ack.ok, true);
      if (index === 0) await paused.entered;
    }
    f.service.store.withdrawMessage(f.actors.get('manager')!, ids[10]);
    paused.release();
    await replayHint;
    assert.ok(batches.every(size => size <= 64), 'background profile batches remain bounded');
    const history = await (await f.request('/api/teahouse/messages?after=0&limit=100', 'other')).json();
    assert.equal(history.messages.length, 70);
    const removed = history.messages.find((message: TeahouseMessage) => message.id === ids[10]);
    assert.equal(removed.withdrawn, true);
    assert.equal(removed.text, undefined);
  } finally { paused.release(); await replayHint.catch(() => {}); }
});

test('background profile failure leaves successful persistence recoverable by an online cursor replay hint', { timeout: 7000 }, async (t) => {
  const f = await fixture(t), sender = await f.connect(), receiver = await f.connect('other');
  const logs: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; });
  let lookups = 0;
  f.onAuthors(async () => { if (++lookups === 2) throw Error('PRIVATE-BODY-SHOULD-NOT-LOG'); });
  const replayHint = event<void>(receiver, 'history:sync');
  const id = randomUUID();
  const ack = await emit<TeahouseMessage>(sender, 'message:send', { id, text: '资料桥失败不会遗失已保存消息' });
  assert.equal(ack.ok, true);
  await replayHint;
  const history = await (await f.request('/api/teahouse/messages?after=0', 'other')).json();
  assert.equal(history.messages[0].id, id);
  assert.ok(logs.some(line => line.includes('"operation":"changes"')));
  assert.ok(logs.every(line => !line.includes('PRIVATE-BODY-SHOULD-NOT-LOG')));
});

test('temporary recipient authorization failures close the transport without permanently revoking membership', { timeout: 7000 }, async (t) => {
  const f = await fixture(t), sender = await f.connect(), receiver = await f.connect('other');
  let revoked = false, leaked = false;
  receiver.on('access:revoked', () => { revoked = true; });
  receiver.on('message:changed', () => { leaked = true; });
  const disconnected = event<string>(receiver, 'disconnect');
  f.onIdentify(async req => { if (req.headers.cookie === 'session=other') throw Object.assign(Error('synthetic bridge unavailable'), { status: 503 }); });
  const id = randomUUID();
  assert.equal((await emit(sender, 'message:send', { id, text: '临时鉴权故障后补拉' })).ok, true);
  assert.notEqual(await disconnected, 'io server disconnect', 'a transport close allows Socket.IO to reconnect');
  assert.equal(revoked, false);
  assert.equal(leaked, false);
  f.onIdentify();
  await f.connect('other');
  const history = await (await f.request('/api/teahouse/messages?after=0', 'other')).json();
  assert.equal(history.messages[0].id, id);
});

test('a sender losing access during the final authority check receives no successful acknowledgement', { timeout: 7000 }, async (t) => {
  const f = await fixture(t), sender = await f.connect(), receiver = await f.connect('other');
  const id = randomUUID(), paused = gate(), replies: Ack<TeahouseMessage>[] = [];
  f.onIdentify(async req => {
    if (req.headers.cookie === 'session=vip' && f.service.store.getMessage(f.actors.get('manager')!, id)) await paused.wait();
  });
  const revoked = event<{ error: string }>(sender, 'access:revoked');
  sender.emit('message:send', { id, text: '最终身份检查期间过期' }, (reply: Ack<TeahouseMessage>) => { replies.push(reply); });
  try {
    await paused.entered;
    f.actors.set('vip', { ...f.actors.get('vip')!, vip: false });
    paused.release();
    await revoked;
    assert.ok(replies.every(reply => !reply.ok));
    assert.equal(receiver.connected, true);
  } finally { paused.release(); }
});

test(
  "history hydration cannot return text or attachments withdrawn while author profiles are loading",
  { timeout: 7000 },
  async (t) => {
    const f = await fixture(t),
      actor = f.actors.get("vip")!,
      manager = f.actors.get("manager")!;
    const message = f.service.store.sendMessage(actor, {
      id: randomUUID(),
      text: "必须彻底撤回的原文",
    });
    const paused = gate();
    f.onAuthors(async () => {
      f.onAuthors();
      await paused.wait();
    });
    const pending = f.request("/api/teahouse/messages");
    await paused.entered;
    f.service.store.withdrawMessage(manager, message.id);
    paused.release();
    const response = await pending;
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.messages[0].withdrawn, true);
    assert.equal(result.messages[0].text, undefined);
    assert.deepEqual(result.messages[0].attachments, []);
  },
);

test(
  "broadcast and send acknowledgement re-read a message withdrawn during profile lookup",
  { timeout: 7000 },
  async (t) => {
    const f = await fixture(t),
      socket = await f.connect(),
      messages: TeahouseMessage[] = [];
    socket.on("message:changed", (message: TeahouseMessage) =>
      messages.push(message),
    );
    const paused = gate();
    f.onAuthors(async () => {
      f.onAuthors();
      await paused.wait();
    });
    const id = randomUUID(),
      pending = emit<TeahouseMessage>(socket, "message:send", {
        id,
        text: "等待期间撤回",
      });
    await paused.entered;
    f.service.store.withdrawMessage(f.actors.get("manager")!, id);
    paused.release();
    const ack = await pending;
    assert.equal(ack.ok, true);
    if (!ack.ok) return;
    assert.equal(ack.data.withdrawn, true);
    assert.equal(ack.data.text, undefined);
    assert.ok(messages.length > 0);
    assert.ok(
      messages.every(
        (message) => message.withdrawn && message.text === undefined,
      ),
    );
  },
);

test(
  "announcement history cannot resurrect an announcement deleted during profile hydration",
  { timeout: 7000 },
  async (t) => {
    const f = await fixture(t),
      manager = f.actors.get("manager")!;
    const notice = f.service.store.saveAnnouncement(manager, {
      title: "即将删除",
      text: "删除后不可见",
    });
    const paused = gate();
    f.onAuthors(async () => {
      f.onAuthors();
      await paused.wait();
    });
    const pending = f.request("/api/teahouse/announcements");
    await paused.entered;
    f.service.store.deleteAnnouncement(manager, notice.id, notice.revision);
    paused.release();
    assert.deepEqual((await (await pending).json()).announcements, []);
  },
);

test(
  "save acknowledgement does not return an announcement deleted while its broadcast is awaiting profiles",
  { timeout: 7000 },
  async (t) => {
    const f = await fixture(t),
      socket = await f.connect("manager"),
      manager = f.actors.get("manager")!;
    const paused = gate();
    f.onAuthors(async () => {
      f.onAuthors();
      await paused.wait();
    });
    const pending = emit<TeahouseAnnouncement>(socket, "announcement:save", {
      title: "即将删除",
      text: "不能从旧回执复活",
    });
    await paused.entered;
    const notice = f.service.store.listAnnouncements(manager)[0];
    f.service.store.deleteAnnouncement(manager, notice.id, notice.revision);
    paused.release();
    const ack = await pending;
    assert.equal(ack.ok, false);
    if (ack.ok) return;
    assert.equal(ack.status, 409);
  },
);

test(
  "private image delivery rechecks VIP after reading the file",
  { timeout: 7000 },
  async (t) => {
    const f = await fixture(t),
      actor = f.actors.get("vip")!;
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#000000" },
    })
      .webp()
      .toBuffer();
    await mkdir(join(f.directory, "images"));
    const id = randomUUID();
    const image = f.service.store.registerAttachment(actor, {
      id,
      mime: "image/webp",
      size: bytes.length,
      width: 2,
      height: 2,
    });
    await writeFile(join(f.directory, "images", `${id}.webp`), bytes);
    const paused = gate();
    let checks = 0;
    f.onIdentify(async (req) => {
      if (req.url === image.url && ++checks === 2) await paused.wait();
    });
    const pending = f.request(image.url);
    await paused.entered;
    f.actors.set("vip", { ...actor, vip: false });
    paused.release();
    const response = await pending;
    assert.equal(response.status, 403);
    assert.match(response.headers.get("content-type")!, /json/);
  },
);

test(
  "send acknowledgement and broadcast agree on the current nickname and icon after hydration",
  { timeout: 7000 },
  async (t) => {
    const f = await fixture(t),
      socket = await f.connect(),
      messages: TeahouseMessage[] = [];
    socket.on("message:changed", (message: TeahouseMessage) =>
      messages.push(message),
    );
    f.onAuthors(async () => {
      f.onAuthors();
      f.actors.set("vip", {
        ...f.actors.get("vip")!,
        name: "新审核昵称",
        icon: null,
      });
    });
    const ack = await emit<TeahouseMessage>(socket, "message:send", {
      id: randomUUID(),
      text: "更新资料同时发送",
    });
    assert.equal(ack.ok, true);
    if (!ack.ok) return;
    assert.equal(messages.at(-1)?.author.name, "新审核昵称");
    assert.equal(messages.at(-1)?.author.icon, null);
    assert.equal(ack.data.author.name, "新审核昵称");
    assert.equal(ack.data.author.icon, null);
  },
);

test(
  "announcements added during hydration cannot fall back to stale author snapshots",
  { timeout: 7000 },
  async (t) => {
    const f = await fixture(t),
      manager = f.actors.get("manager")!;
    f.service.store.saveAnnouncement(manager, {
      title: "原有公告",
      text: "第一条公告",
    });
    const paused = gate();
    f.onAuthors(async () => {
      f.onAuthors();
      await paused.wait();
    });
    const pending = f.request("/api/teahouse/announcements");
    await paused.entered;
    const other = { ...f.actors.get("other")!, role: "moderator" as const };
    const added = f.service.store.saveAnnouncement(other, {
      title: "读取期间新增",
      text: "第二条公告",
    });
    f.actors.set("other", { ...other, name: "刚审核的新昵称", icon: null });
    paused.release();
    const response = await pending;
    assert.equal(response.status, 200);
    const notices: TeahouseAnnouncement[] = (await response.json())
      .announcements;
    const returned = notices.find((notice) => notice.id === added.id);
    // Returning the initial consistent list is valid; newly included rows must
    // hydrate their author too, rather than trusting their stored old snapshot.
    if (returned) {
      assert.equal(returned.author.name, "刚审核的新昵称");
      assert.equal(returned.author.icon, null);
    }
  },
);
