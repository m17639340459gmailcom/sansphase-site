import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { adminReadersPage, mountReaderAdmin } from '../src/admin-readers.mjs';

test('admin search keeps rows while loading; VIP filters preserve search; review categories switch individually', async () => {
  const dom = new JSDOM(`<main>${adminReadersPage({ name: 'Owner' })}</main>`, { url: 'http://localhost/#/admin' });
  const previous = Object.fromEntries(['window', 'document', 'fetch', 'FormData'].map(key => [key, globalThis[key]]));
  const pending = [];
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FormData: dom.window.FormData,
    fetch: (url) => new Promise(resolve => pending.push({ url, resolve })) });
  const root = document.querySelector('main');
  root.querySelector('dialog').close = () => {};
  const cleanup = mountReaderAdmin(root);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const data = { users: [{ id: 'fixture', uid: '123456', email: 'fixture@example.test', nickname: 'Fixture reader', createdAt: new Date().toISOString() }], total: 1, totalPages: 1, summary: { total: 1, active: 1, disabled: 0 } };
  const finish = async (value = data) => { pending.shift().resolve({ ok: true, json: async () => value }); await settle(); };
  const submit = form => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  try {
    await finish();
    const rows = root.querySelector('#reader-admin-list');
    const oldTable = rows.querySelector('table');
    const search = root.querySelector('#reader-admin-search');
    search.elements.q.value = 'Fixture';
    submit(search);
    assert.equal(rows.querySelector('table'), oldTable, 'search must not collapse the result area while awaiting response');
    assert.equal(rows.getAttribute('aria-busy'), 'true');
    await finish();
    assert.equal(rows.getAttribute('aria-busy'), 'false');
    root.querySelector('[data-admin-view="memberships"]').click();
    await finish();
    const vip = root.querySelector('[data-admin-member-filter="vip"]');
    const expired = root.querySelector('[data-admin-member-filter="expired"]');
    assert(vip && expired);
    vip.click();
    assert.equal(new URL(pending[0].url, 'http://localhost').searchParams.get('membership'), 'vip');
    await finish();
    const form = root.querySelector('#reader-admin-member-search');
    form.elements.q.value = '123456'; submit(form);
    let params = new URL(pending[0].url, 'http://localhost').searchParams;
    assert.equal(params.get('q'), '123456'); assert.equal(params.get('membership'), 'vip');
    await finish();
    expired.click();
    params = new URL(pending[0].url, 'http://localhost').searchParams;
    assert.equal(params.get('q'), '123456'); assert.equal(params.get('membership'), 'expired');
    assert.equal(expired.getAttribute('aria-pressed'), 'true');
    await finish();
    root.querySelector('[data-admin-view="review"]').click();
    await finish({ profiles: [], expired: [], files: [], versions: [], media: [] });
    const visibleCategories = () => [...root.querySelectorAll('[data-admin-review-panel]')].filter(el => !el.hidden);
    assert.equal(visibleCategories().length, 1);
    assert.equal(visibleCategories()[0].dataset.adminReviewPanel, 'profiles');
    root.querySelector('[data-admin-review-tab="expired"]').click();
    assert.equal(visibleCategories().length, 1);
    assert.equal(visibleCategories()[0].dataset.adminReviewPanel, 'expired');
    assert.equal(pending.length, 0, 'category changes reuse the loaded review queue');
  } finally { cleanup(); Object.assign(globalThis, previous); dom.window.close(); }
});
