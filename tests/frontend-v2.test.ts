import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { JSDOM } from 'jsdom';
import { createPreviewServer } from '../server.mjs';
import { createContentService } from '../server/content-service.ts';
import { createFrontendV2Middleware } from '../server/frontend-v2.ts';
import { packageStaticFiles } from '../scripts/static-package.mjs';
import { adminAuthorPanelHref, adminMainSiteHref } from '../src/admin-console-navigation.ts';

const origin = 'https://www.sansphase.example';

async function fixture(t: test.TestContext, { enabled = true, original = false, communityOnly = false, staticOrigin = null }: { enabled?: boolean; original?: boolean; communityOnly?: boolean; staticOrigin?: string | null } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'sansphase-frontend-v2-'));
  const generatedRoot = resolve(root, 'frontend-v2');
  await mkdir(resolve(generatedRoot, 'build'), { recursive: true });
  await Promise.all([
    writeFile(resolve(root, 'index.html'), '<html><head><title>Version 1</title></head><body><main id="main">original shell</main><script type="module" src="./app.mjs"></script></body></html>'),
    writeFile(resolve(root, 'styles.css'), 'original styles'),
    writeFile(resolve(root, 'book-reader.css'), 'original book reader styles'),
    writeFile(resolve(root, 'app.mjs'), 'export const original = true;'),
    mkdir(resolve(root, 'admin-console')).then(() => writeFile(resolve(root, 'admin-console/index.html'), '<!doctype html><html lang="zh-CN"><head><title>Console</title></head><body><div id="root"></div></body></html>')),
    writeFile(resolve(generatedRoot, 'index.html'), '<html><head><title>SANSPHASE · 成相交互演示</title><meta name="description" content="创作与记录，本地交互演示。"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/build/main-ABCDEFGH.css"></head><body class="is-loading"><header>V2 shell</header><main id="main"><section id="top"><div id="hero-stage"></div></section></main><footer class="footer"><a href="/third-party-notices.txt">Notices</a></footer><script type="module" src="/build/main-ABCDEFGH.js"></script></body></html>'),
    writeFile(resolve(generatedRoot, 'style.css'), 'version two styles'),
    writeFile(resolve(generatedRoot, 'build', 'main-ABCDEFGH.js'), 'export const version = 2;'),
    writeFile(resolve(generatedRoot, 'build', 'main-ABCDEFGH.css'), '@font-face{font-family:Fixture;src:url(./font-ABCDEFGH.woff2)}'),
    writeFile(resolve(generatedRoot, 'build', 'photoswipe.esm-ABCDEFGH.js'), 'export const viewer = true;'),
    writeFile(resolve(generatedRoot, 'build', 'font-ABCDEFGH.woff2'), Buffer.from([0, 1, 2, 3])),
    writeFile(resolve(generatedRoot, 'build', 'private.map'), 'SOURCE_MAP_PRIVATE'),
    writeFile(resolve(generatedRoot, 'third-party-notices.txt'), 'maintained dependencies'),
  ]);
  if (staticOrigin !== null) await packageStaticFiles(root, staticOrigin);
  let published = true, revision = 0, held: { entered(): void; wait: Promise<void> } | undefined;
  const service = createContentService({ url: origin, revision: () => revision, store: {
    publicData: async () => [[
      { id: 'article-record', slug: 'public-entry', status: published ? 'published' : 'archived', title: 'A verified public article', summary: 'Same original content service', body: '<h2>Published heading</h2><p>VERIFIED_ARTICLE_BODY</p>', published_at: '2026-01-01T00:00:00Z' },
      { id: 'draft-record', slug: 'draft-entry', status: 'draft', title: 'Draft', body: 'PRIVATE_DRAFT_BODY' },
      { id: 'future-record', slug: 'future-entry', status: 'published', title: 'Scheduled', body: 'PRIVATE_FUTURE_BODY', published_at: '2999-01-01T00:00:00Z' },
    ], { name: '無相' }, [], [
      { id: 'work-record', slug: 'private-work', kind: 'works', status: 'published', title: 'Member project', body: 'MEMBER_PROJECT_BODY' },
      { id: 'book-record', slug: 'vip-book', kind: 'resource-center', status: 'published', title: 'VIP Book', body: '<h2>Chapter</h2><p>PRIVATE_VIP_BODY</p>', vip_only: true },
    ]],
    preview: async () => { throw Object.assign(Error('Original preview permissions'), { status: 401 }); },
    readMedia: async () => new Response('media'),
  } as unknown as NonNullable<Parameters<typeof createContentService>[0]['store']> });
  const server = createPreviewServer({ root, siteOrigin: origin, contentService: service, communityOnly, mainFrontend: enabled ? 'v2' : 'v1',
    requestMiddleware: enabled ? createFrontendV2Middleware({ origin, generatedRoot, allowOriginal: original }) : undefined,
    authorService: { identity: async () => { if (held) { const state = held; held = undefined; state.entered(); await state.wait; } return null; } },
    readerService: { registrationEnabled: true, identity: async (req: { headers: { cookie?: string } }) => req.headers.cookie === 'member=1' ? { name: 'Member', vip: false } : req.headers.cookie === 'vip=1' ? { name: 'VIP', vip: true } : null,
      handle: async (_req: unknown, res: { setHeader(name: string, value: string): void; end(body: string): void }) => { res.setHeader('Content-Type', 'application/json'); res.end('{"originalReaderAPI":true}'); } },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); });
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    get: (path: string, init: RequestInit = {}) => new Promise<Response>((done, reject) => {
      // Node fetch deliberately owns Host; use the HTTP client to exercise the
      // actual reverse-proxy Host contract rather than an ignored fetch header.
      const req = request(local + path, { method: init.method || 'GET', headers: { Host: new URL(origin).host, ...init.headers } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => done(new Response(init.method === 'HEAD' || [204, 205, 304].includes(res.statusCode!) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers as Record<string, string> })));
      });
      req.on('error', reject); req.end();
    }),
    withdraw() { published = false; revision++; },
    holdIdentity() { let entered!: () => void, release!: () => void; const arrived = new Promise<void>(done => { entered = done; }); const wait = new Promise<void>(done => { release = done; }); held = { entered, wait }; return { arrived, release }; },
  };
}

