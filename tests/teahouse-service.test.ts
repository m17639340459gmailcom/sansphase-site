import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { io, type Socket } from "socket.io-client";
import { createTeahouseService } from "../server/teahouse-service.ts";
import type { TeahouseActor, TeahouseMessage } from "../src/teahouse-types.ts";

type Ack<T> =
  { ok: true; data: T } | { ok: false; error: string; status: number };
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "tea-service-"));
  const actors = new Map<string, TeahouseActor>([
    ["vip", { kind: "reader", id: "vip", name: "会员", role: null, vip: true }],
    [
      "guest",
      { kind: "reader", id: "guest", name: "普通读者", role: null, vip: false },
    ],
    [
      "manager",
      {
        kind: "reader",
        id: "manager",
        name: "版主",
        role: "moderator",
        vip: false,
      },
    ],
    [
      "assistant",
      {
        kind: "reader",
        id: "assistant",
        name: "VIP 协管",
        role: "assistant",
        vip: true,
      },
    ],
  ]);
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
  if (!address || typeof address === "string") throw Error("address");
  const origin = `http://127.0.0.1:${address.port}`;
  const service = createTeahouseService({
    server,
    directory,
    origin,
    identify: async (req) =>
      actors.get(String(req.headers.cookie || "").replace("session=", "")) ??
      null,
    accessCheckMs: 40,
  });
  const sockets: Socket[] = [];
  t.after(async () => {
    sockets.forEach((s) => s.disconnect());
    await service.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  async function connect(key: string, customOrigin = origin) {
    const socket = io(origin, {
      path: "/api/teahouse/socket.io",
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Cookie: `session=${key}`, Origin: customOrigin },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }
  const request = (path: string, key = "vip", init: RequestInit = {}) =>
    fetch(origin + path, {
      ...init,
      headers: {
        Cookie: `session=${key}`,
        Origin: origin,
        "X-Reader-Request": "1",
        ...init.headers,
      },
    });
  return { actors, connect, request, origin, directory, service };
}
const emit = <T>(socket: Socket, event: string, data: unknown) =>
  socket.timeout(3000).emitWithAck(event, data) as Promise<Ack<T>>;

test("茶室入口校验会话、VIP和真实来源，管理例外不包含普通用户", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request("/api/teahouse/session", "missing")).status,
    401,
  );
  assert.equal(
    (await f.request("/api/teahouse/messages", "guest")).status,
    403,
  );
  assert.equal(
    (await f.request("/api/teahouse/session", "manager")).status,
    200,
  );
  await assert.rejects(f.connect("guest"));
  await assert.rejects(f.connect("vip", "https://untrusted.invalid"));
});
test("实时消息只持久保存一次，撤回同步并在补拉中清空原文", async (t) => {
  const f = await fixture(t),
    a = await f.connect("vip"),
    b = await f.connect("manager");
  const input = { id: randomUUID(), text: "测试消息 " + randomUUID() };
  const received = new Promise<TeahouseMessage>((resolve) =>
    b.once("message:changed", resolve),
  );
  const ack = await emit<TeahouseMessage>(a, "message:send", input);
  assert.equal(ack.ok, true);
  const message = await received;
  assert.equal(message.text, input.text);
  assert.equal((await emit(a, "message:send", input)).ok, true);
  const history = await (await f.request("/api/teahouse/messages")).json();
  assert.equal(history.messages.length, 1);
  assert.equal((await emit(b, "message:withdraw", { id: input.id })).ok, true);
  const replay = await (
    await f.request(`/api/teahouse/messages?after=${message.revisionSeq}`)
  ).json();
  assert.equal(replay.messages[0].withdrawn, true);
  assert.equal(replay.messages[0].text, undefined);
  assert.equal(
    (await readFile(join(f.directory, "db", "chat.sqlite"))).includes(
      Buffer.from(input.text),
    ),
    false,
  );
});
test("VIP到期后写入与后续广播都被拦截", async (t) => {
  const f = await fixture(t),
    a = await f.connect("vip"),
    b = await f.connect("manager");
  let leaked = false;
  a.on("message:changed", () => {
    leaked = true;
  });
  f.actors.set("vip", { ...f.actors.get("vip")!, vip: false });
  await emit(b, "message:send", { id: randomUUID(), text: "会员限定" });
  assert.equal(leaked, false);
  assert.equal((await f.request("/api/teahouse/messages")).status, 403);
});
test("有效 VIP 协管仅享有普通会员聊天权限，VIP 失效后不能继续连接或收取消息", { timeout: 7000 }, async (t) => {
  const f = await fixture(t),
    assistant = await f.connect("assistant"),
    other = await f.connect("vip");
  assert.equal((await f.request("/api/teahouse/session", "assistant")).status, 200);
  const ownId = randomUUID();
  const sent = await emit<TeahouseMessage>(assistant, "message:send", {
    id: ownId,
    text: "协管以普通 VIP 成员身份交流",
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.data.author.id, "assistant");
  assert.ok(Date.now() - Date.parse(sent.data.createdAt) < 5 * 60_000);
  const recalled = await emit<TeahouseMessage>(assistant, "message:withdraw", { id: ownId });
  assert.equal(recalled.ok, true);
  if (recalled.ok) {
    assert.equal(recalled.data.withdrawn, true);
    assert.equal(recalled.data.text, undefined);
  }

  const otherId = randomUUID();
  assert.equal((await emit(other, "message:send", { id: otherId, text: "另一位成员的消息" })).ok, true);
  const deniedRecall = await emit(assistant, "message:withdraw", { id: otherId });
  assert.equal(deniedRecall.ok, false);
  if (!deniedRecall.ok) assert.equal(deniedRecall.status, 403);
  const deniedAnnouncement = await emit(assistant, "announcement:save", {
    title: "协管不能发布公告",
    text: "即使有 VIP 也不会获得公告管理权限",
  });
  assert.equal(deniedAnnouncement.ok, false);
  if (!deniedAnnouncement.ok) assert.equal(deniedAnnouncement.status, 403);
  const history = await (await f.request("/api/teahouse/messages", "assistant")).json();
  assert.equal(history.messages.find((message: TeahouseMessage) => message.id === otherId)?.withdrawn, false);
  assert.deepEqual((await (await f.request("/api/teahouse/announcements", "assistant")).json()).announcements, []);

  let receivedAfterExpiry = false;
  assistant.on("message:changed", () => { receivedAfterExpiry = true; });
  const disconnected = new Promise<void>(resolve => assistant.once("disconnect", () => resolve()));
  f.actors.set("assistant", { ...f.actors.get("assistant")!, vip: false });
  assert.equal((await emit(other, "message:send", { id: randomUUID(), text: "VIP 到期后的私有消息" })).ok, true);
  await disconnected;
  assert.equal(receivedAfterExpiry, false);
  assert.equal((await f.request("/api/teahouse/messages", "assistant")).status, 403);
  await assert.rejects(f.connect("assistant"));
});
test("公告权限由服务端决定，不接受客户端伪造身份", async (t) => {
  const f = await fixture(t),
    a = await f.connect("vip"),
    b = await f.connect("manager");
  const denied = await emit(a, "announcement:save", {
    title: "伪造",
    text: "不应发布",
    role: "owner",
  });
  assert.equal(denied.ok, false);
  assert.equal(
    (
      await emit(b, "announcement:save", {
        title: "正式公告",
        text: "公告正文",
        pinned: true,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await (await f.request("/api/teahouse/announcements")).json())
      .announcements.length,
    1,
  );
});
test("上传压缩、私有图片授权及撤回后的文件清理", async (t) => {
  const f = await fixture(t);
  const a = await f.connect("vip");
  const raw = await sharp({
    create: { width: 30, height: 30, channels: 3, background: "#aabbcc" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(raw)], { type: "image/png" }),
    "test.png",
  );
  const response = await f.request("/api/teahouse/attachments", "vip", {
    method: "POST",
    body: form,
  });
  assert.equal(response.status, 201);
  const attachment = await response.json();
  assert.ok(attachment.size <= 2 * 1024 * 1024);
  assert.equal(
    (await f.request(attachment.url, "manager")).status,
    404,
    "未发布图片仅本人可读",
  );
  const id = randomUUID();
  assert.equal(
    (
      await emit(a, "message:send", {
        id,
        text: "图片",
        attachmentIds: [attachment.id],
      })
    ).ok,
    true,
  );
  assert.equal((await f.request(attachment.url, "manager")).status, 200);
  assert.equal((await f.request(attachment.url, "guest")).status, 403);
  assert.equal((await emit(a, "message:withdraw", { id })).ok, true);
  assert.equal((await f.request(attachment.url)).status, 404);
  assert.equal((await readdir(join(f.directory, "images"))).length, 0);
});
