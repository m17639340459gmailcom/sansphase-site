import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAdminConsolePreview } from '../scripts/preview-admin-console.ts';
import { evaluateInWebGLBrowser } from './helpers/webgl-browser.mjs';

type Content = { id: string; slug: string; status: string; date_updated: string; body: string; title: string };
type Preview = { preview: { id: string; previewId: string; book: { revision: string; chapters: { id: string; title: string }[] }; bodyHTML?: string } };
const privateBody = '<section data-book-chapter="one" data-book-title="第一章"><h2 data-book-block="first-title">章内小节</h2><p>本次隔离预览的私有正文</p></section><section data-book-chapter="two" data-book-title="第二章"><p>第二章独立正文</p></section>';

test('local management book preview uses newly built site and real owner-only draft and chapter delivery', { timeout: 90000 }, async t => {
  const preview = await createAdminConsolePreview({ port: 0 });
  t.after(preview.close);
  const request = (path: string, cookie = '', options: RequestInit = {}) => fetch(preview.origin + path, {
    redirect: 'manual', signal: AbortSignal.timeout(15000), ...options,
    headers: { Cookie: cookie, ...options.headers },
  });
  const write = (path: string, body: unknown, cookie = '', method = 'POST') => request(path, cookie, {
    method, headers: { Origin: preview.origin, 'X-Author-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const login = await write('/api/author/login', { email: 'owner@example.test', password: 'DemoLogin2026!' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const unauthenticatedMain = await request('/?mainPreview=1');
  assert.equal(unauthenticatedMain.status, 302);
  assert.equal(unauthenticatedMain.headers.get('location'), '/preview-login');
  const mainPage = await request('/?mainPreview=1', cookie);
  assert.equal(mainPage.status, 200);
  assert.match(await mainPage.text(), /id="site-content"/);
  const list = await (await request('/api/author/content/resource-center', cookie)).json() as Content[];
  const seeded = list.find(row => row.status === 'draft')!;
  assert.ok(seeded);
  const seedPreview = await request(`/api/content?preview=${seeded.id}&previewKind=resource-center`, cookie);
  assert.equal(seedPreview.status, 200);
  const seedData = await seedPreview.json() as Preview;
  assert.deepEqual(seedData.preview.book.chapters.map(chapter => chapter.title), ['第一章', '第二章']);

  const input = { title: '真实流程草稿预览', slug: 'local-private-book-preview', action: 'draft', vip_only: true, body: privateBody };
  const created = await write('/api/author/content/resource-center', input, cookie);
  assert.equal(created.status, 200);
  let book = await created.json() as Content;
  const suffix = `preview=${book.id}&previewKind=resource-center`;
  const pagePath = '/?' + suffix;
  const partPath = `/api/content?view=book-part&kind=resource-center&id=${book.slug}&chapter=one&part=0&${suffix}`;
  for (const path of [pagePath, '/api/content?' + suffix, partPath]) {
    assert.equal((await request(path)).status, 401, 'anonymous preview cannot redirect or expose drafts: ' + path);
    assert.equal((await request(path, 'sansphase_author_session=forged')).status, 401);
    assert.equal((await request(path, 'sansphase_reader_session=ordinary-reader')).status, 401);
  }
  const page = await request(pagePath, cookie);
  assert.equal(page.status, 200, await page.clone().text());
  assert.equal(page.headers.has('location'), false);
  assert.match(page.headers.get('cache-control') || '', /no-store/);
  const html = await page.text();
  assert.match(html, /id="site-content"/);
  assert.match(html, /"previewId"/);
  assert.equal(html.includes('本次隔离预览的私有正文'), false, 'HTML contains chapter manifest, not the whole book');
  assert.equal(html.includes('data-static-base='), false, 'local assets never inherit a live CDN setting');
  for (const path of ['/app.mjs', '/book-reader.mjs', '/book-reader.css', '/styles.css', '/admin-console/admin-console.js'])
    assert.equal((await request(path)).status, 200, 'newly built asset: ' + path);
  const builtIndex = await readFile(resolve(preview.directory, 'public/index.html'), 'utf8');
  assert.match(builtIndex, /app\.mjs/);
  const part = await request(partPath, cookie, { headers: { 'If-None-Match': '"stale"' } });
  assert.equal(part.status, 200);
  assert.match(part.headers.get('cache-control') || '', /no-store/);
  assert.equal(part.headers.has('etag'), false);
  assert.match((await part.json()).html, /本次隔离预览的私有正文/);
  const chapterTwo = await request(partPath.replace('chapter=one', 'chapter=two'), cookie);
  assert.match((await chapterTwo.json()).html, /第二章独立正文/);
  assert.equal((await request(partPath.replace(book.slug, 'wrong-slug'), cookie)).status, 404);

  const publication = await write(`/api/author/content/resource-center/${book.id}`, { ...input, action: 'publish', expectedUpdated: book.date_updated }, cookie, 'PATCH');
  assert.equal(publication.status, 200); book = await publication.json() as Content;
  const pending = await write(`/api/author/content/resource-center/${book.id}`, { ...input, body: privateBody.replace('本次隔离预览的私有正文', '尚未发布的新正文'), expectedUpdated: book.date_updated }, cookie, 'PATCH');
  assert.equal(pending.status, 200);
  assert.match((await (await request(partPath, cookie)).json()).html, /尚未发布的新正文/);
  const publicPart = await request(`/api/content?view=book-part&kind=resource-center&id=${book.slug}&chapter=one&part=0`, cookie);
  const publishedHTML = (await publicPart.json()).html as string;
  assert.match(publishedHTML, /本次隔离预览的私有正文/);
  assert.equal(publishedHTML.includes('尚未发布的新正文'), false, 'draft overlay does not mutate published content');
  assert.equal((await request('/api/content?view=bootstrap')).status, 401, 'local content is owner-only without a reader runtime');
  if (process.env.ADMIN_CONSOLE_BROWSER === '1') {
    let commandId = 1400;
    const browserResult = await evaluateInWebGLBrowser(process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'window.bookPreviewResult', 'about:blank', async socket => {
        type DevtoolsResult = { result?: { value?: unknown }; exceptionDetails?: unknown };
        const call = (method: string, params: Record<string, unknown> = {}) => new Promise<DevtoolsResult>((done, reject) => {
          const id = commandId++;
          const receive = (event: MessageEvent) => {
            const message = JSON.parse(String(event.data)) as { id: number; error?: unknown; result: DevtoolsResult };
            if (message.id !== id) return;
            socket.removeEventListener('message', receive);
            if (message.error || message.result?.exceptionDetails) reject(Error(JSON.stringify(message)));
            else done(message.result);
          };
          socket.addEventListener('message', receive); socket.send(JSON.stringify({ id, method, params }));
        });
        await call('Network.setCookie', { url: preview.origin, name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), httpOnly: true });
        await call('Page.navigate', { url: preview.origin + pagePath + '#/resource-center/' + book.slug });
        const evaluate = async (expression: string) => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          try { ready = Boolean(await evaluate("!!document.querySelector('.section-reader [data-section-action=start]')")); } catch { /* Navigation replaces the execution context. */ }
          if (ready) break;
          await new Promise(resolve => setTimeout(resolve, 60));
        }
        assert.equal(ready, true, String(await evaluate('document.body.innerText.slice(-1500)')));
        await evaluate(`(async()=>{
          const wait=async text=>{for(let i=0;i<100;i++){if(document.querySelector('.section-body')?.textContent.includes(text))return;await new Promise(r=>setTimeout(r,40));}throw Error('Real chapter did not load: '+text);};
          document.querySelector('[data-section-action=start]').click();await wait('尚未发布的新正文');
          document.querySelector('.section-sidebar [data-section-chapter=two]').click();await wait('第二章独立正文');
          window.bookPreviewResult={chapters:document.querySelectorAll('.section-sidebar [data-section-chapter]').length,privateReader:location.search.includes('preview='),twoRead:true};
        })()`);
      });
    assert.deepEqual(browserResult, { chapters: 2, privateReader: true, twoRead: true });
  }
  assert.equal((await write('/api/author/logout', {}, cookie)).status, 200);
  assert.equal((await request(pagePath, cookie)).status, 401);
  assert.equal((await request(partPath, cookie)).status, 401);
});