test('the production entry stays on V1 until V2 is explicitly mounted', async t => {
  const v1 = await fixture(t, { enabled: false });
  const html = await (await v1.get('/')).text();
  assert.match(html, /original shell/); assert.doesNotMatch(html, /site-integration/);
  assert.match(await (await v1.get('/index.html')).text(), /original shell/);
  assert.equal((await v1.get('/learning')).status, 404);
  assert.equal((await v1.get('/frontend-v2/index.html')).status, 404, 'building both versions must not enable an unmarked V2 entry');
});

test('production V2 canonicalizes the legacy homepage filename before client route parsing', async t => {
  const v2 = await fixture(t);
  const search = '?source=existing-link&returnTo=%2Fresources';
  for (const path of ['/index.html', '/%69ndex.html']) for (const method of ['GET', 'HEAD']) {
    const response = await v2.get(path + search, { method });
    assert.equal(response.status, 308, `${method} ${path}`);
    assert.equal(response.headers.get('location'), '/' + search);
    assert.equal(await response.text(), '');
  }
  assert.equal((await v2.get('/index.html', { method: 'POST' })).status, 405);
});

test('V2 rollback temporarily redirects known V3 page URLs to their existing V2 equivalents', async t => {
  const v2 = await fixture(t);
  const cases = [
    ['/about', '/blog'], ['/en/about/', '/blog'], ['/en', '/'], ['/en/', '/'],
    ['/projects', '/work'], ['/projects/private-work', '/work/private-work'],
    ['/en/projects/private-work', '/work/private-work'], ['/en/work/private-work', '/work/private-work'],
    ['/en/blog', '/blog'], ['/en/blog/public-entry', '/blog/public-entry'],
    ['/en/learning', '/learning'], ['/en/learning/lesson', '/learning/lesson'],
    ['/en/software', '/software'], ['/en/software/tool', '/software/tool'],
    ['/en/resources', '/resources'], ['/en/resources/vip-book', '/resources/vip-book'],
    ['/resources/vip-book/chapter_01', '/resources/vip-book'], ['/en/resources/vip-book/chapter-02', '/resources/vip-book'],
    ['/en/community', '/community'], ['/en/contact', '/contact'], ['/en/support', '/support'],
    ['/en/account', '/account'], ['/en/verify', '/verify'], ['/en/verify/old-id', '/verify/old-id'],
    ['/en/reset', '/reset'], ['/en/reset/example_reset_token-01', '/reset/example_reset_token-01'],
  ];
  const search = '?from=v3&tag=one&tag=two&topic=first%20item';
  for (const [path, destination] of cases) {
    for (const method of ['GET', 'HEAD']) {
      const response = await v2.get(path + search, { method });
      assert.equal(response.status, 302, `${method} ${path}`);
      // Omitting the hash lets the browser retain #blog or a reading anchor.
      assert.equal(response.headers.get('location'), destination + search, path);
      assert.match(response.headers.get('cache-control') || '', /private, no-store/);
      assert.equal(await response.text(), '');
      if (/^\/(account|verify|reset)(?:\/|$)/.test(destination)) {
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      }
    }
  }
  assert.equal((await v2.get('/en/about', { method: 'POST' })).status, 405);
  assert.equal((await v2.get('/en/about', { headers: { Host: 'untrusted.example' } })).status, 403);
  for (const path of ['/about/missing', '/projects/a%2Fb', '/projects/a/b', '/en//about', '/en/admin-console', '/en/api/content', '/en/community/post/one', '/en/learn/fde', '/en/book-preview/vip-book', '/resources/vip-book/one/two']) {
    const response = await v2.get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('location'), null);
  }
  assert.match(await (await v2.get('/blog/public-entry')).text(), /VERIFIED_ARTICLE_BODY/);
  assert.equal((await v2.get('/blog/draft-entry')).status, 404);
  assert.equal((await v2.get('/api/content?view=detail&kind=resource-center&id=vip-book', { headers: { Cookie: 'member=1' } })).status, 403);
});

