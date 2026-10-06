import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readerGate, readerPage, mountReaderUI } from '../src/reader-ui.ts';

for (const owner of [false, true]) test(`${owner ? 'owner' : 'reader'} sign-in returns to the original community route through the existing gate`, async () => {
  const destination = '#/community/home';
  const dom = new JSDOM('<body></body>', { url: 'https://www.sansphase.com/' + destination });
  const names = ['window', 'document', 'location', 'history', 'fetch', 'CustomEvent', 'FormData'];
  const old = new Map(names.map(name => [name, globalThis[name]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, history: dom.window.history, CustomEvent: dom.window.CustomEvent, FormData: dom.window.FormData,
    fetch: async () => ({ ok: true, json: async () => owner ? { role: 'owner', name: '作者' } : { nickname: '读者', email: 'reader@example.test' } }) });
  let identity = null, author = null, studio = 0;
  const render = () => { document.body.innerHTML = location.hash === '#/account' ? readerPage('account', '', identity, false, true, author) : '<section data-community-entry><button data-author-login>作者台</button></section>'; };
  try {
    document.body.innerHTML = readerGate();
    mountReaderUI({ render, onIdentity: value => { identity = value; } });
    document.addEventListener('click', event => { if (event.target.closest('[data-author-login]')) studio++; });
    window.addEventListener('author:identity', event => { author = event.detail; render(); });
    const gateClick = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    gateClick.preventDefault();
    document.querySelector('[data-reader-return]').dispatchEvent(gateClick);
    history.replaceState(null, '', '/#/account'); render();
    const form = document.querySelector('[data-reader-form="login"]');
    form.querySelector('[name="email"]').value = 'reader@example.test';
    form.querySelector('[name="password"]').value = 'test-password-long';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(location.hash, destination);
    assert.equal(studio, 0, 'community return must not open the author studio over the entry page');
    assert.equal(Boolean(owner ? author : identity), true);
  } finally {
    dom.window.close();
    for (const [name, value] of old) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
  }
});

test('HK existing sign-out control delegates to community logout without invoking main-site identity mutation', async () => {
  const dom = new JSDOM('<body><button data-reader-logout>退出社区</button></body>', { url: 'https://community.sansphase.com/#/community/home' });
  const names = ['window', 'document', 'location', 'fetch'];
  const old = new Map(names.map(name => [name, globalThis[name]]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, fetch: () => assert.fail('custom HK logout owns the request') });
  let exits = 0;
  try {
    mountReaderUI({ render: () => assert.fail('must not render main account'), onIdentity: () => assert.fail('must not clear main reader identity'), onLogout: async () => { exits++; } });
    document.querySelector('button').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(exits, 1); assert.equal(location.hash, '#/community/home');
  } finally { dom.window.close(); for (const [name, value] of old) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } }
});
