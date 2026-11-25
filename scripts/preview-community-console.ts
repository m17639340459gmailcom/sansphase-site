// Loopback-only demonstration. All accounts and content are synthetic and disposable.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as reservePort } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../server.mjs';
import { createCommunityDemo } from './fixtures/community-demo.mjs';
import { createCommunityPreviewService, previewIdentityPath } from './fixtures/community-preview-identity.ts';
import { makeReadingDemo } from './fixtures/reading-demo.mjs';
import { buildCommunityConsole } from './build-community-console.ts';
import { buildCompactCommunityArt } from './community-compact-art.ts';
import { buildCompactCommunityStaffArt } from './community-staff-compact-art.ts';
import { buildCommunityVipFrameArt } from './community-vip-frame-art.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));
const localRoot = resolve(repository, '.local');
const run = promisify(execFile);
const loopbacks = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

async function availablePort(requested: number) {
  if (!Number.isInteger(requested) || (requested !== 0 && (requested < 1024 || requested > 65535)))
    throw Error('Invalid community console preview port.');
  const reservation = reservePort();
  await new Promise<void>((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(requested, '127.0.0.1', done);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw Error('Preview port was not reserved.');
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  return address.port;
}

export async function cleanupCommunityConsoleDirectory(directory: string) {
  const root = await realpath(localRoot), actual = await realpath(directory);
  if (actual !== resolve(root, basename(directory)) || !/^community-console-preview-[^\\/]+$/.test(relative(root, actual)))
    throw Error('Unsafe community console preview cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export async function createCommunityConsolePreview({ port: requestedPort = 0, buildAssets = true }: { port?: number; buildAssets?: boolean } = {}) {
  const port = await availablePort(requestedPort);
  await mkdir(localRoot, { recursive: true });
  const directory = await mkdtemp(resolve(localRoot, 'community-console-preview-'));
  const publicDirectory = resolve(directory, 'public');
  const origin = `http://127.0.0.1:${port}`;
  let community: Awaited<ReturnType<typeof createCommunityDemo>> | undefined;
  let server: ReturnType<typeof createPreviewServer> | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (server?.listening) {
        const active = server;
        await new Promise<void>((done, reject) => {
          active.close(error => error ? reject(error) : done());
          active.closeIdleConnections();
        });
      }
    } finally {
      try { community?.close(); }
      finally { await cleanupCommunityConsoleDirectory(directory); }
    }
  };
  try {
    await mkdir(publicDirectory);
    if (buildAssets) {
      await run(process.execPath, [resolve(repository, 'scripts/build-cosmos.mjs'), publicDirectory], {
        cwd: repository, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, SANSPHASE_SCENE_CDN_ORIGIN: '' },
      });
      // The original community UI uses the same derived images as production.
      // A source-only build copies SVG originals but does not create these URLs.
      await buildCompactCommunityArt(publicDirectory);
      await buildCompactCommunityStaffArt(publicDirectory);
      await buildCommunityVipFrameArt(publicDirectory);
      await buildCommunityConsole(publicDirectory, { preview: true });
    } else {
      // HTTP-only tests explicitly skip rendering; no files are taken from dist.
      await mkdir(resolve(publicDirectory, 'community-console'));
      await writeFile(resolve(publicDirectory, 'index.html'), '<!doctype html><title>Synthetic community HTTP fixture</title>');
      await writeFile(resolve(publicDirectory, 'community-console/index.html'), '<!doctype html><title>Synthetic console HTTP fixture</title>');
    }
    community = await createCommunityDemo({ managementDemo: true });
    const data = { ...makeReadingDemo(), author: null, announcements: [], profile: {
      name: '無相', signature: '本地预演', bio: '原社区管理台本地预览；全部为合成数据。', socialLinks: [],
    } };
    const serverOptions = {
      root: publicDirectory, siteOrigin: origin, communityEnabled: true,
      contentService: { snapshot: async () => ({ data: structuredClone(data) }) },
      communityService: createCommunityPreviewService(community.service(port), port, { destination: 'console' }),
      readerService: community.readerService(port), authorService: community.authorService,
      release: 'local-community-console-preview',
      requestMiddleware: async (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        if (!loopbacks.has(req.socket.remoteAddress || '') || req.headers.host !== `127.0.0.1:${port}`) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('此预览仅允许本机固定地址访问。'); return;
        }
        let pathname: string;
        try { pathname = decodeURIComponent(new URL(req.url || '/', origin).pathname).replaceAll('\\', '/'); }
        catch { res.writeHead(400); res.end(); return; }
        const normalized = posix.normalize(pathname).toLowerCase();
        if (normalized === '/community-console' || normalized.startsWith('/community-console/')) {
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
          res.setHeader('Referrer-Policy', 'no-referrer');
          if (normalized === '/community-console' || normalized === '/community-console/') {
            if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
            if (normalized === '/community-console') { res.writeHead(302, { Location: '/community-console/' }); res.end(); return; }
            req.url = '/community-console/index.html';
          }
        }
        await next();
      },
    };
    server = createPreviewServer(serverOptions);
    await new Promise<void>((done, reject) => {
      server!.once('error', reject);
      server!.listen(port, '127.0.0.1', done);
    });
    return { origin, directory, publicDirectory, identityHref: `${origin}${previewIdentityPath}?theme=light`, consoleHref: `${origin}/?communityTheme=light#/community/manage/queue`, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await createCommunityConsolePreview({ port: Number(process.env.COMMUNITY_CONSOLE_PORT || 4250) });
  console.log(`原社区管理台本地预览：${preview.consoleHref}\nSynthetic roles: ${preview.identityHref}\nSwitching roles is shared between tabs; refresh other open preview tabs.`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void preview.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
  });
}
