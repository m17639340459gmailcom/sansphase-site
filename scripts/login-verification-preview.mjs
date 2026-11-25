// Disposable synthetic accounts only. Never read a production/private config.
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { createPayloadStore } from '../server/payload/store.ts';
import { createAuthorService } from '../server/author-service.ts';
import { createReaderService } from '../server/reader-service.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderUidStore, readerUidsTableSql, readerUidsTriggerSql } from '../server/reader-uids.ts';
import { createLoginVerification, readLoginVerificationSettings } from '../server/login-verification.ts';
import { createPreviewServer } from '../server.mjs';

const port = Number(process.env.PORT || 4244);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local preview port.');
const siteOrigin = `http://127.0.0.1:${port}`;
const servicePort = Number(process.env.CAPTCHA_PREVIEW_PORT || 4253);
if (!Number.isInteger(servicePort) || servicePort < 1024 || servicePort > 65535 || servicePort === port) throw Error('Invalid private captcha preview port.');
const jar = resolve('server/login-captcha-service/target/login-captcha-service-1.0.0.jar');
await access(jar).catch(() => { throw Error('Build the verified captcha service first: pnpm captcha:build'); });
const serviceSecret = randomBytes(48).toString('hex');
const serviceOrigin = `http://127.0.0.1:${servicePort}`;
const javaHome = process.env.JAVA_HOME || (process.platform === 'win32' ? resolve('.local/runtime/captcha/jdk-21.0.12.1+1') : '');
const java = javaHome ? resolve(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const captcha = spawn(java, ['-Xms32m', '-Xmx192m', '-XX:ActiveProcessorCount=2', '-Djava.awt.headless=true', '-jar', jar], {
  env: { ...process.env, PORT: String(servicePort), CAPTCHA_SERVICE_SECRET: serviceSecret }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let serviceFailed = false;
captcha.once('error', () => { serviceFailed = true; });
captcha.once('exit', () => { serviceFailed = true; });
process.once('exit', () => captcha.kill());
try {
  let ready = false;
  const deadline = Date.now() + 20_000;
  while (!serviceFailed && Date.now() < deadline) {
    try { const response = await fetch(serviceOrigin + '/health', { headers: { Authorization: 'Bearer ' + serviceSecret }, signal: AbortSignal.timeout(1000) }); ready = response.ok && (await response.json()).ok === true; } catch { /* Wait for the private service to start. */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 250));
  }
  if (!ready) throw Error('Local captcha service did not become ready; production configuration was not used.');
} catch (error) { captcha.kill(); throw error; }
const previewRoot = resolve('.local');
await mkdir(previewRoot, { recursive: true });
const directory = await mkdtemp(resolve(previewRoot, 'login-verification-preview-'));
const secret = randomBytes(48).toString('hex');
const payload = await getPayload({ config: makePayloadConfig({ directory, secret, siteOrigin, push: true }) });
const db = new DatabaseSync(resolve(directory, 'content.db'));
try { db.exec(readerUidsTableSql); db.exec(readerUidsTriggerSql); } finally { db.close(); }
const owner = await payload.create({ collection: 'authors', data: {
  email: 'owner@example.test', password: 'DemoLogin2026!', first_name: '本地演示作者', role: 'owner',
} });
await payload.create({ collection: 'readers', disableVerificationEmail: true, data: {
  email: 'reader@example.test', password: 'DemoLogin2026!', nickname: '预览读者', _verified: true, disabled: false,
} });
const uidStore = createReaderUidStore(directory);
const workflow = createReaderWorkflow(directory, secret);
const loginVerification = createLoginVerification({ directory, siteOrigin, workflow,
  settings: readLoginVerificationSettings({ enabled: true, engine: 'tianai', serviceOrigin, serviceSecret,
    hmacSecret: randomBytes(48).toString('hex'), keySecret: randomBytes(48).toString('hex'),
  }, secret),
});
const authorService = createAuthorService({ url: siteOrigin, siteOrigin, authorId: String(owner.id),
  store: createPayloadStore(payload, { directory, authorId: String(owner.id) }), loginVerification,
});
const readerService = createReaderService({ payload, directory, siteOrigin, uidStore, workflow, authorService, loginVerification });
const contentService = { snapshot: async () => ({ data: {
  source: 'cms', profile: { name: '本地登录验证预览', signature: '仅使用演示账号，不连接线上账号或数据。', socialLinks: [] },
  announcements: [], notes: [], works: [], resources: [], software: [], 'resource-center': [],
} }) };
const server = createPreviewServer({ siteOrigin, contentService, authorService, readerService, release: 'local-slider-login-verification' });
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await new Promise(done => server.close(done));
  captcha.kill();
  uidStore.close(); await payload.destroy(); await payload.db.client.close();
  const inside = relative(previewRoot, directory);
  if (!inside || inside.startsWith('..') || resolve(directory) === previewRoot) throw Error('Unsafe preview cleanup path.');
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
server.listen(port, '127.0.0.1', () => {
  console.log(`Login verification preview: ${siteOrigin}/#/account`);
  console.log('Synthetic reader: reader@example.test; synthetic owner: owner@example.test; demo password: DemoLogin2026!');
});
server.on('error', async error => { console.error(error.message); await close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void close().then(() => process.exit(0)); });
