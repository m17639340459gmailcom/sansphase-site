import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readerPage, mountReaderUI, readerInvitation } from '../src/reader-ui.ts';

const code = 'a'.repeat(24);
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
test('invitation query accepts exactly one opaque code and rejects arrays, redirects and malformed values', () => {
  assert.deepEqual(readerInvitation(''), { present: false, code: null });
  assert.deepEqual(readerInvitation(`?invite=${code}`), { present: true, code });
  for (const search of ['?invite=', '?invite=../admin', '?invite=https://evil.example', `?invite=${code}&invite=${code}`, '?invite=%00']) {
    assert.deepEqual(readerInvitation(search), { present: true, code: null });
  }
});

test('the existing registration form carries the invitation only on register, and clearing it preserves ordinary registration', async () => {
  const dom = new JSDOM('<body></body>', { url: `https://www.sansphase.com/?invite=${code}#/account` });
  const globals = ['window', 'document', 'location', 'history', 'fetch', 'FormData', 'CustomEvent'];
  const previous = new Map(globals.map(key => [key, globalThis[key]]));
  const calls = [];
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, history: dom.window.history,
    FormData: dom.window.FormData, CustomEvent: dom.window.CustomEvent,
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ message: '验证码已发送', requestId: '11111111-1111-4111-8111-111111111111' }) }; } });
  const render = () => { document.body.innerHTML = readerPage('account', '', null); };
  try {
    render(); mountReaderUI({ render, onIdentity: () => {} });
    const form = document.querySelector('[data-reader-form="register"]'); assert.ok(form);
    assert.match(form.textContent, /邀请/);
    for (const [name, value] of Object.entries({ nickname: '新读者', email: 'new@example.test', phone: '13800138000', password: 'password123' })) form.querySelector(`[name="${name}"]`).value = value;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await turn();
    assert.equal(calls[0].url, '/api/reader/register'); assert.equal(calls[0].body.inviteCode, code);
    const verify = document.querySelector('[data-reader-form="verify"]'); assert.ok(verify);
    verify.querySelector('[name="code"]').value = '123456';
    verify.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await turn();
    assert.equal(calls[1].url, '/api/reader/verify'); assert.equal(calls[1].body.inviteCode, undefined);
    document.querySelector('[data-reader-mode="register"]').click(); await turn();
    document.querySelector('[data-reader-invite-clear]').click(); await turn();
    assert.equal(location.search, ''); assert.ok(document.querySelector('[data-reader-form="register"]'));
  } finally { dom.window.close(); for (const [key, value] of previous) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});
