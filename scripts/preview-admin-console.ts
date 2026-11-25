// Independent loopback preview. No environment/private settings or existing data are loaded.
import { randomBytes } from "node:crypto";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createPortReservation } from "node:net";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildAdminConsole } from "./build-admin-console.ts";
import { getPayload, type Payload } from "payload";
import type { SQLiteAdapter } from "@payloadcms/db-sqlite";
import { createPreviewServer } from "../server.mjs";
import { makePayloadConfig } from "../server/payload/config.ts";
import { createPayloadStore } from "../server/payload/store.ts";
import { createAuthorService } from "../server/author-service.ts";
import { createContentService } from "../server/content-service.ts";
import { createReaderAdminService } from "../server/reader-admin-service.ts";
import { createReaderService } from "../server/reader-service.ts";
import { createLoginVerification, readLoginVerificationSettings } from "../server/login-verification.ts";
import { createReaderWorkflow } from "../server/reader-workflow.ts";
import {
  createReaderUidStore,
  readerUidsTableSql,
  readerUidsTriggerSql,
} from "../server/reader-uids.ts";
import { seedAdminConsolePreview } from "./fixtures/admin-console-preview.ts";
import { loginEventsSchema } from "../server/payload/reader-migration.ts";
import { createLoginLedger } from "../server/login-ledger.ts";
import { startCaptcha } from "./preview-captcha.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
const localRoot = resolve(repository, ".local");
const loopbacks = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const run = promisify(execFile);
const loginHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地后台预览</title><link rel="stylesheet" href="/preview-login.css"></head><body><main><p class="eyebrow">SANSPHASE · 本地演示</p><h1>作者管理后台</h1><p>使用独立的合成数据，可试用主站内容编辑、网站设置、用户管理、VIP 操作和资料审核。</p><form id="login"><label for="email">演示作者邮箱</label><input id="email" name="email" type="email" value="owner@example.test" autocomplete="username" required><label for="password">演示密码</label><input id="password" name="password" type="password" value="DemoLogin2026!" autocomplete="current-password" required><button type="submit">登录本地演示后台</button><p id="status" role="status"></p></form></main><script src="/preview-login.js" defer></script></body></html>`;
const loginJs = (destination: string) => `document.querySelector('#login').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button'),status=document.querySelector('#status');button.disabled=true;status.textContent='正在登录…';try{const response=await fetch('/api/author/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Author-Request':'1'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});const data=await response.json();if(!response.ok)throw Error(data.error||'登录失败');location.assign(${JSON.stringify(destination)});}catch(error){status.textContent=error.message;button.disabled=false;}});`;
const loginCss =
  "html{color-scheme:light}body{margin:0;background:#f3f1ec;color:#28313c;font:15px/1.65 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{width:min(400px,calc(100vw - 64px));padding:32px;background:#fff;border:1px solid #dedbd3;border-radius:16px}.eyebrow{font-size:12px;letter-spacing:.08em;color:#756b5a}h1{font-size:26px;margin:12px 0}label{display:block;margin-top:16px}input,button{box-sizing:border-box;width:100%;font:inherit;border-radius:8px}input{padding:10px 12px;border:1px solid #ccc;background:#fff;color:inherit}input:focus{outline:none;border-color:#795d35}button{margin-top:24px;padding:11px;border:1px solid #3b4857;background:#3b4857;color:#fff;cursor:pointer}button:focus-visible{outline:2px solid #795d35;outline-offset:3px}button:disabled{opacity:.6;cursor:wait}#status{min-height:24px;color:#805838}";

