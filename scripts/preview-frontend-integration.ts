// Disposable, same-origin frontend integration. Do not import a private runtime
// or copy an existing content database: every record below is synthetic.
import { fork, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as reservePort, type AddressInfo } from 'node:net';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { getPayload, type Payload } from 'payload';
import type { SQLiteAdapter } from '@payloadcms/db-sqlite';
import { createPreviewServer } from '../server.mjs';
import { openFrontendV3 } from '../server/frontend-v3.ts';
import { makePayloadConfig } from '../server/payload/config.ts';
import { createPayloadStore } from '../server/payload/store.ts';
import { createPublicationRevision } from '../server/payload/publication-revision.ts';
import { createAuthorService } from '../server/author-service.ts';
import { createContentService } from '../server/content-service.ts';
import { createReaderService } from '../server/reader-service.ts';
import { createReaderAdminService } from '../server/reader-admin-service.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderUidStore, readerUidsTableSql, readerUidsTriggerSql } from '../server/reader-uids.ts';
import { loginEventsSchema } from '../server/payload/reader-migration.ts';
import { createLoginLedger } from '../server/login-ledger.ts';
import { buildAdminConsole } from './build-admin-console.ts';
import { seedFrontendIntegration, type FrontendIntegrationFixtures } from './fixtures/frontend-integration.ts';
import { escapeHTML } from '../src/core.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const localRoot = resolve(repository, '.local');
const loopbacks = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const run = promisify(execFile);
type PreviewReady = { type: 'ready'; origin: string; address: AddressInfo; fixtures: FrontendIntegrationFixtures };
type CapturedMail = { to: string; subject: string; html: string; text: string; capturedAt: string };
type PreviewMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void | Promise<void>) => Promise<void>;

async function openV2Preview(origin: string) {
  // V3 publications intentionally exclude the legacy frontend sources.
  const adapter = new URL('../previews/hero-upgrade/integration-server.ts', import.meta.url);
  const { createIntegrationMiddleware } = await import(adapter.href) as {
    createIntegrationMiddleware(options: { origin: string }): PreviewMiddleware;
  };
  return createIntegrationMiddleware({ origin });
}

async function availablePort(requested: number) {
  if (!Number.isInteger(requested) || (requested !== 0 && (requested < 1024 || requested > 65535))) throw Error('Invalid local integration port.');
  const server = reservePort();
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(requested, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Local integration has no TCP address.');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}

async function verifiedDirectory(directory: string) {
  const root = await realpath(localRoot), actual = await realpath(directory);
  if (actual !== resolve(root, basename(directory)) || !/^frontend-integration-[^\\/]+$/.test(relative(root, actual))) throw Error('Unsafe local integration directory.');
  return actual;
}

async function removePreviewDirectory(directory: string) {
  const target = await verifiedDirectory(directory);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await rm(target, { recursive: true, force: true, maxRetries: 0 }); return; }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (attempt < 2 && ['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'].includes(code)) { await delay((attempt + 1) * 100); continue; }
      throw Error(`本地联调临时目录未能清理，已保留：${target}`, { cause: error });
    }
  }
}

