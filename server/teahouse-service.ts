import type {
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from "node:http";
import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { LRUCache } from "lru-cache";
import sharp from "sharp";
import { createTeahouseStore } from "./teahouse-store.ts";
import { withStreamUpload } from "./stream-upload.ts";
import { compressCommunityUpload } from "./community-upload-compression.ts";
import { fail } from "./community-db.ts";
import { canEnterTeahouse } from "../src/teahouse-types.ts";
import type {
  TeahouseActor,
  TeahouseAuthor,
  TeahouseMessage,
  TeahouseAnnouncement,
  TeahouseSendInput,
  TeahouseAnnouncementInput,
} from "../src/teahouse-types.ts";

type Reply<T> =
  { ok: true; data: T } | { ok: false; error: string; status: number };
type Ack<T> = (reply: Reply<T>) => void;
interface ClientEvents {
  "message:send": (input: unknown, ack: Ack<TeahouseMessage>) => void;
  "message:withdraw": (input: unknown, ack: Ack<TeahouseMessage>) => void;
  "announcement:save": (input: unknown, ack: Ack<TeahouseAnnouncement>) => void;
  "announcement:delete": (input: unknown, ack: Ack<{ ok: true }>) => void;
}
interface ServerEvents {
  "message:changed": (message: TeahouseMessage) => void;
  "announcements:changed": (input: {
    announcements: TeahouseAnnouncement[];
  }) => void;
  "members:changed": (input: { members: TeahouseActor[] }) => void;
  "access:revoked": (input: { error: string; reason?: "identity-changed" }) => void;
  "reader:purged": (input: { id: string }) => void;
  "history:sync": () => void;
}
interface SocketData {
  actor: TeahouseActor;
  pending: number;
}
type TeaSocket = Socket<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
type Options = {
  server: HttpServer;
  directory: string;
  origin: string;
  identify: (req: IncomingMessage) => Promise<TeahouseActor | null>;
  authors?: (
    req: IncomingMessage,
    authors: readonly TeahouseAuthor[],
  ) => Promise<TeahouseAuthor[]>;
  accessCheckMs?: number;
  requirePrepared?: boolean;
  onActivity?: (req: IncomingMessage) => void;
};
const key = (actor: TeahouseActor) => `${actor.kind}:${actor.id}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("请求内容无效。");
  return input as Record<string, unknown>;
}
function text(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum)
    throw fail("文字内容过长或格式无效。");
  return value;
}
function id(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value))
    throw fail("记录编号无效。");
  return value;
}
function number(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw fail("记录版本无效。");
  return value;
}
function fault(error: unknown) {
  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 503;
  return {
    status,
    error:
      status < 500 && error instanceof Error
        ? error.message
        : "茶室暂时不可用，请稍后重试。",
  };
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(JSON.stringify(data));
}

/** Real chat implementation. Identity comes from the existing authority, never a client role. */
export function createTeahouseService(options: Options) {
  const { server, directory, origin, identify } = options;
  const store = createTeahouseStore({ directory, requirePrepared: options.requirePrepared });
  const files = resolve(directory, "images");
  const budgets = new LRUCache<string, { start: number; count: number }>({
    max: 2000,
    ttl: 60_000,
  });
  let uploading = 0,
    closed = false,
    checking = false;
  const allowedOrigin = (req: IncomingMessage) =>
    req.headers.origin === origin && req.headers.host === new URL(origin).host;
  const allowedSocketOrigin = (req: IncomingMessage) =>
    req.headers.host === new URL(origin).host &&
    (req.headers.origin === origin ||
      (!req.headers.origin && req.headers["sec-fetch-site"] === "same-origin"));
  const io = new Server<
    ClientEvents,
    ServerEvents,
    Record<string, never>,
    SocketData
  >(server, {
    path: "/api/teahouse/socket.io",
    serveClient: false,
    maxHttpBufferSize: 32_768,
    cors: { origin, credentials: true },
    allowRequest: (req, done) => done(null, allowedSocketOrigin(req)),
    // Replay is read from the authoritative database. Keeping raw recovery
    // packets could resurrect withdrawn text or replay after VIP expiry.
    perMessageDeflate: false,
    httpCompression: false,
  });
  const authorize = async (req: IncomingMessage, expected?: TeahouseActor) => {
    const actor = await identify(req);
    if (!actor) throw fail("请先登录后进入会员茶室。", 401);
    if (actor.kind === "reader" && store.readerDeleted(actor.id)) throw fail("账号已注销，请重新登录。", 401);
    if (expected && key(actor) !== key(expected))
      throw fail("登录身份已变化，请重新进入。", 401);
    if (!canEnterTeahouse(actor))
      throw fail("会员茶室仅对有效 VIP、作者、总版主和版主开放。", 403);
    return actor;
  };
  const writable = (actor: TeahouseActor) => {
    if (actor.muted) throw fail("当前账号处于禁言状态，暂时不能发送。", 403);
  };
  const revoke = (socket: TeaSocket, error: unknown) => {
    socket.emit("access:revoked", { error: fault(error).error });
    socket.disconnect(true);
  };
  const authorizeSocket = async (socket: TeaSocket) => {
    try {
      const actor = await authorize(socket.request, socket.data.actor);
      if (!socket.connected) throw fail("连接已断开。", 401);
      socket.data.actor = actor;
      return actor;
    } catch (error) {
      if ([401, 403].includes(fault(error).status)) revoke(socket, error);
      else socket.conn.close(); // Temporary bridge/rate failures use normal reconnect and cursor replay.
      throw error;
    }
  };
  let cleanup: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  async function imageDirectory() {
    const stat = await lstat(files);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail("图片目录异常，请联系作者处理。", 503);
  }
  async function imageFile(fileId: string) {
    await imageDirectory();
    const path = resolve(files, `${id(fileId)}.webp`);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail("图片文件异常，请联系作者处理。", 503);
    return path;
  }
  function cleanupFiles(): Promise<void> {
    if (cleanup) return cleanup;
    cleanup = (async () => {
      store.pruneUnboundAttachments();
      for (const fileId of store.pendingFileDeletions()) {
        try {
          if (store.attachmentRegistered(fileId)) continue;
          const path = await imageFile(fileId);
          if (store.attachmentRegistered(fileId)) continue;
          await unlink(path);
          store.confirmFileDeletion(fileId);
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
            store.confirmFileDeletion(fileId);
        }
      }
    })().finally(() => {
      cleanup = undefined;
    });
    return cleanup;
  }
  const publicAuthor = (author: TeahouseAuthor): TeahouseAuthor => author.kind === "reader" && store.readerDeleted(author.id)
    ? { kind: "reader", id: author.id, name: "已注销用户", icon: null } : author;
  type BackgroundOperation = "cleanup" | "access-check" | "members" | "reader-purge-notice" | "changes";
  function reportBackgroundFailure(operation: BackgroundOperation): void {
      // SQL/IO exceptions can contain private values. Only the fixed operation
      // name is logged; the next timer or durable deletion job retries normally.
      try { process.stderr.write(JSON.stringify({ event: "teahouse-background-retry", operation, at: new Date().toISOString() }) + "\n"); }
      catch { /* A failed log transport must not create another rejected task. */ }
  }
  function background(operation: BackgroundOperation, task: Promise<unknown>): void {
    void task.catch(() => reportBackgroundFailure(operation));
  }
  function consumeBudget(name: string, maximum: number) {
    const budget = budgets.get(name) ?? { start: Date.now(), count: 0 };
    if (Date.now() - budget.start > 60_000) {
      budget.start = Date.now();
      budget.count = 0;
    }
    budget.count++;
    budgets.set(name, budget);
    if (budget.count > maximum) throw fail("操作太快，请稍后再试。", 429);
  }
  async function currentAuthors(
    req: IncomingMessage,
    authors: TeahouseAuthor[],
  ) {
    const current = options.authors
      ? await options.authors(req, authors)
      : authors;
    return new Map(
      current.map((author) => [`${author.kind}:${author.id}`, author]),
    );
  }
  let fanout: Promise<void> = Promise.resolve();
  function visitAuthorized(
    visit: (socket: TeaSocket, actor: TeahouseActor) => void | Promise<void>,
  ): Promise<void> {
    const task = fanout.then(async () => {
      if (closed) return;
      // Small bounded batches avoid one message launching unbounded identity calls.
      const sockets = [...io.sockets.sockets.values()];
      for (let offset = 0; offset < sockets.length; offset += 8)
        await Promise.all(
          sockets.slice(offset, offset + 8).map(async (socket) => {
            try {
              const actor = await authorizeSocket(socket);
              if (!closed && socket.connected) await visit(socket, actor);
            } catch {
              /* fail closed */
            }
          }),
        );
    });
    fanout = task.catch(() => {});
    return task;
  }
  async function members() {
    const active: TeaSocket[] = [];
    await visitAuthorized((socket) => {
      active.push(socket);
    });
    const unique = new Map(
      active.map((socket) => [key(socket.data.actor), socket.data.actor]),
    );
    // Do not expose server-only mute state or any session credential.
    const list = [...unique.values()].map(
      ({ kind, id, name, avatarUrl, icon, role, vip }) => ({
        kind,
        id,
        name,
        avatarUrl,
        icon,
        role,
        vip,
      }),
    );
    await visitAuthorized((socket) => {
      socket.emit("members:changed", { members: list.filter(actor => actor.kind !== "reader" || !store.readerDeleted(actor.id)) });
    });
  }
  let membersTimer: ReturnType<typeof setTimeout> | undefined;
  let membersTask: Promise<void> | undefined;
  let membersRequested = false;
  function scheduleMembers() {
    if (closed) return;
    membersRequested = true;
    if (membersTask) return;
    clearTimeout(membersTimer);
    membersTimer = setTimeout(() => {
      membersRequested = false;
      membersTask = members().finally(() => {
        membersTask = undefined;
        if (membersRequested) scheduleMembers();
      });
      background("members", membersTask);
    }, 80);
    membersTimer.unref();
  }
  // Keep one active and one pending wave, not one promise/body per mutation.
  // Overflow becomes a content-free hint; the existing cursor API is authoritative.
  const pendingMessages = new Map<string, TeahouseAuthor>();
  let pendingRequest: IncomingMessage | undefined;
  let pendingAnnouncements = false, pendingSync = false;
  let changesTask: Promise<void> | undefined;
  function queueChanges(req: IncomingMessage, message?: TeahouseMessage) {
    if (closed) return;
    pendingRequest = req;
    if (message) {
      if (!pendingSync && (pendingMessages.has(message.id) || pendingMessages.size < 64)) pendingMessages.set(message.id, message.author);
      else { pendingMessages.clear(); pendingSync = true; }
    } else pendingAnnouncements = true;
    flushChanges();
  }
  function flushChanges() {
    if (closed || changesTask || !pendingRequest) return;
    changesTask = Promise.resolve().then(async () => {
      while (!closed && pendingRequest) {
        const request = pendingRequest, messages = new Map(pendingMessages), notices = pendingAnnouncements;
        let sync = pendingSync;
        pendingRequest = undefined; pendingMessages.clear(); pendingAnnouncements = false; pendingSync = false;
        let profiles = new Map<string, TeahouseAuthor>();
        if (!sync && messages.size) {
          try { profiles = await currentAuthors(request, [...messages.values()]); }
          catch { reportBackgroundFailure("changes"); sync = true; }
        }
        await visitAuthorized(async (socket, actor) => {
          if (sync) { socket.emit("history:sync"); return; }
          try {
            for (const messageId of messages.keys()) {
              const latest = store.getMessage(actor, messageId);
              if (latest) socket.emit("message:changed", { ...latest, author: publicAuthor(profiles.get(`${latest.author.kind}:${latest.author.id}`) ?? latest.author) });
            }
            if (notices) {
              const list = await announcements(socket.request, actor);
              if (socket.connected && !closed) socket.emit("announcements:changed", { announcements: list });
            }
          } catch {
            reportBackgroundFailure("changes");
            await authorizeSocket(socket);
            if (!closed) socket.emit("history:sync");
          }
        });
      }
    }).finally(() => {
      changesTask = undefined;
      if (!closed && pendingRequest) flushChanges();
    });
    background("changes", changesTask);
  }
  function finalMessage(message: TeahouseMessage, actor: TeahouseActor) {
    const latest = store.getMessage(actor, message.id) ?? message;
    const { kind, id, name, avatarUrl, icon } = actor;
    return {
      ...latest,
      author: publicAuthor(
        latest.author.kind === kind && latest.author.id === id
          ? { kind, id, name, avatarUrl, icon }
          : message.author),
    };
  }
  async function announcements(req: IncomingMessage, actor: TeahouseActor) {
    const initial = store.listAnnouncements(actor);
    const profiles = await currentAuthors(
      req,
      initial.map((item) => item.author),
    );
    actor = await authorize(req, actor);
    const requested = new Set(initial.map((item) => item.id));
    return store
      .listAnnouncements(actor)
      .filter((item) => requested.has(item.id))
      .map((item) => ({
        ...item,
        author:
          profiles.get(`${item.author.kind}:${item.author.id}`) ?? item.author,
      }));
  }
  async function run<T>(
    socket: TeaSocket,
    ack: Ack<T>,
    work: (actor: TeahouseActor) => Promise<T> | T,
    requiresSpeech = true,
    finalize: (data: T, actor: TeahouseActor) => T = (data) => data,
    changed: () => boolean = () => true,
  ) {
    if (typeof ack !== "function") return;
    if (socket.data.pending >= 4) {
      ack({ ok: false, error: "操作太快，请稍后再试。", status: 429 });
      return;
    }
    socket.data.pending++;
    try {
      let actor = await authorizeSocket(socket);
      consumeBudget(`event:${key(actor)}`, 120);
      if (requiresSpeech) writable(actor);
      const data = await work(actor);
      actor = await authorizeSocket(socket);
      const final = finalize(data, actor);
      if (changed()) options.onActivity?.(socket.request);
      ack({ ok: true, data: final });
    } catch (error) {
      ack({ ok: false, ...fault(error) });
    } finally {
      socket.data.pending--;
    }
  }
  io.use((socket, next) => {
    void authorize(socket.request).then(
      (actor) => {
        socket.data = { actor, pending: 0 };
        next();
      },
      (error) =>
        next(
          Object.assign(Error(fault(error).error), {
            data: { status: fault(error).status },
          }),
        ),
    );
  });
  io.on("connection", (socket) => {
    scheduleMembers();
    socket.on("disconnect", scheduleMembers);
    socket.on("message:send", (input, ack) => {
      let changed = false;
      void run(
        socket,
        ack,
        async (actor) => {
          const data = record(input);
          const payload: TeahouseSendInput = {
            id: id(data.id),
            text: text(data.text, 4000),
          };
          if (data.attachmentIds !== undefined) {
            if (
              !Array.isArray(data.attachmentIds) ||
              data.attachmentIds.length > 6
            )
              throw fail("一次最多发送六张图片。");
            payload.attachmentIds = data.attachmentIds.map(id);
          }
          const existing = store.getMessage(actor, payload.id);
          const message = store.sendMessage(actor, payload);
          changed = !existing;
          try {
            const profile = (await currentAuthors(socket.request, [message.author])).get(`${message.author.kind}:${message.author.id}`) ?? message.author;
            return { ...message, author: profile };
          } finally {
            if (changed) queueChanges(socket.request, message);
          }
        },
        true,
        finalMessage,
        () => changed,
      );
    });
    socket.on("message:withdraw", (input, ack) => {
      let changed = false;
      void run(
        socket,
        ack,
        async (actor) => {
          const messageId = id(record(input).id);
          const existing = store.getMessage(actor, messageId);
          const result = store.withdrawMessage(actor, messageId);
          changed = Boolean(existing && !existing.withdrawn);
          try {
            await cleanupFiles();
            const author = (await currentAuthors(socket.request, [result.message.author])).get(`${result.message.author.kind}:${result.message.author.id}`) ?? result.message.author;
            return { ...result.message, author };
          } finally {
            if (changed) queueChanges(socket.request, result.message);
          }
        },
        false,
        finalMessage,
        () => changed,
      );
    });
    socket.on("announcement:save", (input, ack) => {
      void run(
        socket,
        ack,
        async (actor) => {
          const data = record(input);
          const payload: TeahouseAnnouncementInput = {
            title: text(data.title, 100),
            text: text(data.text, 4000),
          };
          if (data.id !== undefined) payload.id = id(data.id);
          if (data.revision !== undefined)
            payload.revision = number(data.revision);
          if (data.pinned !== undefined) {
            if (typeof data.pinned !== "boolean") throw fail("置顶状态无效。");
            payload.pinned = data.pinned;
          }
          const saved = store.saveAnnouncement(actor, payload);
          try {
            const profiles = await currentAuthors(socket.request, [saved.author]);
            return { ...saved, author: profiles.get(`${saved.author.kind}:${saved.author.id}`) ?? saved.author };
          } finally { queueChanges(socket.request); }
        },
        true,
        (saved, actor) => {
          const latest = store
            .listAnnouncements(actor)
            .find((item) => item.id === saved.id);
          if (!latest) throw fail("公告已被删除，请刷新后再试。", 409);
          return { ...latest, author: saved.author };
        },
      );
    });
    socket.on("announcement:delete", (input, ack) => {
      void run(socket, ack, async (actor) => {
        const data = record(input);
        store.deleteAnnouncement(actor, id(data.id), number(data.revision));
        queueChanges(socket.request);
        return { ok: true as const };
      });
    });
  });
  const timer = setInterval(() => {
    if (checking || closed) return;
    checking = true;
    background("access-check", visitAuthorized(() => {}).finally(() => {
      checking = false;
    }));
    background("cleanup", cleanupFiles());
  }, options.accessCheckMs ?? 15_000);
  timer.unref();
  background("cleanup", cleanupFiles());

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(req.url || "/", origin);
    if (!url.pathname.startsWith("/api/teahouse/")) return false;
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        throw fail("请求来源无效。", 403);
      if (
        req.method !== "GET" &&
        (!allowedOrigin(req) || req.headers["x-reader-request"] !== "1")
      )
        throw fail("请求来源无效。", 403);
      const actor = await authorize(req);
      if (req.method === "GET" && url.pathname === "/api/teahouse/session") {
        json(res, { actor, serverTime: Date.now() });
        return true;
      }
      if (req.method === "GET" && url.pathname === "/api/teahouse/messages") {
        const query: { before?: number; after?: number; limit?: number } = {};
        for (const name of ["before", "after", "limit"] as const) {
          const value = url.searchParams.get(name);
          if (value !== null) {
            if (!/^\d{1,15}$/.test(value)) throw fail("分页参数无效。");
            query[name] = number(Number(value));
          }
        }
        const initial = store.readMessages(actor, query);
        const profiles = await currentAuthors(
          req,
          initial.messages.map((item) => item.author),
        );
        const fresh = await authorize(req, actor);
        const messages = initial.messages.flatMap((item) => {
          const current = store.getMessage(fresh, item.id);
          return current
            ? [
                {
                  ...current,
                  author: publicAuthor(
                    profiles.get(
                      `${current.author.kind}:${current.author.id}`,
                    ) ?? current.author),
                },
              ]
            : [];
        });
        json(res, { ...initial, messages });
        return true;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/api/teahouse/announcements"
      ) {
        json(res, { announcements: await announcements(req, actor) });
        return true;
      }
      const match = /^\/api\/teahouse\/attachments\/([0-9a-f-]{36})$/.exec(
        url.pathname,
      );
      if (req.method === "GET" && match) {
        const attachment = store.getAttachment(actor, id(match[1]));
        if (!attachment) throw fail("图片不存在或已撤回。", 404);
        let bytes: Buffer;
        try {
          bytes = await readFile(await imageFile(attachment.id));
        } catch {
          throw fail("图片不存在或已撤回。", 404);
        }
        const fresh = await authorize(req, actor);
        if (!store.getAttachment(fresh, attachment.id))
          throw fail("图片不存在或已撤回。", 404);
        res.writeHead(200, {
          "Content-Type": "image/webp",
          "Content-Length": bytes.length,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        });
        res.end(bytes);
        return true;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/api/teahouse/attachments"
      ) {
        writable(actor);
        consumeBudget(`upload:${key(actor)}`, 12);
        if (uploading >= 4) throw fail("图片处理较忙，请稍后再试。", 429);
        uploading++;
        try {
          const result = await withStreamUpload(
            req,
            directory,
            async (file) => {
              const formats: Record<string, string> = {
                "image/jpeg": "jpeg",
                "image/png": "png",
                "image/webp": "webp",
              };
              if (!formats[file.mimetype])
                throw fail("请选择 JPG、PNG 或 WebP 图片。", 415);
              const raw = await readFile(file.tempFilePath);
              let bytes: Buffer, width: number, height: number;
              try {
                const source = sharp(raw, {
                  limitInputPixels: 40_000_000,
                  animated: true,
                });
                const metadata = await source.metadata();
                if (
                  metadata.format !== formats[file.mimetype] ||
                  !metadata.width ||
                  !metadata.height ||
                  (metadata.pages ?? 1) > 1
                )
                  throw Error("unsupported");
                const encoded = await source
                  .rotate()
                  .resize(2048, 2048, {
                    fit: "inside",
                    withoutEnlargement: true,
                  })
                  .webp({ quality: 82, effort: 4 })
                  .toBuffer();
                bytes = await compressCommunityUpload(encoded);
                const final = await sharp(bytes).metadata();
                width = final.width!;
                height = final.height!;
              } catch {
                throw fail(
                  "图片无法读取、分辨率过大或为动态图，请换一张静态图片。",
                  415,
                );
              }
              const fresh = await authorize(req, actor);
              writable(fresh);
              const attachmentId = randomUUID();
              await mkdir(files, { recursive: true });
              await imageDirectory();
              const path = resolve(files, `${attachmentId}.webp`);
              try {
                await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
                const latest = await authorize(req, actor);
                writable(latest);
                return store.registerAttachment(latest, {
                  id: attachmentId,
                  mime: "image/webp",
                  size: bytes.length,
                  width,
                  height,
                });
              } catch (error) {
                await unlink(path).catch(() => {});
                throw error;
              }
            },
            {
              maxFileBytes: 25 * 1024 * 1024,
              maxImageBytes: 25 * 1024 * 1024,
              maxAudioBytes: 0,
            },
          );
          const fresh = await authorize(req, actor);
          writable(fresh);
          store.getAttachment(fresh, result.id);
          options.onActivity?.(req);
          json(res, result, 201);
        } finally {
          uploading--;
        }
        return true;
      }
      throw fail("接口不存在。", 404);
    } catch (error) {
      if (!res.headersSent) {
        const result = fault(error);
        json(res, { error: result.error }, result.status);
      } else res.destroy();
      return true;
    }
  }
  return {
    handle,
    store,
    disconnectRequests(predicate: (req: IncomingMessage) => boolean): void {
      for (const socket of io.sockets.sockets.values()) {
        if (!predicate(socket.request)) continue;
        socket.emit("access:revoked", {
          error: "登录身份已变化，请重新进入。",
          reason: "identity-changed",
        });
        socket.disconnect(true);
      }
    },
    async purgeReaderData(readerId: string) {
      if (closed) throw fail("茶室清理服务已关闭。", 503);
      const result = store.purgeReaderData(readerId);
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.actor.kind === "reader" && socket.data.actor.id === readerId) revoke(socket, fail("账号已注销。", 401));
      }
      // Account cleanup must not wait for every online member's cross-host
      // identity lookup. Reconnect replay independently carries the tombstones.
      background("reader-purge-notice", visitAuthorized(socket => { socket.emit("reader:purged", { id: readerId }); }));
      await cleanupFiles();
      if (store.pendingFileDeletions().length) throw fail("Teahouse attachment cleanup is queued for retry.", 503);
      scheduleMembers();
      return result;
    },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      pendingRequest = undefined; pendingMessages.clear(); pendingAnnouncements = false; pendingSync = false;
      clearInterval(timer);
      clearTimeout(membersTimer);
      closing = (async () => {
        try {
          await new Promise<void>((resolve) => io.close(() => resolve()));
          await changesTask;
          await membersTask;
          await fanout;
          await cleanupFiles();
        } finally {
          // Cleanup errors still reach the caller; durable jobs remain for the
          // next startup, but a failed cleanup must not leak the SQLite handle.
          store.close();
        }
      })();
      return closing;
    },
  };
}