async function availablePort(requested: number, hostname = "127.0.0.1") {
  if (
    !Number.isInteger(requested) ||
    (requested !== 0 && (requested < 1024 || requested > 65535))
  )
    throw Error("Invalid local preview port.");
  const reservation = createPortReservation();
  await new Promise<void>((done, reject) => {
    reservation.once("error", reject);
    reservation.listen(requested, hostname, done);
  });
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw Error("Local preview port was not reserved.");
  await new Promise<void>((done, reject) =>
    reservation.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

type PreviewRemove = (
  path: string,
  options: { recursive: true; force: true; maxRetries: number },
) => Promise<void>;
export async function cleanupAdminConsoleDirectory(
  directory: string,
  remove: PreviewRemove = rm,
) {
  const root = await realpath(localRoot),
    actual = await realpath(directory);
  if (
    actual !== resolve(root, basename(directory)) ||
    !/^admin-console-preview-[^\\/]+$/.test(relative(root, actual))
  )
    throw Error("Unsafe local preview cleanup path.");
  // fs.rm retries recursively at every directory level. A Windows DB lock can
  // multiply that delay, so only this outer operation retries, at most 3 times.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await remove(actual, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (cause) {
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? cause.code
          : undefined;
      if (
        attempt < 2 &&
        ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].includes(
          String(code),
        )
      ) {
        await delay((attempt + 1) * 100);
        continue;
      }
      throw new Error(
        `本地预览临时目录清理失败，已保留未删除的文件：${actual}。请在占用进程退出后重试。`,
        { cause },
      );
    }
  }
}

type PreviewReady = {
  type: "ready";
  origin: string;
  address: AddressInfo;
  fixtures: { ownerId: string; readers: string[] };
};

type DeliveryVerification = { serviceOrigin: string; serviceSecret: string };

// libsql's native Windows connections can keep a file handle after client.close().
// Run the complete synthetic server in its own process, preserving actual
// Payload transactions, and remove the directory only after that process exits.
// This is a local preview boundary; production adapters/configuration are intact.
export async function createAdminConsolePreview({
  port: requestedPort = 4249,
  buildAssets = true,
  deliveryVerification,
  redesign = false,
  v3Integrated = false,
}: { port?: number; buildAssets?: boolean; deliveryVerification?: DeliveryVerification; redesign?: boolean; v3Integrated?: boolean } = {}) {
  if ((redesign && !buildAssets) || (redesign && deliveryVerification && !v3Integrated) || (v3Integrated && (!redesign || !deliveryVerification)))
    throw Error("The V3 integration requires a redesigned local preview and a private slider service.");
  await mkdir(localRoot, { recursive: true });
  const directory = await mkdtemp(resolve(localRoot, "admin-console-preview-"));
  const child = fork(
    fileURLToPath(import.meta.url),
    [
      "--preview-child",
      directory,
      String(requestedPort),
      buildAssets ? "1" : "0",
      redesign ? "1" : "0",
      v3Integrated ? "1" : "0",
    ],
    {
      cwd: repository,
      execPath: process.execPath,
      execArgv: [],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
      env: { ...process.env, SANSPHASE_ADMIN_DELIVERY_VERIFICATION: JSON.stringify(deliveryVerification || null) },
    },
  );
  let output = "",
    failure = "",
    exited = false,
    closing: Promise<void> | undefined;
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk) => {
      output = (output + String(chunk)).slice(-8000);
    });
  const finished = new Promise<number | null>((done) =>
    child.once("close", (code) => {
      exited = true;
      done(code);
    }),
  );
  const started = new Promise<PreviewReady>((done, reject) => {
    child.once("error", reject);
    child.on("message", (message) => {
      if (!message || typeof message !== "object" || !("type" in message))
        return;
      if (message.type === "ready") done(message as PreviewReady);
      if (message.type === "failed" && "message" in message) {
        failure = String(message.message);
        reject(Error(failure));
      }
    });
    void finished.then((code) =>
      reject(
        Error(
          failure || `Local preview exited before startup (${code}). ${output}`,
        ),
      ),
    );
  });
  function close(): Promise<void> {
    return (closing ??= (async () => {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 15000);
      if (!exited && child.connected)
        child.send({ type: "close" }, (error) => {
          if (error) {
            failure ||= error.message;
            child.kill("SIGKILL");
          }
        });
      const code = await finished;
      clearTimeout(timeout);
      const errors: unknown[] = [];
      if (timedOut || code !== 0 || failure)
        errors.push(
          Error(
            failure ||
              (timedOut
                ? "Local preview did not close within 15 seconds. Its child process was stopped."
                : `Local preview process failed (${code}). ${output}`),
          ),
        );
      try {
        await cleanupAdminConsoleDirectory(directory);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(errors, "Local preview shutdown failed.");
    })());
  }
  const startupTimeout = setTimeout(() => {
    failure = "Local preview did not start within 150 seconds.";
    child.kill("SIGKILL");
  }, 150000);
  try {
    const ready = await started;
    return {
      origin: ready.origin,
      address: ready.address,
      directory,
      fixtures: ready.fixtures,
      close,
    };
  } catch (error) {
    const errors = [error];
    try {
      await close();
    } catch (closeError) {
      errors.push(closeError);
    }
    throw Object.assign(
      new AggregateError(errors, "Local preview startup failed."),
      { previewDirectory: directory },
    );
  } finally {
    clearTimeout(startupTimeout);
  }
}

