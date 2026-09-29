import test from 'node:test';
import assert from 'node:assert/strict';
import { publicRoute, publicKind, visibleBootstrap } from '../server/reader-access.ts';
import { createPreviewServer } from '../server.mjs';
import { JSDOM } from 'jsdom';
import { readerPage, mountReaderUI } from '../src/reader-ui.mjs';
import { readFile } from 'node:fs/promises';

const data = {
  source: 'cms', profile: { name: 'Author' }, announcements: [],
  notes: [{ id: 'post', title: 'Public post', bodyHTML: '<p>Public body</p>', tags: [] }],
  works: [{ id: 'work', title: 'Private work', bodyHTML: '<p>Private body</p>', tags: [] }],
  resources: [], software: [], 'resource-center': [{ id: 'book', title: 'Private book', bodyHTML: '<p>Private chapter</p>', tags: [] }],
};

test('successful email verification returns the previous registration form to sign-in mode', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4203/#/account' });
  const originals = Object.fromEntries(['window', 'document', 'location', 'fetch'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location,
    fetch: async () => ({ ok: true, json: async () => ({ message: 'verified' }) }) });
  try {
    const render = () => { document.body.innerHTML = readerPage('account', '', null, false, true); };
    render();
    const ui = mountReaderUI({ render, onIdentity: () => {} });
    document.querySelector('[data-reader-mode="register"]').click();
    assert(document.querySelector('[data-reader-form="register"]'));
    document.body.innerHTML = readerPage('verify', 'valid-test-token', null, false, true);
    ui.route('verify', 'valid-test-token');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('[data-reader-verified]').hidden, false);
    render();
    assert(document.querySelector('[data-reader-form="login"]'), 'Sign in now must open the login form');
  } finally { Object.assign(globalThis, originals); dom.window.close(); }
});

test('a hidden verification retry stays hidden despite primary-button layout styles', async () => {
  const css = await readFile(new URL('../src/reader.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<!doctype html><head><style>${css}</style></head><body>${readerPage('verify', 'test-token', null, false, true)}</body>`);
  try { assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('[data-reader-verify]')).display, 'none'); }
  finally { dom.window.close(); }
});

test('guest policy allows home and complete blog articles only', () => {
  for (const page of ['home', 'notes', 'note']) assert.equal(publicRoute(page), true);
  for (const page of ['works', 'work', 'resources', 'software', 'resource-center', 'community', 'support', 'contact']) assert.equal(publicRoute(page), false);
  assert.equal(publicKind('notes'), true);
  assert.equal(publicKind('works'), false);
  const guest = visibleBootstrap(data, false);
  assert.equal(guest.notes.length, 1);
  assert.equal(guest.works.length, 0);
  assert.equal(guest['resource-center'].length, 0);
  assert.equal(guest.announcements.length, 0);
  assert.equal(visibleBootstrap(data, true).works.length, 1);
});

test('HTTP content cannot bypass membership with public=1, legacy responses, or 304', async t => {
  let signedIn = false;
  const readerService = { registrationEnabled: false, identity: async () => signedIn ? { id: 'reader', nickname: 'Reader' } : null };
  let snapshotCalls = 0;
  const contentService = { snapshot: async () => { snapshotCalls++; return { data }; } };
  const server = createPreviewServer({ contentService, readerService });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const gated = `${base}/api/content?view=detail&kind=works&id=work&public=1`;
  assert.equal((await fetch(gated)).status, 401);
  assert.equal((await fetch(gated, { headers: { 'If-None-Match': '*' } })).status, 401);
  assert.equal((await fetch(`${base}/api/content?view=book-part&kind=resource-center&id=book&chapter=0`)).status, 401);
  assert.equal(snapshotCalls, 0, 'unauthorized requests must not rebuild or read the publication snapshot');
  assert.equal((await fetch(`${base}/api/content?view=detail&kind=notes&id=post`)).status, 200);
  const legacy = await (await fetch(`${base}/api/content`)).text();
  assert.equal(JSON.parse(legacy).readerRegistrationEnabled, false);
  assert(!legacy.includes('Private body'));
  assert(!legacy.includes('Private chapter'));
  assert((await (await fetch(`${base}`)).text()).includes('Public post') === false); // bootstrap contains metadata only
  signedIn = true;
  assert.equal((await fetch(gated)).status, 200);
  assert((await (await fetch(`${base}/api/content`)).text()).includes('Private body'));
});

