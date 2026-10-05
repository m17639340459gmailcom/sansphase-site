import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build } from "esbuild";
import { createDemoOrders } from "./orders.ts";

const port = 4210,
  origin = `http://127.0.0.1:${port}`,
  token = randomBytes(24).toString("hex"),
  adminToken = randomBytes(24).toString("hex");
const root = resolve("dist"),
  dataDir = resolve(".local/vip-batch-preview");
await mkdir(dataDir, { recursive: true });
const store = createDemoOrders(resolve(dataDir, "demo.db"));
const bundle = await build({
  entryPoints: ["previews/vip/client.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const adminBundle = await build({
  entryPoints: ["previews/vip/admin-client.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const types: Record<string, string> = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="preview-token" content="${token}"><title>个人中心与 VIP · 本地演示</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/reader.css"><link rel="stylesheet" href="/preview.css"><link rel="stylesheet" href="/order-view.css"></head><body class="blog-open"><header class="vip-preview-bar"><div><strong>个人中心与 VIP · 本地演示</strong><p>测试账号与订单独立保存，不会收款，也不会修改线上数据。</p></div><a class="vip-secondary" href="/admin">作者后台预览</a><label>演示账号 <select id="demo-reader"><option value="reader">普通读者</option><option value="vip">临近到期 VIP</option><option value="expired">已到期会员</option></select></label></header><p id="preview-message" role="status"></p><main id="main"></main><dialog id="checkout" class="vip-dialog" aria-labelledby="checkout-title"><header><h2 id="checkout-title">开通 / 续期 VIP</h2><button type="button" data-close-checkout aria-label="关闭充值窗口">×</button></header><div id="checkout-body"></div><p id="checkout-message" role="alert"></p></dialog><script type="module" src="/preview-client.mjs"></script></body></html>`;
const adminHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="preview-token" content="${adminToken}"><title>订单管理 · 本地作者预览</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/reader.css"><link rel="stylesheet" href="/preview.css"><link rel="stylesheet" href="/order-view.css"></head><body class="blog-open"><header class="vip-preview-bar"><div><strong>作者后台 · 订单预览</strong><p>仅本地演示身份，不代表正式后台登录；只读查看测试订单。</p></div><a class="vip-secondary" href="/">返回用户个人中心</a></header><main id="main"></main><script type="module" src="/preview-admin.mjs"></script></body></html>`;
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  const send = (code: number, value: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) {
      send(403, { error: "仅允许本机预览。" });
      return;
    }
    const url = new URL(req.url || "/", origin);
    if (url.pathname.startsWith("/demo/admin/")) {
      if (
        req.headers["x-preview-token"] !== adminToken ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        send(403, { error: "此预览入口仅供本地作者查看。" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/demo/admin/orders") {
        send(
          200,
          store.adminPage(
            Number(url.searchParams.get("page") || 1),
            url.searchParams.get("status") || "all",
          ),
        );
        return;
      }
      send(405, { error: "作者订单预览只支持读取。" });
      return;
    }
    if (url.pathname.startsWith("/demo/")) {
      if (
        req.headers["x-preview-token"] !== token ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        send(403, { error: "请从本地预览页面操作。" });
        return;
      }
      const reader = String(req.headers["x-demo-reader"] || "");
      store.reader(reader);
      if (req.method === "GET" && url.pathname === "/demo/state") {
        send(200, {
          reader: store.reader(reader),
          orderCount: store.count(reader),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/demo/orders") {
        send(
          200,
          store.page(reader, Number(url.searchParams.get("page") || 1)),
        );
        return;
      }
      if (req.method !== "POST") {
        send(405, { error: "不支持的操作。" });
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += String(chunk);
        if (Buffer.byteLength(raw) > 4096) {
          send(413, { error: "请求过大。" });
          return;
        }
      }
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (url.pathname === "/demo/orders") {
        if (body.agree !== true) throw Error("请先阅读并同意 VIP 特权与规则。");
        send(
          201,
          store.create(
            reader,
            String(body.kind || ""),
            String(body.contact || ""),
          ),
        );
        return;
      }
      if (url.pathname === "/demo/outcome") {
        if (!["paid", "failed", "cancelled"].includes(String(body.outcome)))
          throw Error("无效的模拟结果。");
        send(
          200,
          store.finish(
            reader,
            String(body.id || ""),
            body.outcome as "paid" | "failed" | "cancelled",
          ),
        );
        return;
      }
      send(404, { error: "不存在的操作。" });
      return;
    }
    if (req.method !== "GET") {
      send(405, { error: "仅支持预览读取。" });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/admin") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(url.pathname === "/admin" ? adminHtml : html);
      return;
    }
    if (url.pathname === "/preview-admin.mjs") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(adminBundle.outputFiles[0]!.contents);
      return;
    }
    if (url.pathname === "/order-view.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(await readFile("previews/vip/order-view.css"));
      return;
    }
    if (url.pathname === "/preview-client.mjs") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(bundle.outputFiles[0]!.contents);
      return;
    }
    if (url.pathname === "/preview.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(await readFile("previews/vip/preview.css"));
      return;
    }
    const file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep) || !types[extname(file)]) {
      send(404, { error: "不存在的资源。" });
      return;
    }
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] });
    res.end(bytes);
  } catch (error) {
    send(400, {
      error: error instanceof Error ? error.message : "预览操作失败。",
    });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Local-only VIP preview: ${origin}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
