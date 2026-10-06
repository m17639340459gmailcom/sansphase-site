import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPreviewServer } from '../server.mjs';

test('community access defaults closed independently of a ready service; only explicit true opens it', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'sansphase-community-publication-'));
  await writeFile(resolve(root, 'index.html'), '<html><head></head><body></body></html>');
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const setting of [undefined, false, 'true', 1, true]) {
    await t.test(`communityEnabled=${typeof setting}:${String(setting)}`, async () => {
      let serviceCalls = 0;
      const server = createPreviewServer({ root, communityEnabled: setting,
        contentService: { snapshot: async () => ({ data: { profile: { name: 'Public owner' }, notes: [] } }) },
        communityService: { async handle(_req, res) { serviceCalls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"preview":true}'); } },
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const enabled = setting === true;
      try {
        for (const [method, path] of [['GET', 'summary'], ['GET', 'me'], ['GET', 'images/00000000-0000-0000-0000-000000000001.webp'], ['POST', 'topics'], ['POST', 'images'], ['POST', 'active/visit'], ['POST', 'manage/approve']]) {
          const response = await fetch(`${origin}/api/community/${path}`, { method });
          assert.equal(response.status, enabled ? 200 : 503, `${method} ${path}`);
          if (enabled) await response.json();
          else {
            assert.deepEqual(await response.json(), { error: '社区尚未开放。' });
            assert.equal(response.headers.get('cache-control'), 'private, no-store');
          }
        }
        assert.equal(serviceCalls, enabled ? 7 : 0, 'closed requests never reach identity, maintenance, uploads or writes');
        const content = await fetch(`${origin}/api/content`);
        assert.equal(content.status, 200);
        const data = await content.json();
        assert.equal(data.profile.name, 'Public owner');
        assert.equal(data.communityEnabled, enabled);
        const refreshed = await (await fetch(`${origin}/api/content?view=bootstrap`)).json();
        assert.equal(refreshed.communityEnabled, enabled, 'author publication refresh retains the decision');
        const html = await (await fetch(origin)).text();
        const bootstrap = JSON.parse(/<script[^>]*id="site-content"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1]);
        assert.equal(bootstrap.communityEnabled, enabled, 'the browser receives the same server decision');
        assert.equal((await fetch(`${origin}/healthz`)).status, 200);
      } finally { await new Promise(resolve => server.close(resolve)); }
    });
  }
});