test('V2 rollback keeps known V3 sign-in return destinations inside the existing frontend', async t => {
  const v2 = await fixture(t);
  const transfer = '&tag=first%20item&tag=second';
  const returning = (key: 'return' | 'returnTo', destination: string) => `${key}=${encodeURIComponent(destination)}${transfer}`;
  const cases = [
    ['/account', 'returnTo', '/community', '/community'],
    ['/en/account', 'returnTo', '/en/projects/private-work?from=login#info', '/work/private-work?from=login#info'],
    ['/verify', 'return', '/en/about#blog', '/blog#blog'],
    ['/reset', 'returnTo', '/en/resources/vip-book/chapter-2', '/resources/vip-book'],
  ] as const;
  for (const [path, key, destination, equivalent] of cases) {
    const response = await v2.get(`${path}?${returning(key, destination)}`);
    assert.equal(response.status, 302, path);
    const location = response.headers.get('location');
    assert.equal(location, `${path.replace(/^\/en/, '')}?${returning('return', equivalent)}`, path);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await v2.get(location!)).status, 200, 'converted destination requires only one redirect');
  }
  for (const destination of ['//outside.example/x', 'https://outside.example/x', '/en/api/content', '/admin-console', '/account', '/original', '/learning?preview=draft', '/#/admin', '/en/projects/a%2Fb', '/en/projects/../about']) {
    const response = await v2.get(`/account?${returning('returnTo', destination)}`);
    assert.equal(response.status, 200, destination);
    assert.equal(response.headers.get('location'), null);
  }
  assert.equal((await v2.get('/account?return=%2Fcommunity&returnTo=%2Fsoftware')).status, 200, 'ambiguous returns are not rewritten');
  assert.equal((await v2.get('/account?return=%2Fcommunity')).status, 200, 'V2 return stays canonical');
});

test('V2 keeps the existing loopback health probe without accepting a loopback application host', async t => {
  const v2 = await fixture(t);
  for (const Host of ['127.0.0.1:4176', 'localhost:4176', '[::1]:4176']) {
    const health = await v2.get('/healthz', { headers: { Host } });
    assert.equal(health.status, 200, Host);
    assert.deepEqual(await health.json(), { status: 'ok', release: 'development' });
    const head = await v2.get('/healthz?probe=ready', { method: 'HEAD', headers: { Host } });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    for (const path of ['/', '/account', '/api/reader/login', '/healthz/']) {
      assert.equal((await v2.get(path, { headers: { Host } })).status, 403, path);
    }
    assert.equal((await v2.get('/healthz', { method: 'POST', headers: { Host } })).status, 403);
  }
  assert.equal((await v2.get('/healthz', { headers: { Host: 'untrusted.example' } })).status, 403);
});

