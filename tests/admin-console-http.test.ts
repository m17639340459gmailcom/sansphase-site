import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { createPreviewServer } from '../server.mjs';

async function fixture(t: test.TestContext, communityOnly = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'admin-http-test-'));
  const root = resolve(directory, 'public');
  await mkdir(resolve(root, 'admin-console/chunks'), { recursive: true });
  await writeFile(resolve(root, 'index.html'), '<h1>Original site</h1>');
  await writeFile(resolve(root, 'admin-console/index.html'), '<!doctype html><title>用户管理</title><div id="root"></div><script type="module" src="/admin-console/admin-console.js"></script>');
  await writeFile(resolve(root, 'admin-console/admin-console.js'), "import './chunks/page-ABC.js';");
  await writeFile(resolve(root, 'admin-console/admin-console.css'), '#root{min-width:0}');
  await writeFile(resolve(root, 'admin-console/chunks/page-ABC.js'), 'export const page=true;');
  await writeFile(resolve(root, 'admin-console/account.db'), 'private sentinel');
  const server = createPreviewServer({ root, communityOnly });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    assert.equal(await realpath(directory), resolve(await realpath(tmpdir()), basename(directory)));
    assert.match(basename(directory), /^admin-http-test-/);
    await rm(directory, { recursive: true, force: true });
  });
  return (path: string, options: RequestInit = {}) => fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
}

test('formal admin shell has canonical directory routing, security headers and complete same-origin asset delivery', async t => {
  const request = await fixture(t);
  for (const path of ['/admin-console', '/manage', '/manage/']) {
    const response = await request(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin-console/');
  }
  for (const path of ['/admin-console/', '/admin-console/index.html', '/%5cadmin-console/index.html']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.match(response.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
    assert.match(await response.text(), /id="root"/);
    const head = await request(path, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  }
  for (const path of ['/admin-console/admin-console.js', '/admin-console/admin-console.css', '/admin-console/chunks/page-ABC.js']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /must-revalidate/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    await response.arrayBuffer();
    const cached = await request(path, { headers: { 'If-None-Match': response.headers.get('etag')! } });
    assert.equal(cached.status, 304);
  }
  assert.equal((await request('/admin-console/', { method: 'POST' })).status, 405);
  for (const path of ['/preview-login', '/preview-login.js', '/admin-console/missing.js', '/admin-console/account.db', '/admin-console/readers', '/x%2f..%2fadmin-console/index.html'])
    assert.equal((await request(path)).status, 404, path);
  assert.match(await (await request('/')).text(), /Original site/);
});

test('community-only hosting cannot expose the main-site management console or its legacy alias', async t => {
  const request = await fixture(t, true);
  for (const path of ['/admin-console', '/admin-console/', '/admin-console/index.html', '/admin-console/admin-console.js', '/manage', '/manage/', '/%5cadmin-console/index.html', '/%5cadmin-console/admin-console.js', '/x%2f..%2fadmin-console/index.html', '/ADMIN-CONSOLE/index.html']) {
    for (const method of ['GET', 'HEAD']) assert.equal((await request(path, { method })).status, 404, method + ' ' + path);
  }
});