async function runAdminConsolePreview({
  directory,
  port: requestedPort,
  buildAssets,
  deliveryVerification,
  redesign,
  v3Integrated,
}: {
  directory: string;
  port: number;
  buildAssets: boolean;
  deliveryVerification?: DeliveryVerification;
  redesign: boolean;
  v3Integrated: boolean;
}) {
  const hostname = v3Integrated ? "localhost" : "127.0.0.1";
  const port = await availablePort(requestedPort, hostname),
    origin = `http://${hostname}:${port}`;
  const actual = await realpath(directory),
    root = await realpath(localRoot);
  if (
    actual !== resolve(root, basename(directory)) ||
    !/^admin-console-preview-[^\\/]+$/.test(relative(root, actual))
  )
    throw Error("Unsafe local preview child directory.");
  const dataDirectory = resolve(directory, "data"),
    publicDirectory = resolve(directory, "public");
  let payload: Payload | undefined;
  let uidStore: ReturnType<typeof createReaderUidStore> | undefined;
  let loginLedger: ReturnType<typeof createLoginLedger> | undefined;
  let server: ReturnType<typeof createPreviewServer> | undefined;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return (closing ??= (async () => {
      const errors: unknown[] = [];
      try {
        if (server?.listening)
          await new Promise<void>((done, reject) =>
            server!.close((error) => (error ? reject(error) : done())),
          );
      } catch (error) {
        errors.push(error);
      }
      for (const closeDatabase of [
        () => loginLedger?.close(),
        () => uidStore?.close(),
        async () => {
          if (!payload) return;
          try {
            await payload.destroy();
          } finally {
            (payload.db as unknown as SQLiteAdapter).client.close();
          }
        },
      ]) {
        try {
          await closeDatabase();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "Local preview resources did not close cleanly: " +
            errors.map(String).join("; "),
        );
    })());
  }
  try {
    await mkdir(dataDirectory);
    await mkdir(publicDirectory);
    if (buildAssets) {
      // Rebuild the actual visitor/reader UI from the canonical sources into
      // this preview's empty directory. Never use a running dist or live CDN.
      await run(
        process.execPath,
        [resolve(repository, "scripts/build-cosmos.mjs"), publicDirectory],
        {
          cwd: repository,
          env: { ...process.env, SANSPHASE_SCENE_CDN_ORIGIN: "" },
          timeout: 120000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        },
      );
      await buildAdminConsole(publicDirectory, { preview: redesign || !deliveryVerification, redesign, v3Integrated });
    }
    const secret = randomBytes(48).toString("hex");
    payload = await getPayload({
      key: directory,
      config: makePayloadConfig({
        directory: dataDirectory,
        secret,
        siteOrigin: origin,
        push: true,
      }),
    });
    const db = new DatabaseSync(resolve(dataDirectory, "content.db"));
    try {
      db.exec(readerUidsTableSql);
      db.exec(readerUidsTriggerSql);
      db.exec(loginEventsSchema);
    } finally {
      db.close();
    }
    uidStore = createReaderUidStore(dataDirectory);
    loginLedger = createLoginLedger(dataDirectory);
    const workflow = createReaderWorkflow(dataDirectory, secret);
    const loginVerification = createLoginVerification({
      directory: dataDirectory, siteOrigin: origin, workflow,
      settings: readLoginVerificationSettings(deliveryVerification ? {
        enabled: true, engine: 'tianai', ...deliveryVerification,
        hmacSecret: randomBytes(48).toString('hex'), keySecret: randomBytes(48).toString('hex'),
      } : undefined, secret),
    });
    const fixtures = await seedAdminConsolePreview(
      payload,
      dataDirectory,
      workflow,
      uidStore,
      { includeManagementExamples: redesign },
    );
    const store = createPayloadStore(payload, {
      directory: dataDirectory,
      authorId: fixtures.ownerId,
    });
    const authorService = createAuthorService({
      url: origin,
      siteOrigin: origin,
      authorId: fixtures.ownerId,
      store,
      loginLedger,
      loginVerification,
    });
    const readerService = deliveryVerification ? createReaderService({
      payload, directory: dataDirectory, siteOrigin: origin, workflow, uidStore, loginLedger,
      authorService, loginVerification, profileCommands: fixtures.profiles,
    }) : undefined;
    const contentService = createContentService({ url: origin, store });
    const readerAdminService = createReaderAdminService({
      payload,
      authorService,
      directory: dataDirectory,
      siteOrigin: origin,
      authorId: fixtures.ownerId,
      uidStore,
      workflow,
      profileCommands: fixtures.profiles,
      loginLedger,
    });
    const serverOptions = {
      root: publicDirectory,
      authorService,
      contentService,
      readerAdminService,
      readerService,
      siteOrigin: origin,
      release: "local-admin-console",
      requestMiddleware: async (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => Promise<void>,
      ) => {
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        );
        if (
          !loopbacks.has(req.socket.remoteAddress || "") ||
          req.headers.host !== new URL(origin).host
        ) {
          res.writeHead(403);
          res.end("Local preview only.");
          return;
        }
        const url = new URL(req.url || "/", origin);
        if (deliveryVerification && !v3Integrated) {
          // Exercise the actual release shell, shared account login/slider and
          // canonical HTTP routes with synthetic data. Do not intercept author
          // navigation, inject login pages, or bypass verification in this mode.
          await next();
          return;
        }
        const privatePreview =
          url.searchParams.has("preview") ||
          url.searchParams.has("previewKind");
        const mainPreview =
          url.pathname === "/" &&
          (privatePreview || url.searchParams.get("mainPreview") === "1");
        // This local tool has no public reader runtime. Keep even published
        // synthetic VIP content and media behind the current author session.
        if (
          mainPreview ||
          url.pathname === "/api/content" ||
          url.pathname.startsWith("/api/media/")
        ) {
          if (!(await authorService.identityStrict(req))) {
            if (
              mainPreview &&
              !privatePreview &&
              ["GET", "HEAD"].includes(req.method || "")
            ) {
              res.writeHead(302, { Location: "/preview-login" });
              res.end();
              return;
            }
            res.writeHead(401, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(
              req.method === "HEAD"
                ? undefined
                : JSON.stringify({ error: "请先登录本地演示作者。" }),
            );
            return;
          }
        }
        if (url.pathname === "/" && req.method === "GET" && !mainPreview) {
          res.writeHead(302, { Location: "/preview-login" });
          res.end();
          return;
        }
        if (v3Integrated && url.pathname === "/preview-login" && ["GET", "HEAD"].includes(req.method || "")) {
          res.writeHead(302, { Location: "http://localhost:4308/account" });
          res.end();
          return;
        }
        const loginAssets = new Map([
          ["/preview-login", ["text/html; charset=utf-8", loginHtml]],
          ["/preview-login.js", ["text/javascript; charset=utf-8", loginJs(redesign ? "/admin-console/" : "/?mainPreview=1#/account")]],
          ["/preview-login.css", ["text/css; charset=utf-8", loginCss]],
        ]);
        const asset = v3Integrated ? undefined : loginAssets.get(url.pathname);
        if (asset && ["GET", "HEAD"].includes(req.method || "")) {
          res.writeHead(200, { "Content-Type": asset[0] });
          res.end(req.method === "HEAD" ? undefined : asset[1]);
          return;
        }
        if (
          url.pathname === "/admin-console" ||
          url.pathname === "/admin-console/" ||
          url.pathname === "/admin-console/index.html"
        ) {
          if (!(await authorService.identity(req))) {
            res.writeHead(302, { Location: "/preview-login" });
            res.end();
            return;
          }
          req.url = "/admin-console/index.html" + url.search;
        }
        await next();
      },
    };
    server = createPreviewServer(serverOptions);
    await new Promise<void>((done, reject) => {
      server!.once("error", reject);
      server!.listen(port, hostname, done);
    });
    return {
      server,
      origin,
      directory,
      fixtures: { ownerId: fixtures.ownerId, readers: fixtures.readers },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "--preview-child") {
    if (!process.send)
      throw Error("The local preview child requires its parent IPC channel.");
    let preview: Awaited<ReturnType<typeof runAdminConsolePreview>> | undefined;
    let stopRequested = false,
      stopping: Promise<void> | undefined;
    const finish = (code: number, message?: string) => {
      if (message && process.connected && process.send)
        process.send({ type: "failed", message }, () => process.exit(code));
      else process.exit(code);
    };
    function stop() {
      stopRequested = true;
      if (!preview) return;
      return (stopping ??= preview.close().then(
        () => finish(0),
        (error: unknown) =>
          finish(1, error instanceof Error ? error.message : String(error)),
      ));
    }
    process.on("message", (message) => {
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "close"
      )
        void stop();
    });
    process.once("disconnect", () => {
      void stop();
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void stop();
      });
    try {
      preview = await runAdminConsolePreview({
        directory: process.argv[3],
        port: Number(process.argv[4]),
        buildAssets: process.argv[5] === "1",
        redesign: process.argv[6] === "1",
        v3Integrated: process.argv[7] === "1",
        deliveryVerification: JSON.parse(process.env.SANSPHASE_ADMIN_DELIVERY_VERIFICATION || 'null') || undefined,
      });
      if (stopRequested) await stop();
      else {
        const address = preview.server.address();
        if (!address || typeof address === "string")
          throw Error("Local preview listener has no TCP address.");
        process.send({
          type: "ready",
          origin: preview.origin,
          address,
          fixtures: preview.fixtures,
        } satisfies PreviewReady);
      }
    } catch (error) {
      finish(1, error instanceof Error ? error.message : String(error));
    }
  } else {
    const v3Integrated = process.argv.includes("--v3");
    const deliveryVerification = v3Integrated ? {
      serviceOrigin: `http://127.0.0.1:${await availablePort(0)}`,
      serviceSecret: randomBytes(48).toString("hex"),
    } : undefined;
    const captcha = deliveryVerification ? await startCaptcha(deliveryVerification) : undefined;
    const preview = await createAdminConsolePreview(v3Integrated
      ? { port: 4315, redesign: true, v3Integrated, deliveryVerification }
      : process.argv.includes("--redesign") ? { port: 4251, redesign: true } : {},
    ).catch(async (error: unknown) => { await captcha?.close(); throw error; });
    console.log(`Admin console preview: ${preview.origin}/preview-login`);
    console.log(
      "Synthetic owner: owner@example.test; demo password: DemoLogin2026!",
    );
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void Promise.all([preview.close(), captcha?.close()]).then(
          () => process.exit(0),
          (error: unknown) => {
            console.error(
              error instanceof Error
                ? error.message
                : "Local preview close failed.",
            );
            process.exit(1);
          },
        );
      });
  }
}
