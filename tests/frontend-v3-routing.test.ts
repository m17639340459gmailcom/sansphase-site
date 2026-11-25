import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import test from 'node:test';
import { createPreviewServer } from '../server.mjs';
import { createFrontendV3Middleware } from '../server/frontend-v3.ts';

test('V3 owns the article UI while public content and share remain on the existing backend', async (t) => {
  const reserve = createServer();
  await new Promise<void>(done => reserve.listen(0, '127.0.0.1', done));
  const { port } = reserve.address() as AddressInfo;
  await new Promise<void>((done, reject) => reserve.close(error => error ? reject(error) : done()));
  const origin = 'http://127.0.0.1:' + port;
  const slug = 'tested-published-article';
  const snapshot = { data: { notes: [{ id: slug, title: '同一篇文章', summary: '用于测试的分享摘要' }] } };
  const server = createPreviewServer({
    siteOrigin: origin,
    mainFrontend: 'v3',
    contentService: { snapshot: async () => snapshot },
    requestMiddleware: createFrontendV3Middleware({
      origin,
      render: async (req, res) => { res.end('V3 ' + req.url); },
    }),
  });
  await new Promise<void>(done => server.listen(port, '127.0.0.1', done));
  t.after(() => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())));
  const get = (path: string) => fetch(origin + path, { redirect: 'manual' });
  assert.equal(await (await get('/blog/' + slug)).text(), 'V3 /blog/' + slug);
  assert.equal((await (await get('/api/content?view=detail&kind=notes&public=1&id=' + slug)).json()).item.title, '同一篇文章');
  const share = await get('/share/blog/' + slug);
  assert.equal(share.status, 200);
  assert.match(await share.text(), new RegExp(origin + '/blog/' + slug));
  assert.equal((await get('/work/example?a=1')).headers.get('location'), '/projects/example?a=1');
  for (const alias of ['/original', '/v1', '/v2', '/index.html']) {
    const response = await get(alias + '?locale=en');
    assert.equal(response.status, 308, alias);
    assert.equal(response.headers.get('location'), '/?locale=en', alias);
    assert.equal((await fetch(origin + alias, { method: 'HEAD', redirect: 'manual' })).status, 308, alias);
  }
  assert.equal((await get('/frontend-v2/index.html')).status, 404);
  assert.equal(await (await get('/?frontend=v1&mainPreview=1')).text(), 'V3 /?frontend=v1&mainPreview=1');
  assert.equal((await get('/admin-console')).headers.get('location'), '/admin-console/');
  assert.equal((await get('/api/unknown')).status, 404);
  assert.equal((await get('/blog/' + slug + '?preview=private')).status, 404);
  assert.equal((await get('/admin')).status, 404);
  assert.equal((await get('/en/admin/login')).status, 404);
  assert.equal((await get('/_next/server/app-paths-manifest.json')).status, 404);
  assert.equal(await (await get('/_next/static/chunks/example.js')).text(), 'V3 /_next/static/chunks/example.js');
  assert.equal((await fetch(origin + '/account', { method: 'POST' })).status, 405);
});
