import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = build({
  entryPoints: [fileURLToPath(new URL('../src/author-entry.mjs', import.meta.url))],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
}).then(result => result.outputFiles[0].text);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(ready, message) {
  for (let i = 0; i < 80; i++) { if (ready()) return; await tick(); }
  assert.ok(ready(), message);
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const signedIn = () => json({ name: 'Synthetic owner' });

async function fixture(sessionResponse, initialAuthor = null) {
  const dom = new JSDOM(`<header id="site-header"><button data-author-login>作者模式</button><span data-synthetic-reader>Existing reader</span></header><main id="main"><button data-author-open="profile">Existing profile shortcut</button></main><div id="home-stage"></div><footer id="site-footer"></footer><script id="site-content" type="application/json">${JSON.stringify({ author: initialAuthor })}</script>`, {
    url: 'https://www.sansphase.com/#/notes', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, d = w.document, calls = [], identityEvents = [];
  let respond = sessionResponse;
  Object.assign(w, {
    TextEncoder, TextDecoder,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch: async path => {
      calls.push(path);
      if (path === '/api/author/session') return respond();
      if (path === '/api/author/login-challenge') return json({ enabled: false });
      if (path === '/api/author/profile') return json({ name: 'Synthetic owner', signature: '', bio: '', social_links: [] });
      assert.fail(`Unexpected request in synthetic recovery fixture: ${path}`);
    },
  });
  for (const type of ['author:identity', 'reader:identity']) w.addEventListener(type, event => identityEvents.push({ type, detail: event.detail }));
  vm.runInContext(await bundle, dom.getInternalVMContext());
  const click = selector => { const element = d.querySelector(selector); assert.ok(element, selector); element.click(); };
  const close = async () => { d.getElementById('author-dialog')?.remove(); await tick(); w.close(); };
  return { w, d, calls, identityEvents, click, close, setResponse: next => { respond = next; } };
}

for (const [name, failure] of [
  ['HTTP 503 JSON', () => json({ error: 'Synthetic temporary service outage' }, 503)],
  ['HTTP 503 non-JSON gateway response', () => new Response('<html>Temporarily unavailable</html>', { status: 503 })],
  ['network error', () => { throw new TypeError('Synthetic network failure'); }],
  ['malformed HTTP 200 response', () => new Response('')],
  ['HTTP 403', () => json({ error: 'Synthetic access check unavailable' }, 403)],
]) {
  test(`${name} keeps the author entrance retryable without claiming that the account signed out`, async () => {
    const f = await fixture(failure);
    try {
      f.click('[data-author-login]');
      await waitFor(() => Boolean(f.d.querySelector('[data-author-session-retry]')), 'A temporary session failure must offer retry instead of a login form');
      assert.equal(f.d.querySelector('[data-author-form="login"]'), null);
      assert.equal(f.calls.includes('/api/author/login-challenge'), false, 'A service outage does not require another CAPTCHA');
      assert.deepEqual(f.identityEvents, [], 'Failure cannot clear author or reader identity');
      assert.equal(f.d.querySelector('[data-synthetic-reader]').textContent, 'Existing reader');
      f.setResponse(signedIn);
      f.click('[data-author-session-retry]');
      await waitFor(() => Boolean(f.d.querySelector('.author-hub-heading')), 'Retry should restore the existing author session');
      assert.equal(f.calls.filter(path => path === '/api/author/session').length, 2);
      assert.equal(f.calls.includes('/api/author/login-challenge'), false);
      assert.equal(f.calls.includes('/api/author/login'), false);
      assert.deepEqual(f.identityEvents, []);
    } finally { await f.close(); }
  });
}

for (const [name, response] of [
  ['confirmed empty session', () => json(null)],
  ['HTTP 401 JSON', () => json({ error: 'Synthetic expired session' }, 401)],
  ['HTTP 401 with no JSON body', () => new Response('', { status: 401 })],
]) {
  test(`${name} still opens the protected login flow`, async () => {
    const f = await fixture(response);
    try {
      f.click('[data-author-login]');
      await waitFor(() => Boolean(f.d.querySelector('[data-author-form="login"]')), 'A confirmed unauthenticated response should allow sign-in');
      assert.equal(f.d.querySelector('.author-hub-heading'), null);
      assert.equal(f.calls.filter(path => path === '/api/author/login-challenge').length, 1);
      assert.deepEqual(f.identityEvents, []);
    } finally { await f.close(); }
  });
}

test('retry preserves the original author destination instead of always opening the hub', async () => {
  const f = await fixture(() => json({ error: 'Synthetic outage' }, 503));
  try {
    f.click('#main [data-author-open="profile"]');
    await waitFor(() => Boolean(f.d.querySelector('[data-author-session-retry]')), 'The requested profile can be retried');
    f.setResponse(signedIn); f.click('[data-author-session-retry]');
    await waitFor(() => Boolean(f.d.querySelector('[data-author-form="profile"]')), 'The retry returns to the requested profile section');
    assert.equal(f.calls.includes('/api/author/login-challenge'), false);
  } finally { await f.close(); }
});

test('repeated temporary failures allow another retry while a pending retry ignores repeated clicks', async () => {
  const f = await fixture(() => json({ error: 'Synthetic outage' }, 503));
  try {
    f.click('[data-author-login]');
    await waitFor(() => Boolean(f.d.querySelector('[data-author-session-retry]')), 'Recovery is available');
    let finish;
    f.setResponse(() => new Promise(resolve => { finish = resolve; }));
    f.click('[data-author-session-retry]'); f.click('[data-author-session-retry]');
    assert.equal(f.calls.filter(path => path === '/api/author/session').length, 2, 'A pending retry issues only one session check');
    assert.equal(f.d.querySelector('[data-author-session-retry]').disabled, true);
    finish(json({ error: 'Synthetic repeated outage' }, 503));
    await waitFor(() => f.d.querySelector('[data-author-session-retry]')?.disabled === false, 'Another temporary error restores a usable retry');
    f.setResponse(signedIn); f.click('[data-author-session-retry]');
    await waitFor(() => Boolean(f.d.querySelector('.author-hub-heading')), 'The original session still recovers');
    assert.equal(f.calls.filter(path => path === '/api/author/session').length, 3);
    assert.equal(f.calls.includes('/api/author/login-challenge'), false);
    assert.deepEqual(f.identityEvents, []);
  } finally { await f.close(); }
});

for (const [name, lateResponse] of [
  ['empty session', () => json(null)],
  ['HTTP 503', () => json({ error: 'Synthetic old outage' }, 503)],
]) {
  test(`a delayed ${name} cannot overwrite an author identity confirmed after the request began`, async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const f = await fixture(() => pending);
    try {
      f.click('[data-author-login]');
      assert.equal(f.calls.filter(path => path === '/api/author/session').length, 1);
      f.w.dispatchEvent(new f.w.CustomEvent('author:identity', { detail: { name: 'Current synthetic owner' } }));
      finish(lateResponse()); await tick(); await tick();
      assert.equal(f.d.querySelector('[data-author-form="login"]'), null, 'An old response must not ask the new identity to sign in again');
      assert.equal(f.d.querySelector('[data-author-session-retry]'), null, 'An old outage must not replace the current identity with a recovery screen');
      f.click('[data-author-login]');
      await waitFor(() => Boolean(f.d.querySelector('.author-hub-heading')), 'The currently confirmed author remains available');
      assert.equal(f.calls.filter(path => path === '/api/author/session').length, 1, 'The confirmed identity does not need another lookup');
      assert.equal(f.calls.includes('/api/author/login-challenge'), false);
      assert.equal(f.identityEvents.length, 1, 'Only the explicit synthetic identity change was emitted');
    } finally { await f.close(); }
  });
}

test('closing a recovery attempt prevents its late response from reopening the author panel', async () => {
  const f = await fixture(() => json({ error: 'Synthetic outage' }, 503));
  try {
    f.click('[data-author-login]');
    await waitFor(() => Boolean(f.d.querySelector('[data-author-session-retry]')), 'Recovery is available');
    let finish;
    f.setResponse(() => new Promise(resolve => { finish = resolve; }));
    f.click('[data-author-session-retry]');
    f.click('[data-author-close]');
    finish(json(null)); await tick(); await tick();
    assert.equal(f.d.getElementById('author-dialog').getAttribute('aria-hidden'), 'true');
    assert.equal(f.calls.includes('/api/author/login-challenge'), false, 'A closed request cannot mount a later login gate');
  } finally { await f.close(); }
});

test('a known author keeps the original hub without a redundant session lookup', async () => {
  const f = await fixture(() => { throw new Error('The known session should not be fetched'); }, { name: 'Existing synthetic owner' });
  try {
    f.click('[data-author-login]');
    assert.ok(f.d.querySelector('.author-hub-heading'));
    assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});
