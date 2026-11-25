import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createPreviewServer } from '../server.mjs';
import { createContentService } from '../server/content-service.ts';

const origin = 'https://www.sansphase.com';
const image = '12345678-1234-1234-1234-123456789012';
const title = '公开文章 "标题" <script>不是脚本</script>';
const summary = '简介 </script><script>危险</script> & "引号"';

async function fixture(t: test.TestContext, options: { communityOnly?: boolean; cdn?: boolean; music?: boolean; code?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'sansphase-blog-seo-'));
  let template = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  if (options.cdn) template = template.replace('<html ', '<html data-static-base="https://static.example/assets/site/123/" ')
    .replace('src="./app.mjs?v=0.101"', 'src="https://static.example/assets/site/123/app.mjs"');
  await writeFile(resolve(root, 'index.html'), template);
  t.after(() => rm(root, { recursive: true, force: true }));
  let status = 'published', version = 0, broken = false, previews = 0, edited = false;
  let identityWait: { entered: () => void; block: Promise<void> } | undefined;
  const service = createContentService({ url: origin, revision: () => version,
    store: {
      publicData: async () => {
        if (broken) throw Error('Database temporarily unavailable');
        return [[
          { id: 'db-record', slug: 'hello-world', status, title: edited ? '更新后的标题' : title, summary, category: '随笔', tags: ['公开'],
            body: edited ? '<h2>新版正文</h2><p>更新后的完整正文</p>' : '<h2>正文标题</h2><p>可以直接阅读的完整正文。</p><script>window.BAD=1</script>' + (options.code ? '<blockquote><pre><code>const text = &quot;**原样保留**&quot;;\nnext(&lt;value&gt;)</code></pre></blockquote><pre>plain\ncode</pre>' : ''), cover: image,
            published_at: '2026-01-01T00:00:00.000Z' },
          { id: 'draft-record', slug: 'draft-post', status: 'draft', title: '草稿', body: 'PRIVATE_DRAFT' },
          { id: 'future-record', slug: 'future-post', status: 'published', title: '未来文章', body: 'PRIVATE_FUTURE', published_at: '2999-01-01T00:00:00Z' },
        ], { name: '無相', ...(options.music ? { music_settings: { tracks: [{ title: '本地测试音乐', url: '/api/media/' + image }] } } : {}) }, [], [
          { id: 'private-record', slug: 'private-work', status: 'published', kind: 'works', title: '受限作品', body: 'PRIVATE_WORK' },
        ]];
      },
      preview: async () => { previews++; throw Error('Public article must not request preview'); },
      readMedia: async () => new Response(),
    } as unknown as NonNullable<Parameters<typeof createContentService>[0]['store']>,
  });
  const server = createPreviewServer({ root, siteOrigin: origin, contentService: service, communityOnly: options.communityOnly,
    authorService: { identity: async (req: {headers: {cookie?: string}}) => {
      if (identityWait) { const wait = identityWait; identityWait = undefined; wait.entered(); await wait.block; }
      return req.headers.cookie === 'owner=1' ? { name: 'Owner secret' } : null;
    } },
    readerService: { registrationEnabled: true, identity: async () => null },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { get: (path: string, init?: RequestInit) => fetch(local + path, init),
    withdraw: () => { status = 'archived'; version++; },
    edit: () => { edited = true; version++; },
    fail: () => { broken = true; version++; }, previews: () => previews,
    holdIdentity: () => {
      let entered!: () => void, release!: () => void;
      const arrived = new Promise<void>(done => { entered = done; });
      const block = new Promise<void>(done => { release = done; });
      identityWait = { entered, block };
      return { arrived, release };
    } };
}

test('public blog pathname returns the existing article body, one metadata set and a bounded verified bootstrap', async t => {
  const env = await fixture(t);
  const response = await env.get('/blog/hello-world?tracking=discard', { headers: { Host: 'evil.example' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  const html = await response.text(), dom = new JSDOM(html), doc = dom.window.document;
  t.after(() => dom.window.close());
  assert.equal(doc.querySelectorAll('title').length, 1);
  assert.equal(doc.title, title + ' · 無相');
  assert.equal(doc.querySelectorAll('meta[name="description"]').length, 1);
  assert.equal(doc.querySelector('meta[name="description"]')?.getAttribute('content'), summary);
  assert.equal(doc.querySelector('.reading-article h1')?.textContent, title);
  assert.match(doc.querySelector('.article-body')?.textContent || '', /可以直接阅读的完整正文/);
  assert.equal(doc.querySelector('.article-body script'), null);
  assert.equal(doc.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), origin + '/blog/hello-world');
  assert.equal(doc.querySelector('meta[property="og:url"]')?.getAttribute('content'), origin + '/blog/hello-world');
  assert.equal(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'), title);
  assert.equal(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'), origin + `/api/media/${image}?w=960&view=content`);
  assert.equal(doc.querySelector('meta[name="twitter:card"]')?.getAttribute('content'), 'summary_large_image');
  const bootstrap = JSON.parse(doc.querySelector('#site-content')!.textContent!);
  assert.deepEqual(bootstrap.articleEntry, { id: 'hello-world' });
  assert.equal(bootstrap.notes.length, 1);
  assert.equal(bootstrap.notes[0].id, 'hello-world');
  assert.deepEqual(bootstrap.works, []);
  assert.equal(bootstrap.author, null);
  for (const value of ['PRIVATE_DRAFT', 'PRIVATE_FUTURE', 'PRIVATE_WORK', 'window.BAD=1', 'evil.example', 'tracking=discard']) assert.ok(!html.includes(value), value);
  assert.ok(doc.body.classList.contains('content-open'));
  assert.ok(doc.body.classList.contains('blog-open'));
  assert.equal(doc.querySelectorAll('.page.reading-page > .reading-layout').length, 1);
  assert.equal(doc.querySelector('.reading-layout')?.firstElementChild, doc.querySelector('.reading-sidebar'));
  assert.equal(doc.querySelector('.reading-sidebar')?.nextElementSibling, doc.querySelector('.reading-article'));
  assert.equal(doc.querySelectorAll('.reading-sidebar .blog-identity').length, 1);
  assert.equal(doc.querySelectorAll('.reading-sidebar .blog-music-card').length, 1);
  assert.equal(doc.querySelectorAll('.reading-sidebar .reading-directory-slot').length, 1);
  assert.equal(doc.querySelectorAll('.reading-sidebar > :is(.blog-identity, .blog-music-card) > [data-reading-static-glass] > .glass-surface__content > .blog-third-party-glass-content').length, 2);
  assert.equal(doc.querySelectorAll('.article-contents').length, 1);
  assert.equal(doc.querySelector('.article-body')?.previousElementSibling, doc.querySelector('[data-reading-static-directory]'));
  assert.equal(doc.querySelector('.article-contents summary')?.textContent, '文章目录');
  assert.equal(doc.querySelector('.article-contents nav button')?.textContent, '正文标题');
  assert.equal(doc.querySelector('script[src*="app.mjs"]')?.getAttribute('src'), '/app.mjs?v=0.101');
  assert.equal(doc.querySelector('link[href$="styles.css"]')?.getAttribute('href'), '/styles.css');
  assert.equal(doc.documentElement.getAttribute('data-static-base'), '/');
  assert.equal(doc.querySelector('.back-link')?.getAttribute('href'), '/#/notes');
  assert.equal(response.headers.get('set-cookie'), null);
  const head = await env.get('/blog/hello-world', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), response.headers.get('content-length'));
});

test('article bootstrap retains request-local identity without contaminating later anonymous readers or sitemap', async t => {
  const env = await fixture(t, { cdn: true });
  const first = new JSDOM(await (await env.get('/blog/hello-world', { headers: { cookie: 'owner=1' } })).text());
  t.after(() => first.window.close());
  assert.equal(JSON.parse(first.window.document.querySelector('#site-content')!.textContent!).author.name, 'Owner secret');
  assert.equal(first.window.document.querySelector('script[src*="app.mjs"]')?.getAttribute('src'), 'https://static.example/assets/site/123/app.mjs');
  assert.equal(first.window.document.documentElement.getAttribute('data-static-base'), 'https://static.example/assets/site/123/');
  assert.ok(!(await (await env.get('/blog/hello-world')).text()).includes('Owner secret'));
  assert.ok(!(await (await env.get('/sitemap.xml')).text()).includes('Owner secret'));
});

test('draft, scheduled, invalid, preview and withdrawn articles cannot enter SSR or survive conditional requests', async t => {
  const env = await fixture(t);
  for (const path of ['/blog/draft-post', '/blog/future-post', '/blog/private-work', '/blog/db-record', '/blog/missing', '/blog/a%2Fb', '/blog/%E0%A4%A', '/blog/hello-world/extra', '/blog/hello-world?preview=draft-record', '/blog/hello-world?previewKind=articles']) {
    const response = await env.get(path); assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /PRIVATE_|完整正文/);
  }
  assert.equal(env.previews(), 0);
  assert.equal((await env.get('/blog/hello-world', { method: 'POST' })).status, 405);
  assert.equal((await env.get('/blog/hello-world')).status, 200);
  env.withdraw();
  for (const path of ['/blog/hello-world', '/share/blog/hello-world']) {
    assert.equal((await env.get(path, { headers: { 'If-None-Match': '*' } })).status, 404, path);
    assert.equal((await env.get(path, { method: 'HEAD' })).status, 404, path);
  }
});

test('dynamic sitemap contains only current public canonical articles and configured origin', async t => {
  const env = await fixture(t);
  const response = await env.get('/sitemap.xml?preview=private', { headers: { Host: 'evil.example', Cookie: 'owner=1' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /xml/);
  const xml = await response.text(), dom = new JSDOM(xml, { contentType: 'text/xml' });
  t.after(() => dom.window.close());
  assert.deepEqual([...dom.window.document.querySelectorAll('loc')].map(node => node.textContent), [origin + '/', origin + '/blog/hello-world']);
  assert.equal(dom.window.document.querySelector('lastmod'), null);
  assert.doesNotMatch(xml, /evil\.example|draft|future|private|share\/|Owner secret|PRIVATE_/);
  assert.equal(await (await env.get('/sitemap.xml', { method: 'HEAD' })).text(), '');
  const robots = await (await env.get('/robots.txt', { headers: { Host: 'evil.example' } })).text();
  assert.match(robots, /User-agent: \*/);
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  assert.ok(!robots.includes('Disallow: /share/'));
  env.withdraw();
  assert.ok(!(await (await env.get('/sitemap.xml', { headers: { 'If-None-Match': '*' } })).text()).includes('/blog/hello-world'));
});

test('publication read failure is retryable and community hosts do not gain public blog access', async t => {
  const env = await fixture(t); env.fail();
  for (const path of ['/blog/hello-world', '/sitemap.xml']) assert.equal((await env.get(path)).status, 503, path);
  const community = await fixture(t, { communityOnly: true });
  assert.equal((await community.get('/blog/hello-world')).status, 404);
  assert.equal((await community.get('/sitemap.xml')).status, 404);
});

test('an article revoked while identity is loading never reaches the HTML or bootstrap', async t => {
  const env = await fixture(t), hold = env.holdIdentity();
  const pending = env.get('/blog/hello-world');
  await hold.arrived;
  env.withdraw();
  hold.release();
  const response = await pending;
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /完整正文|articleEntry|og:title/);
});

test('an article edited while identity is loading uses the same final content in visible HTML, metadata and bootstrap', async t => {
  const env = await fixture(t), hold = env.holdIdentity();
  const pending = env.get('/blog/hello-world');
  await hold.arrived; env.edit(); hold.release();
  const response = await pending; assert.equal(response.status, 200);
  const dom = new JSDOM(await response.text()), doc = dom.window.document;
  t.after(() => dom.window.close());
  const item = JSON.parse(doc.querySelector('#site-content')!.textContent!).notes[0];
  assert.equal(doc.querySelector('.reading-article h1')?.textContent, item.title);
  assert.equal(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'), item.title);
  assert.equal(item.title, '更新后的标题');
  assert.equal(doc.querySelector('.article-body')?.innerHTML, item.bodyHTML);
  assert.match(item.bodyHTML, /更新后的完整正文/);
});

test('initial reading music uses the same natural record and control layout without starting audio', async t => {
  const env = await fixture(t, { music: true });
  const dom = new JSDOM(await (await env.get('/blog/hello-world')).text()), doc = dom.window.document;
  t.after(() => dom.window.close());
  assert.equal(doc.querySelectorAll('#blog-audio-player > [data-music-player-static]').length, 1);
  assert.equal(doc.querySelector('[data-music-player-static]')?.hasAttribute('inert'), true);
  assert.equal(doc.querySelectorAll('.music-turntable').length, 1);
  assert.equal(doc.querySelectorAll('.music-seek-row, .music-transport, .music-volume-row').length, 3);
  assert.equal(doc.querySelector('.reading-sidebar audio[src], .reading-sidebar source'), null);
  assert.equal(doc.querySelector('.reading-sidebar audio')?.getAttribute('preload'), 'none');
});

test('initial article HTML reserves each code toolbar without changing the code or bootstrap source', async t => {
  const env = await fixture(t, { code: true });
  const dom = new JSDOM(await (await env.get('/blog/hello-world')).text()), doc = dom.window.document;
  t.after(() => dom.window.close());
  const blocks = [...doc.querySelectorAll('.article-body pre')];
  assert.equal(blocks.length, 2);
  assert.equal(doc.querySelectorAll('.article-code-tools[data-reading-static-code][inert] + pre').length, 2);
  for (const block of blocks) {
    assert.equal(block.previousElementSibling?.querySelector('button[type=button]')?.textContent, '复制代码');
    assert.equal(block.previousElementSibling?.querySelector('[role=status]')?.textContent, '');
  }
  assert.equal(blocks[0].textContent, 'const text = "**原样保留**";\nnext(<value>)');
  assert.equal(blocks[1].textContent, 'plain\ncode');
  const item = JSON.parse(doc.querySelector('#site-content')!.textContent!).notes[0];
  assert.doesNotMatch(item.bodyHTML, /article-code-tools|data-reading-static-code/);
});