/** Run native SQLite in a child so Windows releases all handles before cleanup. */
export async function createFrontendIntegrationPreview({ port = 4286, buildAssets = true, frontend = 'v2', v3Dev = false, v3AppDirectory = resolve(repository, 'previews/frontend-v3') }: {
  port?: number; buildAssets?: boolean; frontend?: 'v2' | 'v3'; v3Dev?: boolean; v3AppDirectory?: string;
} = {}) {
  await mkdir(localRoot, { recursive: true });
  const directory = await mkdtemp(resolve(localRoot, 'frontend-integration-'));
  const appDirectory = resolve(v3AppDirectory);
  const child = fork(fileURLToPath(import.meta.url), ['--integration-child', directory, String(port), buildAssets ? '1' : '0', frontend, v3Dev ? '1' : '0', appDirectory], {
    // The Next route server resolves its manifests relative to the process directory.
    cwd: frontend === 'v3' ? appDirectory : repository,
    execPath: process.execPath, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let output = '', failure = '', exited = false, closing: Promise<void> | undefined;
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { output = (output + String(chunk)).slice(-12000); });
  const finished = new Promise<number | null>(done => child.once('close', code => { exited = true; done(code); }));
  const started = new Promise<PreviewReady>((done, reject) => {
    child.once('error', reject);
    child.on('message', message => {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      if (message.type === 'ready') done(message as PreviewReady);
      if (message.type === 'failed' && 'message' in message) { failure = String(message.message); reject(Error(failure)); }
    });
    void finished.then(code => reject(Error(failure || `Local integration exited before startup (${code}). ${output}`)));
  });
  const close = () => closing ??= (async () => {
    let forced = false;
    const deadline = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 15000);
    if (!exited && child.connected) child.send({ type: 'close' }, error => { if (error) { failure ||= error.message; child.kill('SIGKILL'); } });
    const code = await finished; clearTimeout(deadline);
    const errors: unknown[] = [];
    if (forced || code !== 0 || failure) errors.push(Error(failure || `Local integration shutdown failed (${code}). ${output}`));
    try { await removePreviewDirectory(directory); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Local integration shutdown failed.');
  })();
  const timeout = setTimeout(() => { failure = 'Local integration did not start within 150 seconds.'; child.kill('SIGKILL'); }, 150000);
  try {
    const ready = await started;
    return { origin: ready.origin, address: ready.address, directory, fixtures: ready.fixtures, close, diagnostics: () => output };
  } catch (error) {
    const errors = [error]; try { await close(); } catch (closeError) { errors.push(closeError); }
    throw new AggregateError(errors, 'Local integration startup failed.');
  } finally { clearTimeout(timeout); }
}

async function runFrontendIntegration(directory: string, requestedPort: number, buildAssets: boolean, frontendVersion: 'v2' | 'v3', v3Dev: boolean, v3AppDirectory: string) {
  await verifiedDirectory(directory);
  const port = await availablePort(requestedPort), origin = `http://127.0.0.1:${port}`;
  const dataDirectory = resolve(directory, 'data'), publicDirectory = buildAssets ? resolve(directory, 'public') : resolve(repository, 'dist');
  let payload: Payload | undefined, uidStore: ReturnType<typeof createReaderUidStore> | undefined, loginLedger: ReturnType<typeof createLoginLedger> | undefined;
  let revision: ReturnType<typeof createPublicationRevision> | undefined, server: ReturnType<typeof createPreviewServer> | undefined, closing: Promise<void> | undefined;
  let v3: Awaited<ReturnType<typeof openFrontendV3>> | undefined;
  const close = () => closing ??= (async () => {
    const errors: unknown[] = [];
    for (const operation of [
      async () => { if (server?.listening) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done())); },
      () => v3?.close(),
      () => revision?.close(), () => loginLedger?.close(), () => uidStore?.close(),
      async () => { if (payload) { try { await payload.destroy(); } finally { (payload.db as unknown as SQLiteAdapter).client.close(); } } },
    ]) { try { await operation(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Local integration resources did not close cleanly.');
  })();
  try {
    await mkdir(dataDirectory);
    if (buildAssets) {
      await mkdir(publicDirectory);
      await run(process.execPath, [resolve(repository, 'scripts/build-cosmos.mjs'), publicDirectory], { cwd: repository, env: { ...process.env, SANSPHASE_SCENE_CDN_ORIGIN: '' }, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      await buildAdminConsole(publicDirectory, frontendVersion === 'v3' ? { redesign: true, v3Integrated: true } : undefined);
      if (frontendVersion === 'v2') await run(process.execPath, [resolve(repository, 'previews/hero-upgrade/scripts/build.mjs')], { cwd: repository, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    }
    const messages: CapturedMail[] = [];
    const secret = randomBytes(48).toString('hex');
    payload = await getPayload({ key: directory, config: makePayloadConfig({ directory: dataDirectory, secret, siteOrigin: origin, push: true,
      emailAdapter: () => ({ name: 'local-integration-capture', defaultFromAddress: 'local@example.test', defaultFromName: 'SANSPHASE 本地联调', sendEmail: async message => {
        messages.push({ to: typeof message.to === 'string' ? message.to : JSON.stringify(message.to), subject: message.subject || '', html: String(message.html || ''), text: String(message.text || ''), capturedAt: new Date().toISOString() });
        if (messages.length > 100) messages.shift();
      } }),
    }) });
    const db = new DatabaseSync(resolve(dataDirectory, 'content.db'));
    try { db.exec(readerUidsTableSql); db.exec(readerUidsTriggerSql); db.exec(loginEventsSchema); } finally { db.close(); }
    uidStore = createReaderUidStore(dataDirectory); loginLedger = createLoginLedger(dataDirectory);
    const workflow = createReaderWorkflow(dataDirectory, secret);
    const fixtures = await seedFrontendIntegration(payload, uidStore);
    const store = createPayloadStore(payload, { directory: dataDirectory, authorId: fixtures.ownerId });
    const authorService = createAuthorService({ url: origin, siteOrigin: origin, authorId: fixtures.ownerId, store, loginLedger });
    const readerService = createReaderService({ payload, directory: dataDirectory, siteOrigin: origin, emailReady: true, authorService, uidStore, workflow, loginLedger });
    revision = createPublicationRevision(dataDirectory);
    const contentService = createContentService({ url: origin, store, revision: revision.read });
    const readerAdminService = createReaderAdminService({ payload, directory: dataDirectory, authorService, siteOrigin: origin, authorId: fixtures.ownerId, uidStore, workflow, loginLedger });
    if (frontendVersion === 'v3') {
      process.env.SANSPHASE_V3_SITE_BACKEND = origin;
      process.env.NEXT_PUBLIC_SITE_URL = origin;
      v3 = await openFrontendV3({ appDirectory: v3AppDirectory, origin, dev: v3Dev });
    }
    const frontend = v3?.middleware ?? await openV2Preview(origin);
    const serverOptions = { root: publicDirectory, siteOrigin: origin, authorService, readerService, readerAdminService, contentService, release: 'local-frontend-integration', mainFrontend: frontendVersion, requestMiddleware: async (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => {
      res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
      if (!loopbacks.has(req.socket.remoteAddress || '') || req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end('Local integration only.'); return; }
      const pathname = new URL(req.url || '/', origin).pathname;
      if (pathname === '/__local-test/mailbox' && ['GET', 'HEAD'].includes(req.method || '')) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ delivery: 'captured-locally', messages })); return;
      }
      if ((pathname === '/__local-test' || pathname === '/__local-test/') && ['GET', 'HEAD'].includes(req.method || '')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
        const accounts = ['reader@example.test（普通读者）', 'vip@example.test（有效会员）', 'expired@example.test（过期会员）', 'owner@example.test（作者）'];
        res.end(req.method === 'HEAD' ? undefined : `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地前端联调</title><style>body{max-width:800px;margin:64px auto;padding:24px;font:16px/1.8 system-ui;color:#172238;background:#f4f6fa}a{color:#334dff}code{background:#e7ebf4;padding:4px}li{margin:8px 0}</style><h1>新版前端 · 本地联调</h1><p>账号、内容与文件来自本次启动的独立临时数据库。没有连接线上数据库，也不会发送真实邮件。</p><p><a href="/">打开新前端</a> · <a href="/original#/account">原站账号入口</a> · <a href="/admin-console/">原作者管理</a> · <a href="/__local-test/mailbox">本地捕获邮件</a></p><ul>${accounts.map(account => `<li>${escapeHTML(account)}</li>`).join('')}</ul><p>统一测试密码：<code>DemoLogin2026!</code></p><p>测试注册建议使用 <code>任意名称@example.test</code>，验证码与密码重置邮件只出现在本地捕获邮件中。</p><p>登录验证滑块未在本地联调环境启用；账号密码、会话、内容访问、VIP 和作者权限均走原站真实服务。</p></html>`); return;
      }
      await frontend(req, res, next);
    } };
    server = createPreviewServer(serverOptions);
    await new Promise<void>((done, reject) => { server!.once('error', reject); server!.listen(port, '127.0.0.1', done); });
    return { server, origin, fixtures, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--integration-child') {
    if (!process.send) throw Error('Local integration child requires its parent IPC channel.');
    let runtime: Awaited<ReturnType<typeof runFrontendIntegration>> | undefined, stopped = false, stopping: Promise<void> | undefined;
    const finish = (code: number, message?: string) => {
      if (message && process.connected && process.send) process.send({ type: 'failed', message }, () => process.exit(code)); else process.exit(code);
    };
    function stop() { stopped = true; if (runtime) return stopping ??= runtime.close().then(() => finish(0), error => finish(1, error instanceof Error ? error.message : String(error))); }
    process.on('message', message => { if (message && typeof message === 'object' && 'type' in message && message.type === 'close') void stop(); });
    process.once('disconnect', () => { void stop(); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop(); });
    try {
      runtime = await runFrontendIntegration(process.argv[3], Number(process.argv[4]), process.argv[5] === '1', process.argv[6] === 'v3' ? 'v3' : 'v2', process.argv[7] === '1', process.argv[8]);
      if (stopped) await stop();
      else { const address = runtime.server.address(); if (!address || typeof address === 'string') throw Error('Local integration has no TCP listener.'); process.send({ type: 'ready', origin: runtime.origin, address, fixtures: runtime.fixtures } satisfies PreviewReady); }
    } catch (error) { finish(1, error instanceof Error ? error.message : String(error)); }
  } else {
    const frontend = process.argv.includes('--v3') ? 'v3' : 'v2';
    const runtime = await createFrontendIntegrationPreview({ frontend, v3Dev: frontend === 'v3' && process.argv.includes('--dev') });
    console.log(`新版前端本地联调：${runtime.origin}/\n测试账号与本地邮箱：${runtime.origin}/__local-test\n原站界面：${runtime.origin}/original#/home\n数据完全隔离，不读取线上或私有配置。`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void runtime.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
  }
}