test('without email delivery the registration tab explains the pause instead of showing a form', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4194/#/account' });
  const oldDocument = globalThis.document, oldLocation = globalThis.location;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  try {
    const render = () => { dom.window.document.body.innerHTML = readerPage('account', '', null, false, false); };
    render();
    mountReaderUI({ render, onIdentity: () => {} });
    dom.window.document.querySelector('[data-reader-mode="register"]').click();
    assert.match(dom.window.document.body.textContent, /注册暂未开放/);
    assert.equal(dom.window.document.querySelector('[data-reader-form="register"]'), null);
    assert.equal(dom.window.document.querySelector('[data-reader-form="forgot"]'), null);
  } finally {
    globalThis.document = oldDocument;
    globalThis.location = oldLocation;
    dom.window.close();
  }
});

test('registration requires a phone field and owner sign-in opens the author studio', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4196/#/account' });
  const originals = Object.fromEntries(['window','document','location','fetch','CustomEvent','FormData'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, CustomEvent: dom.window.CustomEvent, FormData: dom.window.FormData,
    fetch: async () => ({ ok: true, json: async () => ({ role: 'owner', name: 'Owner' }) }) });
  let readerIdentity = false, ownerIdentity, studioOpened = false;
  try {
    const render = () => { document.body.innerHTML = location.hash === '#/account'
      ? readerPage('account', '', null, false, true, ownerIdentity)
      : '<button type="button" data-author-login>作者台</button>'; };
    render();
    mountReaderUI({ render, onIdentity: () => { readerIdentity = true; } });
    document.addEventListener('click', event => { if (event.target.closest('[data-author-login]')) studioOpened = true; });
    document.querySelector('[data-reader-mode="register"]').click();
    assert(document.querySelector('[data-reader-form="register"] [name="phone"][required]'));
    const phone = document.querySelector('[data-reader-form="register"] [data-reader-phone]');
    assert.equal(phone.getAttribute('pattern'), '1[3-9][0-9]{9}');
    phone.value = '66666666';
    phone.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(phone.validationMessage, '请输入正确的手机号');
    phone.value = '13800138000';
    phone.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(phone.validationMessage, '');
    assert.match(document.body.textContent, /连续 30 天未登录/);
    document.querySelector('[data-reader-mode="login"]').click();
    window.addEventListener('author:identity', event => { ownerIdentity = event.detail; render(); });
    const form = document.querySelector('[data-reader-form="login"]');
    form.querySelector('[name="email"]').value = 'owner@example.test';
    form.querySelector('[name="password"]').value = 'owner-secret-long';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(location.hash, '#/notes');
    assert.equal(ownerIdentity.role, 'owner');
    assert.equal(studioOpened, true);
    assert.equal(readerIdentity, false);
  } finally {
    Object.assign(globalThis, originals);
    dom.window.close();
  }
});

test('the password eye reveals and hides entered text without submitting login, registration or reset', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4196/#/account' });
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const render = () => { document.body.innerHTML = readerPage('account', '', null); };
    render();
    mountReaderUI({ render, onIdentity: () => {} });
    document.querySelector('[data-reader-mode="login"]').click();
    for (const formName of ['login', 'register', 'reset']) {
      if (formName === 'register') document.querySelector('[data-reader-mode="register"]').click();
      if (formName === 'reset') document.body.innerHTML = readerPage('reset', 'test-token');
      const form = document.querySelector(`[data-reader-form="${formName}"]`);
      const input = form.querySelector('[name="password"]');
      const toggle = form.querySelector('[data-reader-password-toggle]');
      let submits = 0;
      form.addEventListener('submit', event => { event.preventDefault(); submits++; });
      input.value = 'Abcdef12!';
      input.setSelectionRange(3, 3);
      toggle.click();
      assert.equal(input.type, 'text');
      assert.equal(input.value, 'Abcdef12!');
      assert.equal(input.selectionStart, 3);
      assert.equal(toggle.getAttribute('aria-pressed'), 'true');
      assert.equal(toggle.getAttribute('aria-label'), '隐藏密码');
      toggle.click();
      assert.equal(input.type, 'password');
      assert.equal(input.value, 'Abcdef12!');
      assert.equal(toggle.getAttribute('aria-pressed'), 'false');
      assert.equal(submits, 0);
    }
    document.body.innerHTML = readerPage('account', '', null, true);
    assert.equal(document.querySelector('[data-reader-password-toggle]').getAttribute('aria-label'), 'Show password');
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

test('successful email verification shows a clear account-ready panel and sign-in action', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4196/#/verify/test-token' });
  const previous = Object.fromEntries(['document', 'fetch'].map(key => [key, globalThis[key]]));
  globalThis.document = dom.window.document;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ message: '邮箱验证成功，账号已启用。现在可以登录。' }) });
  try {
    document.body.innerHTML = readerPage('verify', 'test-token');
    const ui = mountReaderUI({ render: () => {}, onIdentity: () => {} });
    assert.equal(document.querySelector('[data-reader-verified]').hidden, true);
    ui.route('verify', 'test-token');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('[data-reader-verified]').hidden, false);
    assert.match(document.querySelector('[data-reader-verified]').textContent, /注册验证成功/);
    assert.equal(document.querySelector('[data-reader-verified] a').getAttribute('href'), '#/account');
  } finally {
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});