test('a remote request cannot use the loopback health probe Host exception', async () => {
  const middleware = createFrontendV2Middleware({ origin, generatedRoot: '/unused-health-probe-fixture' });
  let status = 0, delegated = false;
  const req = { method: 'GET', url: '/healthz', headers: { host: '127.0.0.1:4176' }, socket: { remoteAddress: '203.0.113.10' } } as unknown as IncomingMessage;
  const res = { writeHead(code: number) { status = code; }, end() {} } as unknown as ServerResponse;
  await middleware(req, res, () => { delegated = true; });
  assert.equal(status, 403); assert.equal(delegated, false);
});

test('production V2 preserves retained snapshot and CDN URLs through the shell and article SSR', async t => {
  for (const staticOrigin of ['', 'https://static.sansphase.example']) {
    const v2 = await fixture(t, { original: true, staticOrigin });
    for (const route of ['/', '/blog/public-entry', '/original']) {
      const response = await v2.get(route); assert.equal(response.status, 200);
      const dom = new JSDOM(await response.text());
      try {
        const doc = dom.window.document, base = doc.documentElement.dataset.staticBase!;
        assert.match(base, /^((https:\/\/static\.sansphase\.example)?\/assets\/site\/[a-f0-9]{24}\/)$/);
        assert.ok(!base.endsWith('frontend-v2/'), 'the original Reader resolves book-reader.css at the snapshot root');
        const script = doc.querySelector<HTMLScriptElement>('script[type="module"]')!.getAttribute('src')!;
        assert.ok(script.startsWith(base + (route === '/original' ? 'app.mjs' : 'frontend-v2/build/')));
        if (route !== '/original') {
          assert.ok(doc.querySelector(`link[href="${base}frontend-v2/style.css"]`));
          assert.ok(doc.querySelector(`link[href="${base}frontend-v2/build/main-ABCDEFGH.css"]`));
        }
        if (route.startsWith('/blog/')) assert.match(doc.querySelector('#site-article-static')!.textContent!, /VERIFIED_ARTICLE_BODY/);
        const asset = await v2.get(new URL(script, origin).pathname);
        assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type')!, /javascript/);
        assert.match(asset.headers.get('cache-control')!, /immutable/);
        const font = await v2.get(new URL(base + 'frontend-v2/build/font-ABCDEFGH.woff2', origin).pathname);
        assert.equal(font.status, 200); assert.equal(font.headers.get('content-type'), 'font/woff2');
        assert.deepEqual(Buffer.from(await font.arrayBuffer()), Buffer.from([0, 1, 2, 3]));
        const readerStyle = await v2.get(new URL(base + 'book-reader.css', origin).pathname);
        assert.equal(await readerStyle.text(), 'original book reader styles');
        for (const name of ['index.html', 'build-manifest.json', 'build/private.map']) assert.equal((await v2.get(new URL(base + 'frontend-v2/' + name, origin).pathname)).status, 404);
      } finally { dom.window.close(); }
    }
  }
});

test('production V2 keeps the original bounded bootstrap and uses a real production marker', async t => {
  const v2 = await fixture(t);
  for (const path of ['/', '/blog', '/work', '/learning', '/software', '/resources', '/community', '/contact', '/support', '/account', '/verify/token', '/reset/token']) {
    const response = await v2.get(path); assert.equal(response.status, 200, path);
    const dom = new JSDOM(await response.text());
    try {
      const doc = dom.window.document;
      assert.deepEqual(JSON.parse(doc.querySelector('#site-integration')!.textContent!), { mode: 'production', origin, frontendVersion: 2, originalVersion: 1 });
      assert.equal(doc.querySelector('link[href="/frontend-v2/style.css"]')?.getAttribute('rel'), 'stylesheet');
      const content = JSON.parse(doc.querySelector('#site-content')!.textContent!);
      assert.equal(content.delivery, 'paged-v1'); assert.deepEqual(content.notes, []);
      assert.deepEqual(content.works, []); assert.deepEqual(content['resource-center'], []);
    } finally { dom.window.close(); }
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    if (/^\/(account|verify|reset)/.test(path)) { assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); }
  }
  assert.equal((await v2.get('/learning', { method: 'HEAD' })).status, 200);
  assert.equal(await (await v2.get('/learning', { method: 'HEAD' })).text(), '');
  assert.equal((await v2.get('/learning', { method: 'POST' })).status, 405);
  for (const path of ['/unknown-route', '/learning/a/extra', '/frontend-v2/index.html', '/frontend-v2/build-manifest.json', '/build/private.map', '/build/a%2Fprivate.js']) assert.equal((await v2.get(path)).status, 404, path);
});

