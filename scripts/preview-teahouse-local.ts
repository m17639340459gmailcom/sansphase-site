// Loopback-only harness for the real tea-room modules. Synthetic identities,
// separate persistent chat data, no production settings or network authority.
import { createServer, type IncomingMessage } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { build } from "esbuild";
import { createPreviewServer } from "../server.mjs";
import { createCommunityDemo } from "./fixtures/community-demo.mjs";
import { makeReadingDemo } from "./fixtures/reading-demo.mjs";
import { createTeahouseService } from "../server/teahouse-service.ts";

const repository = resolve(fileURLToPath(new URL("../", import.meta.url)));
const port = Number(process.env.TEAHOUSE_LOCAL_PORT || 4248);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid local port.");
const origin = `http://127.0.0.1:${port}`;
const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const directory = resolve(repository, ".local", `teahouse-${port}`);
await mkdir(directory, { recursive: true });
const bundle = await build({
  entryPoints: {
    "teahouse-client": resolve(repository, "src/teahouse/client.ts"),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  splitting: true,
  write: false,
  outdir: resolve(directory, "build"),
  outExtension: { '.js': '.mjs' },
  chunkNames: "teahouse-chunks/[name]-[hash]",
  sourcemap: false,
  minify: true,
  plugins: [
    {
      name: "existing-typed-browser-modules",
      setup(builder) {
        builder.onResolve({ filter: /\.mjs$/ }, async (args) => {
          if (!args.path.startsWith(".")) return;
          const target = resolve(
            args.resolveDir,
            args.path.replace(/\.mjs$/, ".ts"),
          );
          if (
            await stat(target).then(
              (s) => s.isFile(),
              () => false,
            )
          )
            return { path: target };
        });
      },
    },
  ],
});
const assets = new Map(
  bundle.outputFiles.map((file) => [
    "/" +
      file.path
        .slice(resolve(directory, "build").length + 1)
        .replaceAll("\\", "/"),
    file.contents,
  ]),
);
const community = await createCommunityDemo({ teahouseDemo: true });
const communityService = community.service(port);
const roles = [
  ["mobai", "VIP 会员 · 墨白"],
  ["general", "总版主 · 统筹"],
  ["steward", "版主 · 守望"],
  ["owner", "作者 · 無相"],
  ["assistant", "协管（无 VIP）"],
  ["assistantvip", "协管（有效 VIP，普通会员权限）"],
  ["demo", "普通读者（无 VIP）"],
] as const;
const sessions = new Map<string, { role: string; expires: number }>();
const sessionCookie = `teahouse_local_session_${port}`;
const tokenOf = (req: IncomingMessage) => {
  const tokens = String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.startsWith(sessionCookie + "="));
  return tokens.length === 1 ? tokens[0].slice(sessionCookie.length + 1) : "";
};
function selected(req: IncomingMessage) {
  const session = sessions.get(tokenOf(req));
  return session && session.expires > Date.now() ? session : null;
}
function projected(req: IncomingMessage) {
  const session = selected(req);
  if (!session) return null;
  const cookie = String(req.headers.cookie || "")
    .split(";")
    .filter((item) => !/^\s*(?:preview_as|community_browse)=/.test(item));
  cookie.push(`preview_as=${session.role}`);
  return Object.assign(Object.create(req) as IncomingMessage, {
    headers: { ...req.headers, cookie: cookie.join(";") },
  });
}
const siteOptions = {
  root: resolve(repository, "dist"),
  siteOrigin: origin,
  communityEnabled: true,
  communityOnly: true,
  teahouseEnabled: true,
  communityService,
  readerService: community.readerService(port),
  authorService: community.authorService,
  contentService: {
    snapshot: async () => ({
      data: {
        ...makeReadingDemo(),
        author: null,
        announcements: [],
        profile: {
          name: "無相",
          signature: "本地功能验证",
          bio: "本地测试账号与数据",
          socialLinks: [],
        },
      },
    }),
  },
  release: "local-teahouse",
};
const site = createPreviewServer(siteOptions);
const artwork = createPreviewServer({
  root: resolve(repository, "public/assets/community"),
});
const compiledArtwork = createPreviewServer({
  root: resolve(repository, "dist/assets/community"),
});
const server = createServer({ requestTimeout: 60_000 }, (req, res) => {
  void (async () => {
    const respond = (
      status: number,
      value: string,
      type = "text/plain; charset=utf-8",
    ) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(value);
    };
    if (
      req.headers.host !== `127.0.0.1:${port}` ||
      !localAddresses.has(req.socket.remoteAddress || "") ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      respond(403, "Local access only");
      return;
    }
    const url = new URL(req.url || "/", origin);
    if (url.pathname === "/local/identities") {
      if (req.method === "GET") {
        const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>会员茶室 · 本地测试身份</title><style>body{max-width:660px;margin:48px auto;padding:0 24px;background:#e8e2d6;color:#384355;font:16px/1.8 system-ui}form{margin:12px 0}button,a{padding:10px 18px;border:1px solid #b5a68d;border-radius:10px;background:#f3eee4;color:#384355;font:inherit}a{display:inline-block}p{color:#647185}</style><h1>会员茶室 · 本地测试</h1><p>聊天、图片、历史和权限使用正式模块。此处仅选择虚构测试账号，不连接线上账号。聊天记录保存在本机独立目录，重启后仍保留。</p>${roles.map(([role, label]) => `<form method="post"><input type="hidden" name="role" value="${role}"><button>${label}</button></form>`).join("")}<p>同一浏览器标签页共享登录身份。测试两人互聊时，请另开无痕窗口选择另一个账号。</p><a href="/teahouse">返回茶室</a></html>`;
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        respond(200, html, "text/html; charset=utf-8");
        return;
      }
      if (req.method !== "POST" || req.headers.origin !== origin) {
        respond(403, "请从本地身份选择页操作。");
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) {
          respond(413, "请求过大");
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const role = roles.find((item) => item[0] === form.get("role"));
      if (!role) {
        respond(400, "请选择测试身份");
        return;
      }
      sessions.delete(tokenOf(req));
      for (const [token, session] of sessions)
        if (session.expires < Date.now()) sessions.delete(token);
      if (sessions.size >= 100) {
        respond(429, "测试会话过多，请重启本地服务。");
        return;
      }
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, {
        role: role[0],
        expires: Date.now() + 12 * 60 * 60_000,
      });
      res.writeHead(303, {
        Location: "/teahouse",
        "Cache-Control": "no-store",
        "Set-Cookie": `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict`,
      });
      res.end();
      return;
    }
    if (await chat.handle(req, res)) return;
    if (
      !["GET", "HEAD"].includes(req.method || "") &&
      !url.pathname.startsWith("/api/")
    ) {
      respond(405, "Method not allowed");
      return;
    }
    const asset = assets.get(url.pathname);
    if (asset) {
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : asset);
      return;
    }
    if (url.pathname === "/teahouse" || url.pathname === "/teahouse.css") {
      const html = url.pathname === "/teahouse";
      const source = await readFile(
        resolve(repository, "src/teahouse", html ? "index.html" : "chat.css"),
      );
      const body = html ? source.toString('utf8').replace('<div class="header-actions">', '<a href="/local/identities" class="preview-label">本地身份入口</a><div class="header-actions">') : source;
      res.writeHead(200, {
        "Content-Type": html
          ? "text/html; charset=utf-8"
          : "text/css; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if (
      /^\/assets\/community\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:svg|webp|png|jpe?g|json)$/.test(
        url.pathname,
      )
    ) {
      const path = url.pathname.slice("/assets/community".length);
      req.url = path;
      const compiled = await stat(
        resolve(repository, "dist/assets/community", "." + path),
      ).then(
        (s) => s.isFile(),
        () => false,
      );
      (compiled ? compiledArtwork : artwork).emit("request", req, res);
      return;
    }
    if (url.pathname === "/healthz") {
      respond(200, "ok");
      return;
    }
    const authenticated = projected(req);
    if (!authenticated) {
      res.writeHead(303, {
        Location: "/local/identities",
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    // Strip client-selected fixture roles. The opaque local session selects them.
    req.headers = authenticated.headers;
    site.emit("request", req, res);
  })().catch(() => {
    if (!res.headersSent) {
      res.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end("本地茶室暂时不可用。");
    } else res.destroy();
  });
});
const chat = createTeahouseService({
  server,
  directory: resolve(directory, "data"),
  origin,
  identify: async (req) => {
    const request = projected(req);
    return request ? communityService.teahouseIdentity(request) : null;
  },
  authors: async (req, authors) => {
    const request = projected(req);
    if (!request) throw Object.assign(Error("会话已失效"), { status: 401 });
    return communityService.teahouseAuthors(request, authors);
  },
});
server.on("error", (error) => {
  console.error(
    `Local tea-room failed: ${"code" in error ? error.code : "START_FAILED"}`,
  );
  void chat.close().finally(() => {
    community.close();
    process.exitCode = 1;
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Local tea-room: ${origin}/local/identities\nPersistent local chat data: ${directory}/data`,
  ),
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void chat.close().finally(() => {
      community.close();
      process.exit(0);
    });
  });
