import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createPreviewServer } from '../server.mjs';
import { createCommunityHostStore, prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { createCommunityHostAccess } from '../server/community-host-access.ts';

const origin = 'https://www.sansphase.com';
const postId = '12345678-1234-1234-1234-123456789012';
test('invitation cards preserve only a validated fixed code, and revoked invitations disappear', async t => {
  const code = 'AbCdEfGh12345678_abc-123';
  let active = true, lookups = 0;
  const server = createPreviewServer({ siteOrigin: origin,
    invitationEligible: (value: string) => { lookups++; return active && value === code; },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await fetch(local + `/share/invite/${code}?next=https://evil.example&token=private`, { headers: { Host: 'evil.example' } });
  assert.equal(response.status, 200);
  const html = await response.text(), dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelector('a')?.getAttribute('href'), `${origin}/?invite=${code}#/account`);
  assert.equal(dom.window.document.querySelector('meta[property="og:url"]')?.getAttribute('content'), `${origin}/share/invite/${code}`);
  assert.ok(dom.window.document.querySelector('a img'));
  assert.match(html, /邀请/);
  assert.doesNotMatch(html, /evil\.example|private/);
  assert.equal(response.headers.get('set-cookie'), null);
  dom.window.close();
  const calls = lookups;
  assert.equal((await fetch(local + '/share/invite/bad-code')).status, 404);
  assert.equal(lookups, calls);
  active = false;
  assert.equal((await fetch(local + '/share/invite/' + code)).status, 404);
});
async function fixture(t: test.TestContext) {
  let published = true;
  let hidden = false;
  let reads = 0;
  let coverSrc = '/api/media/12345678-1234-1234-1234-123456789012?w=960&view=content';
  const server = createPreviewServer({ siteOrigin: origin, communityEnabled: true,
    contentService: { snapshot: async () => ({ data: { profile: { name: '無相' }, notes: published ? [
      { id: 'hello-world', title: '公开文章', summary: '文章摘要', bodyHTML: '正文不进入分享页', coverSrc },
    ] : [], works: [{ id: 'private-work', title: '受限作品' }] } }) },
    communityService: { handle: async () => { throw Error('Share must not impersonate a logged-in member'); },
      shareTopic: (id: string) => { reads++; return id === postId && !hidden ? { title: '公开帖子', description: '来自学习问答的讨论' } : null; },
    },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const port = (server.address() as { port: number }).port;
  const get = (path: string, options: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, options);
  return { get, withdraw: () => { published = false; hidden = true; }, reads: () => reads, cover: (value: string) => { coverSrc = value; } };
}

test('public blog share returns per-article metadata and a clickable card without content or identity', async t => {
  const env = await fixture(t);
  const response = await env.get('/share/blog/hello-world?preview=secret&token=secret', { headers: { Host: 'evil.example', Cookie: 'private' } });
  assert.equal(response.status, 200);
  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  assert.equal(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'), '公开文章');
  assert.equal(doc.querySelector('meta[property="og:url"]')?.getAttribute('content'), origin + '/share/blog/hello-world');
  assert.equal(doc.querySelector('a')?.getAttribute('href'), origin + '/blog/hello-world');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  assert.ok(doc.querySelector('a img'));
  for (const privateText of ['正文不进入分享页', 'secret', 'evil.example', 'private-work']) assert.ok(!html.includes(privateText));
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(response.headers.get('set-cookie'), null);
  dom.window.close();
  const head = await env.get('/share/blog/hello-world', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('withdrawal takes effect immediately and unsupported/private share addresses do not disclose content', async t => {
  const env = await fixture(t);
  assert.equal((await env.get('/share/post/' + postId)).status, 200);
  env.withdraw();
  for (const path of ['/share/blog/hello-world', '/share/post/' + postId, '/share/works/private-work', '/share/blog/missing', '/share/post/not-a-uuid', '/share/blog/a%2Fb', '/share/blog/%E0%A4%A']) {
    const response = await env.get(path); assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes('公开帖子'));
  }
  assert.equal((await env.get('/share/site', { method: 'POST' })).status, 405);
});

test('site and community have distinct non-personalized share cards', async t => {
  const env = await fixture(t);
  for (const route of ['site', 'community']) {
    const response = await env.get('/share/' + route);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /og:image/);
  }
  assert.equal(env.reads(), 0);
});

test('bad, foreign, credential-bearing and preview cover URLs fall back without exposing private parameters', async t => {
  const env = await fixture(t);
  const id = '12345678-1234-1234-1234-123456789012';
  for (const cover of ['http://[', 'javascript:alert(1)', `https://elsewhere.example/api/media/${id}`, `https://private:credential@www.sansphase.com/api/media/${id}`, `/api/media/${id}?preview=private-token`, '/api/manage/private.jpg']) {
    env.cover(cover);
    const response = await env.get('/share/blog/hello-world');
    assert.equal(response.status, 200, cover);
    const html = await response.text();
    const dom = new JSDOM(html);
    assert.equal(dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute('content'), origin + '/share/cover.jpg');
    for (const text of ['private-token', 'credential', 'elsewhere.example']) assert.ok(!html.includes(text));
    dom.window.close();
  }
  env.cover(`/api/media/${id}?untrusted=private-token#private-fragment`);
  const dom = new JSDOM(await (await env.get('/share/blog/hello-world')).text());
  assert.equal(dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute('content'), `${origin}/api/media/${id}?w=960&view=content`);
  dom.window.close();
});

test('temporary cover capacity returns retryable 503 while withdrawn covers remain 404', async t => {
  let busy = true, visible = true;
  const server = createPreviewServer({ siteOrigin: origin, communityEnabled: true,
    communityService: {
      shareTopic: () => visible ? { title: '分享标题', description: '公开摘要', imageId: postId } : null,
      shareImage: async () => {
        if (busy) throw Object.assign(new Error('Temporary encoder capacity'), { status: 503 });
        return Buffer.from('permitted-cover');
      },
    },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/share/post/${postId}/cover.jpg`;
  for (const method of ['GET', 'HEAD']) {
    const retry = await fetch(url, { method });
    assert.equal(retry.status, 503);
    assert.equal(retry.headers.get('retry-after'), '1');
    assert.match(retry.headers.get('cache-control') || '', /no-store/);
    assert.equal(retry.headers.get('set-cookie'), null);
    assert.ok(!(await retry.text()).includes('permitted-cover'));
  }
  busy = false;
  const success = await fetch(url);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('retry-after'), null);
  assert.equal(await success.text(), 'permitted-cover');
  visible = false;
  const withdrawn = await fetch(url);
  assert.equal(withdrawn.status, 404);
  assert.equal(withdrawn.headers.get('retry-after'), null);
});

test('a cover revoked while asynchronous work is outstanding never reaches the requester', async t => {
  let visible = true;
  let begin!: () => void;
  let finish!: (bytes: Buffer) => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const pending = new Promise<Buffer>(resolve => { finish = resolve; });
  const server = createPreviewServer({ siteOrigin: origin, communityEnabled: true,
    communityService: {
      shareTopic: () => visible ? { title: '分享标题', description: '公开摘要', imageId: postId } : null,
      shareImage: async () => { begin(); return pending; },
    },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { finish(Buffer.alloc(0)); return new Promise<void>(done => server.close(() => done())); });
  const port = (server.address() as { port: number }).port;
  const response = fetch(`http://127.0.0.1:${port}/share/post/${postId}/cover.jpg`);
  await started;
  visible = false;
  finish(Buffer.from('revoked-image-source'));
  const result = await response;
  assert.equal(result.status, 404);
  assert.ok(!(await result.text()).includes('revoked-image-source'));
  assert.match(result.headers.get('cache-control') || '', /no-store/);
});

test('the real community host lets crawlers reach only public share projections without creating a session', async t => {
  const communityOrigin = 'https://community.sansphase.com';
  const prefix = resolve(tmpdir(), 'sansphase-share-host-');
  const directory = await mkdtemp(prefix);
  assert.ok(directory.startsWith(prefix));
  await prepareCommunityHostDirectory(directory);
  const store = createCommunityHostStore(directory);
  let bridgeCalls = 0;
  const access = createCommunityHostAccess({ store, client: { async request<T>(): Promise<T> { bridgeCalls++; throw new Error('No anonymous identity lookup'); } },
    siteOrigin: communityOrigin, mainSiteOrigin: origin, secret: 'share-unit-test-private-bridge-secret-at-least-32', purge: async () => {} });
  const server = createPreviewServer({ siteOrigin: communityOrigin, communityOnly: true, mainSiteOrigin: origin, communityEnabled: true,
    requestMiddleware: access.requestMiddleware,
    communityService: { shareTopic: (id: string) => id === postId ? { title: '分享标题', description: '公开摘要' } : null,
      handle: async () => { throw new Error('Anonymous sharing cannot read protected APIs'); } },
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); assert.ok(directory.startsWith(prefix)); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const port = (server.address() as { port: number }).port;
  const get = (path: string, options: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${path}`, options);
  for (const method of ['GET', 'HEAD']) {
    const response = await get('/share/post/' + postId, { method, headers: { Host: 'attacker.test', 'X-Forwarded-Host': 'attacker.test', Cookie: 'sansphase_community_session=invalid' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    if (method === 'GET') { const html = await response.text(); assert.ok(html.includes('分享标题')); assert.ok(!html.includes('attacker.test')); }
    else assert.equal(await response.text(), '');
  }
  assert.equal((await get('/api/community/summary')).status, 401);
  assert.equal((await get('/share/blog/hello-world')).status, 404);
  assert.equal((await get('/share/post/not-a-uuid')).status, 404);
  assert.equal((await get('/share/server/private.ts')).status, 404);
  assert.equal((await get('/share/post/' + postId, { method: 'POST' })).status, 404);
  assert.equal(bridgeCalls, 0);
});
