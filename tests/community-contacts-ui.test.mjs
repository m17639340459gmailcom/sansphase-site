import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { communityRulesHTML } from '../src/community-pages.ts';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const ok = data => ({ ok: true, json: async () => structuredClone(data) });
const denied = () => ({ ok: false, status: 403, json: async () => ({ error: '需要管理权限' }) });
const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const contacts = { items: [{ uid: '10003', name: '守望', owner: false, boards: ['qa', 'tools'], qq: '1234567', email: 'moderator@example.test' }] };

async function setup(t, hash, role = 'steward', handle = () => null) {
  const dom = new JSDOM('<main></main>', { url: `http://localhost/${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  const calls = [];
  const manager = role === 'owner' || role === 'steward';
  const me = { name: '守望', uid: '10003', role: role === 'owner' ? 'owner' : 'reader', owner: role === 'owner', mod: manager, moderationBoards: ['qa', 'tools'], management: manager ? { role, browsingAsReader: false } : null, unread: { all: 0 }, agreed: true, moderationContact: manager ? { qq: '1234567', email: '' } : null };
  const manage = { tab: 'queue', owner: me.owner, counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, queue: { topics: [], replies: [] }, reports: [], orders: [], items: [], sanctions: [], data: null };
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    const supplied = handle(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return role === 'guest' ? denied() : ok(me);
    if (url.includes('/moderation-contacts')) return role === 'guest' ? denied() : ok(contacts);
    if (url.endsWith('/convention')) return role === 'guest' ? denied() : ok({ version: 'one', body: '## 公约\n\n- 原公约正文' });
    if (url.includes('/manage?')) return manager ? ok(manage) : denied();
    if (url.endsWith('/me/contact')) { me.moderationContact = JSON.parse(init.body); return ok(me.moderationContact); }
    throw Error(url);
  };
  const main = w.document.querySelector('main');
  const ui = createCommunityUI({ request }); main.innerHTML = ui.html(common); const cleanup = ui.mount(main, common);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  await turn(); await turn();
  return { main, w, calls };
}

test('logged-in readers can find assigned moderator contacts in the convention', async t => {
  const { main, calls } = await setup(t, '#/community/rules', 'reader');
  assert.equal(main.querySelector('h1').textContent, '社区公约');
  assert.match(main.querySelector('[data-moderation-contacts]').textContent, /守望[\s\S]*学习问答[\s\S]*工具资源[\s\S]*1234567/);
  assert.equal(main.querySelector('[data-moderation-contacts] a[href="mailto:moderator%40example.test"]').textContent, 'moderator@example.test');
  assert.ok(calls.some(call => call.url === '/api/community/moderation-contacts'));
  assert.equal(main.querySelector('[data-community-form="moderation-contact"]'), null);
});

test('first community entry loads the mandatory convention above the page and starts the read request', async t => {
  const initial = { name: '读者', uid: '10001', role: 'reader', mod: false, owner: false, agreed: false, unread: { all: 0 }, convention: { version: 'one', agreed: false } };
  const { w, calls } = await setup(t, '#/community/rules', 'reader', (url, init) => {
    if (url.endsWith('/me')) return ok(initial);
    if (url.endsWith('/convention/read') && init.method === 'POST') return ok({ version: 'one', eligibleAt: new Date(Date.now() + 10000).toISOString() });
    return null;
  });
  const doc = w.document;
  const dialog = doc.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.match(dialog.querySelector('[data-convention-body]').textContent, /原公约正文/);
  assert.equal(dialog.querySelector('footer [data-convention-confirm]').disabled, true);
  assert.equal(doc.querySelector('main').inert, true);
  const ids = [...doc.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length, 'page and modal section ids must remain unique');
  assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith('/convention/read')).init.body), { version: 'one' });
  assert.equal(calls.some(call => call.url.endsWith('/agree')), false);
});

test('unauthenticated convention requests do not render terms or moderator contacts', async t => {
  const { main, w } = await setup(t, '#/community/rules', 'guest');
  assert.equal(main.querySelector('.community-rule-list'), null);
  assert.equal(main.querySelector('[data-moderation-contacts]'), null);
  assert.equal(w.document.querySelector('[role="dialog"]'), null);
});

test('only the owner gets the convention editor and publishes the displayed version without duplicate submission', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { main, w, calls } = await setup(t, '#/community/manage/convention', 'owner', (url, init) => url.endsWith('/manage/convention') && init.method === 'POST' ? pending : null);
  const form = main.querySelector('[data-community-form="convention"]');
  assert.ok(form);
  assert.equal(form.elements.version.value, 'one');
  assert.match(form.elements.body.value, /原公约正文/);
  form.elements.body.value = '## 修改后\n\n- 新条款';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await turn();
  const writes = calls.filter(call => call.url.endsWith('/manage/convention'));
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].init.body), { version: 'one', body: '## 修改后\n\n- 新条款' });
  finish(ok({ version: 'two', body: '## 修改后\n\n- 新条款' })); await turn(); await turn();
  assert.equal(w.location.hash, '#/community/manage/convention');
});

test('moderators cannot see the convention editing entry or form', async t => {
  const { main } = await setup(t, '#/community/manage/convention', 'steward');
  assert.equal(main.querySelector('[data-community-form="convention"]'), null);
  assert.equal(main.querySelector('.community-management-nav a[href="#/community/manage/convention"]'), null);
});

test('moderators set only their own optional public contact, without a page jump or duplicate submit', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { main, w, calls } = await setup(t, '#/community/manage/contact', 'steward', (url, init) => url.endsWith('/me/contact') && init.method === 'POST' ? pending : null);
  const form = main.querySelector('[data-community-form="moderation-contact"]');
  assert.ok(form);
  assert.match(form.textContent, /公开[\s\S]*留空/);
  assert.equal(form.elements.qq.value, '1234567');
  assert.equal(form.querySelectorAll('input').length, 2);
  form.elements.qq.value = ' 2345678 ';
  form.elements.email.value = ' moderator@example.test ';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await turn();
  const writes = calls.filter(call => call.url.endsWith('/me/contact'));
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].init.body), { qq: '2345678', email: 'moderator@example.test' });
  assert.equal(form.querySelector('button[type="submit"]').disabled, true);
  finish(ok({ qq: '2345678', email: 'moderator@example.test' }));
  await turn(); await turn();
  assert.equal(w.location.hash, '#/community/manage/contact');
  assert.equal(form.querySelector('button[type="submit"]').disabled, false);
  assert.match(form.querySelector('[role="status"]').textContent, /已保存/);
});

test('owners can clear public contacts, and invalid contact formats do not submit', async t => {
  const { main, w, calls } = await setup(t, '#/community/manage/contact', 'owner');
  const form = main.querySelector('[data-community-form="moderation-contact"]');
  assert.ok(form);
  const submit = () => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  form.elements.qq.value = 'qq.example'; submit();
  assert.equal(form.elements.qq.getAttribute('aria-invalid'), 'true');
  form.elements.qq.value = ''; form.elements.email.value = 'javascript:alert(1)'; submit();
  assert.equal(form.elements.email.getAttribute('aria-invalid'), 'true');
  assert.equal(calls.filter(call => call.url.endsWith('/me/contact')).length, 0);
  form.elements.email.value = ''; submit(); await turn();
  assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith('/me/contact')).init.body), { qq: '', email: '' });
  assert.match(form.querySelector('[role="status"]').textContent, /已保存/);
});

test('ordinary readers cannot render contact settings or receive a navigation entry', async t => {
  const { main } = await setup(t, '#/community/manage/contact', 'reader');
  assert.equal(main.querySelector('[data-community-form="moderation-contact"]'), null);
  assert.equal(main.querySelector('.community-management-nav a[href="#/community/manage/contact"]'), null);
});

test('the public contact renderer escapes names and ignores non-contact schemes', t => {
  const dom = new JSDOM(communityRulesHTML({ ...common, contacts: { state: 'ready', data: { items: [{ ...contacts.items[0], name: '<img src=x onerror=alert(1)>', email: 'javascript:alert(1)', qq: '<svg onload=alert(1)>' }] } } }));
  t.after(() => dom.window.close());
  const list = dom.window.document.querySelector('[data-moderation-contacts]');
  assert.ok(list);
  assert.equal(list.querySelector('img, svg, [href^="javascript:"]'), null);
  assert.match(list.textContent, /<img/);
});
