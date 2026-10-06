import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewServer } from '../server.mjs';

async function fixture(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'sansphase-community-http-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><html><head></head><body><main>site</main></body></html>');
  const server = createPreviewServer({ root, contentService: { snapshot: async () => ({ data: { profile: { name: 'site' }, notes: [] } }) }, ...options });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise(done => server.close(done)); await rm(root, { recursive: true, force: true }); });
  return (path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
}

test('main authority routes are explicit while community business remains closed', async t => {
  const request = await fixture(t, {
    communityDestination: 'https://community.sansphase.com',
    identityAuthority: {
      handleEntry: async (_req, res) => { res.writeHead(201); res.end('entry'); },
      handleBridge: async (_req, res) => { res.writeHead(403); res.end('signed-only'); },
    },
  });
  assert.equal((await request('/api/community-entry', { method: 'POST' })).status, 201);
  assert.equal((await request('/api/community-identity/bridge', { method: 'POST' })).status, 403);
  assert.equal((await request('/api/community/me')).status, 503);
  assert.equal((await request('/api/community-entry-extra', { method: 'POST' })).status, 405);
  const bootstrap = await (await request('/api/content')).json();
  assert.equal(bootstrap.communityEnabled, false);
  assert.equal(bootstrap.communityDestination, 'https://community.sansphase.com');
});

test('host middleware gates protected HTML and bootstrap marks the sole community view', async t => {
  const request = await fixture(t, {
    communityOnly: true, mainSiteOrigin: 'https://www.sansphase.com',
    communityEnabled: true, communityService: { handle() {} },
    requestMiddleware: async (req, res, next) => {
      if (req.url === '/healthz' || req.headers.cookie === 'allowed=yes') return next();
      res.writeHead(401); res.end('enter through main');
    },
  });
  assert.equal((await request('/')).status, 401);
  assert.equal((await request('/healthz')).status, 200);
  const html = await (await request('/', { headers: { cookie: 'allowed=yes' } })).text();
  assert.match(html, /data-community-only="true"/);
  assert.match(html, /data-community-boot="pending"/);
  const bootstrap = await (await request('/api/content', { headers: { cookie: 'allowed=yes' } })).json();
  assert.equal(bootstrap.communityOnly, true);
  assert.equal(bootstrap.mainSiteOrigin, 'https://www.sansphase.com');
});