test('V2 article cold loads keep original publication checks, canonical metadata and the mounted app DOM', async t => {
  const v2 = await fixture(t);
  const response = await v2.get('/blog/public-entry'); assert.equal(response.status, 200);
  const dom = new JSDOM(await response.text());
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), origin + '/blog/public-entry');
    assert.match(doc.querySelector('#site-article-static .article-body')?.textContent || '', /VERIFIED_ARTICLE_BODY/);
    assert.equal(doc.querySelectorAll('#site-article-static').length, 1);
    assert.ok(doc.querySelector('#main #top #hero-stage'), 'SSR must not delete the original V2 DOM needed by mountHero');
    assert.equal(doc.body.dataset.staticArticle, '');
    assert.deepEqual(JSON.parse(doc.querySelector('#site-content')!.textContent!).articleEntry, { id: 'public-entry' });
    assert.equal(doc.querySelectorAll('title').length, 1);
    assert.doesNotMatch(doc.documentElement.outerHTML, /PRIVATE_DRAFT_BODY|PRIVATE_FUTURE_BODY|MEMBER_PROJECT_BODY|PRIVATE_VIP_BODY/);
  } finally { dom.window.close(); }
  for (const path of ['/blog/missing', '/%62log/missing', '/%62log/public-entry', '/blog/draft-entry', '/blog/future-entry', '/blog/a%2Fb', '/blog/%E0%A4%A', '/blog/public-entry/extra', '/blog/public-entry?preview=private']) assert.equal((await v2.get(path)).status, 404, path);
  v2.withdraw();
  assert.equal((await v2.get('/blog/public-entry', { headers: { 'If-None-Match': '*' } })).status, 404);
});

test('V2 cannot serve an article withdrawn while request identity was resolving', async t => {
  const v2 = await fixture(t), hold = v2.holdIdentity();
  const pending = v2.get('/blog/public-entry'); await hold.arrived; v2.withdraw(); hold.release();
  const response = await pending; assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /VERIFIED_ARTICLE_BODY|articleEntry/);
});

test('V2 reuses member, VIP, reader API, robots and sitemap policies', async t => {
  const v2 = await fixture(t);
  assert.equal((await v2.get('/api/content?view=list&kind=works&public=1')).status, 401);
  assert.equal((await v2.get('/api/content?view=detail&kind=resource-center&id=vip-book', { headers: { Cookie: 'member=1' } })).status, 403);
  const member = await v2.get('/api/content?view=detail&kind=works&id=private-work', { headers: { Cookie: 'member=1' } });
  assert.equal(member.status, 200); assert.match(await member.text(), /MEMBER_PROJECT_BODY/);
  const vip = await v2.get('/api/content?view=detail&kind=resource-center&id=vip-book', { headers: { Cookie: 'vip=1' } }); assert.equal(vip.status, 200);
  assert.deepEqual(await (await v2.get('/api/reader/login', { method: 'POST' })).json(), { originalReaderAPI: true });
  assert.match(await (await v2.get('/robots.txt')).text(), /Sitemap:/);
  const sitemap = await (await v2.get('/sitemap.xml')).text(); assert.ok(sitemap.includes(origin + '/blog/public-entry')); assert.doesNotMatch(sitemap, /draft-entry|future-entry|private-work/);
});

test('the optional original entry preserves V1 assets while V2 assets remain isolated and revalidated', async t => {
  const disabled = await fixture(t); assert.equal((await disabled.get('/original')).status, 404); assert.equal((await disabled.get('/v1')).status, 404);
  const v2 = await fixture(t, { original: true });
  const html = await (await v2.get('/original')).text(); assert.match(html, /original shell/); assert.doesNotMatch(html, /site-integration/);
  assert.match(html, /data-frontend-entry="original"/);
  assert.equal(await (await v2.get('/styles.css')).text(), 'original styles');
  assert.equal(await (await v2.get('/frontend-v2/style.css')).text(), 'version two styles');
  assert.equal((await v2.get('/v1', { redirect: 'manual' })).headers.get('location'), '/original');
  const asset = await v2.get('/build/main-ABCDEFGH.js'); assert.match(asset.headers.get('cache-control') || '', /immutable/);
  assert.equal(await (await v2.get('/build/photoswipe.esm-ABCDEFGH.js')).text(), 'export const viewer = true;');
  assert.equal((await v2.get('/build/main-ABCDEFGH.js', { headers: { 'If-None-Match': asset.headers.get('etag')! } })).status, 304);
  assert.equal((await v2.get('/account', { headers: { Host: 'untrusted.example' } })).status, 403);
});

