import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrontendIntegrationPreview } from '../scripts/preview-frontend-integration.ts';

const builtV3 = process.env.SANSPHASE_TEST_V3_BUILD;

test('V3 resource centre uses existing chapter, reader and VIP permissions', { skip: !builtV3, timeout: 240000 }, async t => {
  const preview = await createFrontendIntegrationPreview({ frontend: 'v3', port: 0, buildAssets: false, v3AppDirectory: builtV3 });
  t.after(preview.close);

  const get = (path: string, cookie = '') => fetch(preview.origin + path, {
    headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000),
  });
  async function page(path: string, cookie = '', status = 200) {
    const response = await get(path, cookie);
    assert.equal(response.status, status, `${path} ${preview.diagnostics()}`);
    assert.match(response.headers.get('cache-control') ?? '', /no-store|no-cache/);
    return response.text();
  }
  async function login(email: string, kind: 'reader' | 'author' = 'reader') {
    const response = await fetch(`${preview.origin}/api/${kind}/login`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Origin: preview.origin, 'Content-Type': 'application/json', [kind === 'reader' ? 'X-Reader-Request' : 'X-Author-Request']: '1' },
      body: JSON.stringify({ email, password: 'DemoLogin2026!' }),
    });
    assert.equal(response.status, 200);
    const header = response.headers.get('set-cookie');
    assert.ok(header);
    return header.split(';')[0];
  }

  const { publicBook, vipBook } = preview.fixtures.slugs;
  const vipChapter = `/resources/${vipBook}/local-two`;
  const ordinaryChapter = `/resources/${publicBook}/local-three`;
  const vipDownload = `/api/media/${preview.fixtures.vipFileId}?download=1`;
  const vipIllustration = `/api/media/${preview.fixtures.vipIllustrationId}?view=content`;
  const guest = await page(`/en${vipChapter}`);
  assert.ok(guest.includes(`href="/en/account?return=${encodeURIComponent(`/en${vipChapter}`)}"`));
  assert.doesNotMatch(guest, /LOCAL VIP CHAPTER TWO/);

  for (const email of ['reader@example.test', 'expired@example.test']) {
    const cookie = await login(email);
    const shelf = await page('/resources', cookie);
    assert.ok(shelf.includes(`/resources/${publicBook}`));
    assert.ok(shelf.includes(`/resources/${vipBook}`));
    const ordinary = await page(ordinaryChapter, cookie);
    assert.match(ordinary, /LOCAL PUBLIC CHAPTER THREE/);
    assert.match(ordinary, /LOCAL PUBLIC CHAPTER THREE.*LOCAL CHAPTER CONTINUATION 13/s);
    assert.doesNotMatch(ordinary, /章节内翻页|href="[^"\n]*\?part=/);
    const legacy = await page(`${ordinaryChapter}?part=2`, cookie);
    assert.match(legacy, /LOCAL PUBLIC CHAPTER THREE.*LOCAL CHAPTER CONTINUATION 13/s);
    const locked = await page(vipChapter, cookie);
    assert.doesNotMatch(locked, /LOCAL VIP CHAPTER TWO/);
    assert.ok(!locked.includes(vipDownload));
    assert.equal((await get(vipDownload, cookie)).status, 404);
    assert.equal((await get(vipIllustration, cookie)).status, 404);
  }

  for (const [email, kind] of [['vip@example.test', 'reader'], ['owner@example.test', 'author']] as const) {
    const cookie = await login(email, kind);
    const chapter = await page(vipChapter, cookie);
    assert.match(chapter, /LOCAL VIP CHAPTER TWO/);
    const overview = await page(`/resources/${vipBook}`, cookie);
    assert.ok(overview.includes(`href="${vipChapter}"`));
    assert.ok(overview.includes(vipDownload));
    const response = await get(vipDownload, cookie);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /LOCAL VIP INTEGRATION FIXTURE/);
    assert.equal((await get(vipIllustration, cookie)).status, 200);
    await page(`${vipChapter}?part=2`, cookie, 404);
    await page('/resources/local-book-draft', cookie, 404);
  }

  assert.doesNotMatch(await page(vipChapter), /LOCAL VIP CHAPTER TWO/, 'authenticated HTML must not leak on a later guest request');
});