test('reader profile shows the stable UID, VIP state and editable contact phone', () => {
  const html = readerPage('account', '', { uid: '0007', nickname: '读者', email: 'reader@example.test', phone: '13800138000', signature: '在星光里继续阅读', vip: true, vipUntil: '2026-10-24T08:00:00.000Z' });
  assert.match(html, /UID 0007/);
  assert.match(html, /VIP/);
  assert.match(html, /VIP 会员/);
  assert.match(html, /reader-profile-card--vip/);
  assert.match(html, /name="phone"[^>]+value="13800138000"/);
  assert.match(html, /name="signature"[^>]+value="在星光里继续阅读"/);
  assert.match(html, /reader-profile-card/);
  assert.match(html, /未经短信验证/);
});

test('reader signature is optional, escaped and never treated as markup', () => {
  const html = readerPage('account', '', { uid: '0008', nickname: '读者', email: 'reader@example.test', phone: '13800138000', signature: '<script>oops</script>', vip: false });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;oops&lt;\/script&gt;/);
  const blank = readerPage('account', '', { uid: '0008', nickname: '读者', email: 'reader@example.test', phone: '13800138000', vip: false });
  assert.match(blank, /还没有填写个性签名/);
});

test('reader profile offers avatar upload and reset without changing the account form', () => {
  const reader = { uid: '0008', nickname: '读者', email: 'reader@example.test', phone: '13800138000', signature: '', vip: false };
  const plain = readerPage('account', '', reader);
  assert.match(plain, /data-reader-avatar-trigger/);
  assert.match(plain, /data-reader-avatar-pick/);
  assert.match(plain, /data-reader-avatar-file/);
  assert.doesNotMatch(plain, /reader-avatar-editor/);
  assert.doesNotMatch(plain, /data-reader-avatar-remove/);
  const custom = readerPage('account', '', { ...reader, avatar: '/api/reader/avatar/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.webp' });
  assert.match(custom, /data-reader-avatar-remove/);
  assert.match(custom, /reader-profile-avatar-image/);
  assert.match(custom, /data-reader-form="profile"/);
});

test('clicking the avatar opens its controls; outside click and Escape close them', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://127.0.0.1:4196/#/account' });
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const reader = { uid: '0008', nickname: '读者', email: 'reader@example.test', phone: '13800138000', avatar: null, vip: false };
    const render = () => { document.body.innerHTML = readerPage('account', '', reader); };
    render();
    mountReaderUI({ render, onIdentity: () => {} });
    const trigger = document.querySelector('[data-reader-avatar-trigger]');
    const panel = document.querySelector('[data-reader-avatar-panel]');
    assert.equal(panel.hidden, true);
    trigger.click();
    assert.equal(panel.hidden, false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    document.querySelector('.reader-heading').click();
    assert.equal(panel.hidden, true);
    trigger.click();
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(panel.hidden, true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

test('a signed-in owner enters the writing studio, with management kept inside it', () => {
  const html = readerPage('account', '', null, false, true, { name: '站长' });
  assert.match(html, /作者账号/);
  assert.match(html, /站长/);
  assert.match(html, /data-author-login/);
  assert.doesNotMatch(html, /href="#\/admin"/);
  assert.doesNotMatch(html, /data-reader-form="login"/);
});