test('original entry aliases canonicalize before serving relative V1 assets and preserve the query', async t => {
  const disabled = await fixture(t);
  const v2 = await fixture(t, { original: true });
  const search = '?returnTo=%2Fblog%2Fpublic-entry&tag=one&tag=two';
  for (const path of ['/original/', '/%6friginal', '/orig%69nal/', '/original%2F']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await v2.get(path + search, { method });
      assert.equal(response.status, 308, `${method} ${path}`);
      assert.equal(response.headers.get('location'), '/original' + search);
      assert.equal(await response.text(), '');
      assert.equal((await disabled.get(path + search, { method })).status, 404);
    }
  }
  const response = await v2.get('/original' + search);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /data-frontend-entry="original"/);
  assert.equal((await v2.get('/original/', { method: 'POST' })).status, 405);
  // A redirect Location with no fragment leaves the existing #/blog/... state
  // to the browser instead of replacing or exposing that client-only state.
  assert.equal((await v2.get('/original/' + search)).headers.get('location')!.includes('#'), false);
});

test('the same production console follows the active V1/V2 runtime without transferring console queries or bypassing account identity', async t => {
  const consoleURL = origin + '/admin-console/?adminReturn=memberships&return=https://outside.test#/readers?filter=private';
  for (const enabled of [false, true]) {
    const app = await fixture(t, { enabled, original: enabled });
    const shell = await app.get('/admin-console/?mainFrontend=v2&authorPanel=https://outside.test');
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('cache-control')!, /private, no-store/);
    assert.match(shell.headers.get('content-security-policy')!, /script-src 'self'/);
    const shellHTML = await shell.text();
    const marker = new JSDOM(shellHTML).window.document.documentElement.dataset.mainFrontend;
    assert.equal(marker, enabled ? 'v2' : 'v1', 'query parameters cannot choose the runtime marker');
    const head = await app.get('/admin-console/', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(shellHTML));
    const ranged = await app.get('/admin-console/index.html', { headers: { Range: 'bytes=0-15' } });
    assert.equal(ranged.status, 200, 'runtime HTML cannot be served as a partial unmodified file');
    assert.equal(await ranged.text(), shellHTML);
    const home = new URL(adminMainSiteHref(), consoleURL);
    const author = new URL(adminAuthorPanelHref(false, marker), consoleURL);
    assert.equal(home.href, origin + '/');
    assert.equal(author.href, origin + (enabled ? '/original#/account' : '/#/account'));
    const homeResponse = await app.get(home.pathname + home.search);
    assert.equal(homeResponse.status, 200);
    const homeDoc = new JSDOM(await homeResponse.text()).window.document;
    assert.equal(Boolean(homeDoc.querySelector('#site-integration')), enabled);
    const authorResponse = await app.get(author.pathname + author.search);
    assert.equal(authorResponse.status, 200);
    const doc = new JSDOM(await authorResponse.text()).window.document;
    assert.equal(doc.documentElement.dataset.frontendEntry, enabled ? 'original' : undefined);
    assert.equal(doc.querySelector('#site-integration'), null);
    const content = JSON.parse(doc.querySelector('#site-content')!.textContent!);
    assert.equal(content.author, null, 'the account entry does not grant an anonymous visitor author identity');
    assert.equal(content.reader, null);
  }
});

test('V2 preserves author preview permission handling and cannot take over a community-only host', async t => {
  const v2 = await fixture(t), original = await fixture(t, { enabled: false });
  const preview = await v2.get('/?preview=draft-record');
  assert.equal(preview.status, (await original.get('/?preview=draft-record')).status);
  assert.equal(preview.status, 403); assert.doesNotMatch(await preview.text(), /site-integration/);
  const community = await fixture(t, { communityOnly: true });
  for (const path of ['/', '/blog/public-entry', '/learning', '/sitemap.xml']) assert.equal((await community.get(path)).status, 404, path);
});
