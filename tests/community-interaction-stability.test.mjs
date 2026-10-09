import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { communityAccountHTML } from '../src/community.ts';
import { communityStaffCapabilities } from '../src/community-staff.ts';

const person = { name: '测试成员', uid: 'u1', role: 'reader', level: 1, owner: false, mod: false, balance: 30, checkedIn: true, streak: 1, nextReward: { total: 10 }, unread: { all: 0 }, inventory: {}, agreed: true };
const topic = id => ({ id, board: 'qa', title: `讨论 ${id}`, author: person, createdAt: '2026-10-01T10:00:00Z', lastActivityAt: '2026-10-01T10:00:00Z', replies: 2, likes: 1 });
const listing = (ids, total = ids.length) => ({ items: ids.map(topic), total, page: 1, pageSize: 2 });
const thread = () => ({
  topic: { ...topic('p1'), body: '保留正在阅读的正文。', canReply: true, canDelete: false, liked: false, bookmarks: 0, bookmarked: false, images: [] },
  author: { ...person, topics: 3, replies: 4 }, related: [],
  replies: [1, 2].map(i => ({ id: `r${i}`, body: `回复 ${i}`, author: person, createdAt: `2026-10-01T10:0${i}:00Z`, likes: i, canDelete: false, byTopicAuthor: false })),
});
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const readerPreview = role => ({ ...person, management: { role, browsingAsReader: true } });
const personalReader = { ...person, uid: '10001', vip: true, management: { role: 'owner', browsingAsReader: true, interactive: true } };
function clipboardFixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied.push(value); } } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; });
  return copied;
}

async function setup(t, hash, handle = () => null, ctxOptions = {}) {
  const dom = new JSDOM('<main></main>', { url: `http://localhost/${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event', 'CustomEvent', 'getComputedStyle'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const requests = [];
  const request = async (url, init = {}) => {
    requests.push({ url, init });
    const supplied = handle(url, init);
    if (supplied) return supplied;
    if (url.endsWith('/me')) return response(person);
    if (url.endsWith('/summary')) return response({ total: 4, boards: {}, hot: [] });
    if (url.endsWith('/topics/p1')) return response(thread());
    if (url.includes('/topics?')) return response(listing(['p1', 'p2'], 4));
    if (url.endsWith('/like')) return response({ likes: 7 });
    if (url.endsWith('/bookmark')) return response({ bookmarks: 2 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const main = w.document.querySelector('main');
  const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: true, ...ctxOptions };
  const ui = createCommunityUI({ request });
  main.innerHTML = ui.html(ctx);
  let cleanup = ui.mount(main, ctx);
  t.after(() => {
    // Release DOM event handlers before restoring the test globals.
    w.history.replaceState(null, '', '#/home');
    cleanup();
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
    w.close();
  });
  await turn();
  const remount = async hash => {
    if (hash) w.history.replaceState(null, '', hash);
    cleanup();
    main.innerHTML = ui.html(ctx);
    cleanup = ui.mount(main, ctx);
    await turn();
  };
  return { w, main, ui, ctx, requests, remount };
}

const managementViewer = { ...person, name: '無相', uid: 'owner', role: 'owner', owner: true, mod: true, management: { role: 'owner', browsingAsReader: false } };
const managementData = { owner: true, tab: 'items', counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 1, replies24h: 2 }, queue: { topics: [], replies: [] }, reports: [], content: [topic('p1')], items: [], orders: [], sanctions: [], data: null };

const generalShopStaff = { role: 'general', boards: ['qa'], permissions: [], delegable: [], parent: { kind: 'owner', id: 'owner' } };
const generalShopViewer = { ...person, mod: true, staffRole: 'general', staff: generalShopStaff, level: 3, trustLevel: 3 };
const generalShopData = { ...managementData, owner: false, actorStaff: generalShopStaff, allowedTabs: ['items', 'contact'] };

const iconMember = (icon = null, selected = '') => ({ person: { ...person, icon }, self: true, canMute: false, canAppoint: false,
  stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 },
  counts: { topics: 0, replies: 0, bookmarks: 0 }, topics: [], replies: [], bookmarks: [], badges: [], bio: '', streak: 0,
  joinedAt: null, muted: null, quick: null, tab: 'icons', iconState: { selected, equipped: icon, available: ['growth:1', 'growth:2', 'trust:0'] } });

test('owned frames load and equip without remounting decoded previews; remove persists and parallel choices cannot race', async t => {
  let frame = null, writes = 0;
  const pending = deferred();
  const fixture = await setup(t, '#/community/u/u1/frames', (url, init) => {
    if (url.endsWith('/me')) return response({ ...person, frame });
    if (url.includes('/members/u1?')) return response({ ...iconMember(), person: { ...person, frame }, tab: 'frames' });
    if (url.endsWith('/profile')) return response({ person, canEditProfile: false, frames: [{ id: 'gold', name: '金色框', ref: 'gold', image: null }, { id: 'orbit', name: '轨道框', ref: 'orbit', image: null }] });
    if (url.endsWith('/shop/equip')) {
      writes++; const ref = JSON.parse(init.body).ref;
      const apply = () => { frame = ref; return response({ frame }); };
      return writes === 1 ? pending.promise.then(apply) : apply();
    }
  });
  const panel = fixture.main.querySelector('[data-community-frames]');
  assert.ok(panel);
  const gold = panel.querySelector('[data-frame-ref="gold"]'), preview = gold.querySelector('.community-av');
  gold.focus(); gold.click(); panel.querySelector('[data-frame-ref="orbit"]').click(); await turn();
  assert.equal(writes, 1);
  pending.resolve(); await turn(); await turn();
  assert.equal(fixture.main.querySelector('[data-community-frames]'), panel);
  assert.equal(panel.querySelector('[data-frame-ref="gold"]'), gold);
  assert.equal(gold.querySelector('.community-av'), preview);
  assert.equal(fixture.w.document.activeElement, gold);
  assert.equal(gold.getAttribute('aria-pressed'), 'true');
  panel.querySelector('[data-frame-ref=""]').click(); await turn(); await turn();
  assert.equal(frame, null);
  assert.deepEqual(fixture.requests.filter(call => call.url.endsWith('/shop/equip')).map(call => JSON.parse(call.init.body)), [{ kind: 'frame', ref: 'gold' }, { kind: 'frame', ref: null }]);
  await fixture.remount('#/community/u/u1/frames');
  assert.equal(fixture.main.querySelector('[data-frame-ref=""]').getAttribute('aria-pressed'), 'true');
});

test('a foreign member frames URL does not load private owned frames or permit a forged equip', async t => {
  const fixture = await setup(t, '#/community/u/other/frames', url => url.includes('/members/other?') ? response({ ...iconMember(), self: false, tab: 'frames', person: { ...person, uid: 'other' } }) : null);
  assert.equal(fixture.requests.some(call => call.url.endsWith('/profile')), false);
  assert.equal(fixture.main.querySelector('[data-community-frames]'), null);
});

test('failed frame saves retain owned previews and reject a ref outside the owned collection', async t => {
  const fixture = await setup(t, '#/community/u/u1/frames', url => {
    if (url.includes('/members/u1?')) return response({ ...iconMember(), tab: 'frames' });
    if (url.endsWith('/profile')) return response({ person, frames: [{ id: 'gold', name: '金色框', ref: 'gold', image: null }] });
    if (url.endsWith('/shop/equip')) return new Response(JSON.stringify({ error: '请稍后重试' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  });
  const panel = fixture.main.querySelector('[data-community-frames]'), choice = panel.querySelector('[data-frame-ref="gold"]');
  choice.dataset.frameRef = 'nebula'; choice.click(); await turn();
  assert.equal(fixture.requests.filter(call => call.url.endsWith('/shop/equip')).length, 0);
  choice.dataset.frameRef = 'gold'; choice.click(); await turn(); await turn();
  assert.equal(fixture.main.querySelector('[data-community-frames]'), panel);
  assert.equal(choice.disabled, false);
  assert.equal(panel.hasAttribute('aria-busy'), false);
  assert.equal(choice.hasAttribute('aria-disabled'), false);
  assert.equal(choice.getAttribute('aria-pressed'), 'false');
});

test('choosing an icon is serialized, survives a refresh, and keeps take-off distinct from default', async t => {
  const pending = deferred();
  let selection = '', effective = null, writes = 0;
  let headerChanges = 0;
  const fixture = await setup(t, '#/community/u/u1/icons', (url, init) => {
    if (url.endsWith('/me')) return response({ ...person, icon: effective });
    if (url.includes('/members/u1?')) return response(iconMember(effective, selection));
    if (url.endsWith('/shop/equip')) {
      writes++;
      const { ref } = JSON.parse(init.body);
      const apply = () => { selection = ref; effective = ref || null; return response({ icon: effective }); };
      return writes === 1 ? pending.promise.then(apply) : Promise.resolve(apply());
    }
  }, { headerChanged: () => { headerChanges++; } });
  const beforeIconChange = headerChanges;
  const panelBefore = fixture.main.querySelector('[data-community-icons]');
  const choicesBefore = [...panelBefore.querySelectorAll('[data-icon-ref]')];
  const artworkBefore = choicesBefore.map(button => button.querySelector('.community-icon-choice-art'));
  const first = fixture.main.querySelector('[data-icon-ref="growth:1"]');
  const second = fixture.main.querySelector('[data-icon-ref="growth:2"]');
  first.click(); second.click(); await turn();
  assert.equal(writes, 1, 'different buttons cannot race to equip two different selections');
  assert.equal(fixture.main.querySelector('[data-community-icons]').getAttribute('aria-busy'), 'true');
  pending.resolve(); await turn(); await turn();
  assert.equal(fixture.main.querySelector('[data-community-icons]'), panelBefore, 'saving does not replace the icon panel or replay its entry');
  assert.deepEqual([...panelBefore.querySelectorAll('[data-icon-ref]')], choicesBefore, 'the existing card buttons stay attached');
  assert.deepEqual(choicesBefore.map(button => button.querySelector('.community-icon-choice-art')), artworkBefore, 'artwork nodes are retained');
  assert.ok(headerChanges > beforeIconChange, 'changing only the icon refreshes the header for the same account');
  assert.match(communityAccountHTML({ ...fixture.ctx, me: fixture.ui.me() }), /data-name-icon="growth:1"/);
  assert.equal(fixture.main.querySelector('.community-m-name [data-name-icon]').dataset.nameIcon, 'growth:1');
  assert.equal(fixture.main.querySelectorAll('[data-icon-ref][aria-pressed="true"]').length, 1);
  fixture.main.querySelector('[data-icon-mode="none"]').click(); await turn(); await turn();
  assert.equal(fixture.main.querySelector('.community-m-name [data-name-icon]'), null);
  fixture.main.querySelector('[data-icon-mode="default"]').click(); await turn(); await turn();
  assert.deepEqual(fixture.requests.filter(call => call.url.endsWith('/shop/equip')).map(call => JSON.parse(call.init.body)),
    [{ kind: 'icon', ref: 'growth:1' }, { kind: 'icon', ref: '' }, { kind: 'icon', ref: null }]);
  await fixture.remount('#/community/u/u1/icons');
  assert.equal(fixture.main.querySelector('[data-icon-mode="default"]').getAttribute('aria-pressed'), 'true');
});

test('locked icon controls cannot submit a forged wearable, and failed saves restore the choice grid', async t => {
  const notices = [];
  const fixture = await setup(t, '#/community/u/u1/icons', (url, init) => {
    if (url.includes('/members/u1?')) return response(iconMember());
    if (url.endsWith('/shop/equip')) return Promise.resolve(new Response(JSON.stringify({ error: '资格已失效' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
  }, { notify: value => notices.push(value) });
  fixture.main.querySelector('[data-icon-category="staff"]').click();
  const unavailable = fixture.main.querySelector('[data-icon-ref="staff:general"]');
  unavailable.disabled = false; unavailable.click(); await turn();
  assert.equal(fixture.requests.filter(call => call.url.endsWith('/shop/equip')).length, 0);
  fixture.main.querySelector('[data-icon-category="growth"]').click();
  fixture.main.querySelector('[data-icon-ref="growth:1"]').click(); await turn(); await turn();
  assert.equal(fixture.main.querySelector('[data-icon-ref="growth:1"]').disabled, false);
  assert.equal(fixture.main.querySelector('[data-icon-ref="growth:6"]').disabled, true);
  assert.equal(fixture.main.querySelector('[data-community-icons]').hasAttribute('aria-busy'), false);
  assert.equal(fixture.main.querySelector('[data-icon-mode="none"]').getAttribute('aria-pressed'), 'true');
  assert.ok(notices.includes('资格已失效'));
});

test('category and page browsing stays local; equipping on a later page retains its cards and focus', async t => {
  let selection = '', effective = null;
  const fixture = await setup(t, '#/community/u/u1/icons', (url, init) => {
    if (url.endsWith('/me')) return response({ ...person, icon: effective });
    if (url.includes('/members/u1?')) return response({ ...iconMember(effective, selection), iconState: { selected: selection, equipped: effective, available: ['growth:1', 'growth:8'] } });
    if (url.endsWith('/shop/equip')) { selection = JSON.parse(init.body).ref; effective = selection; return response({ icon: effective }); }
  });
  const panel = fixture.main.querySelector('[data-community-icons]'), reads = fixture.requests.length;
  fixture.main.querySelector('[data-icon-page="next"]').click();
  assert.equal(panel.dataset.iconCurrentPage, '2');
  assert.equal(fixture.main.querySelector('[data-icon-ref="growth:1"]'), null);
  const target = fixture.main.querySelector('[data-icon-ref="growth:8"]'), art = target.querySelector('.community-icon-choice-art');
  assert.equal(fixture.requests.length, reads, 'browsing does not request the account or catalogue again');
  target.focus(); target.click(); await turn(); await turn();
  assert.equal(fixture.main.querySelector('[data-community-icons]'), panel);
  assert.equal(fixture.main.querySelector('[data-icon-ref="growth:8"]'), target);
  assert.equal(target.querySelector('.community-icon-choice-art'), art);
  assert.equal(fixture.w.document.activeElement, target);
  assert.equal(target.getAttribute('aria-pressed'), 'true');
});

test('a qualification lost during saving stays grey and disabled after the request finishes', async t => {
  let saved = false;
  const fixture = await setup(t, '#/community/u/u1/icons', url => {
    if (url.endsWith('/me')) return response({ ...person, icon: null });
    if (url.includes('/members/u1?')) return response(saved ? { ...iconMember(), iconState: { selected: 'growth:1', equipped: null, available: [] } } : iconMember());
    if (url.endsWith('/shop/equip')) { saved = true; return response({ icon: null }); }
  });
  const card = fixture.main.querySelector('[data-icon-ref="growth:1"]');
  card.click(); await turn(); await turn();
  assert.equal(fixture.main.querySelector('[data-icon-ref="growth:1"]'), card);
  assert.equal(card.dataset.iconLocked, 'true'); assert.equal(card.disabled, true);
  assert.ok(fixture.main.querySelector('.community-icon-expired'));
});

test('an existing general sees the shared product editor and submits edits and categories without owner-only sections', async t => {
  const item = { id: 'general-edit', cat: 'digital', kind: 'digital', name: '社区工作流', desc: '供社区读者兑换的工作流。', price: 8, stock: null, active: true, delivery: '兑换后内容', builtin: false };
  const f = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(generalShopViewer);
    if (url.includes('/manage?')) return response({ ...generalShopData, items: [item] });
    if (url.endsWith('/manage/items/general-edit')) return response({ id: item.id });
    if (url.endsWith('/manage/categories')) return response({ id: 'new-category', name: '工作流' });
    return null;
  });
  assert.ok(f.main.querySelector('.community-management-nav a[href="#/community/manage/items"]'));
  for (const tab of ['orders', 'boards', 'convention']) assert.equal(f.main.querySelector(`.community-management-nav a[href="#/community/manage/${tab}"]`), null);
  f.main.querySelector('[data-action="community-item-edit"][data-id="general-edit"]').click();
  const form = f.main.querySelector('[data-community-form="item"]');
  assert.ok(form); form.elements.namedItem('name').value = '更新后的社区工作流';
  form.dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true })); await turn(); await turn();
  const saved = f.requests.find(call => call.url.endsWith('/manage/items/general-edit'));
  assert.equal(JSON.parse(saved.init.body).name, '更新后的社区工作流');
  const category = f.main.querySelector('[data-community-form="category"]');
  assert.ok(category); category.elements.namedItem('name').value = '工作流';
  category.dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.deepEqual(JSON.parse(f.requests.find(call => call.url.endsWith('/manage/categories')).init.body), { name: '工作流' });
});

test('a general publication shortcut submits the exact unlist patch once and preserves pending-button feedback', async t => {
  const pending = deferred(), item = { id: 'general-unlist', cat: 'digital', kind: 'digital', name: '社区资源', desc: '资源说明', price: 8, stock: null, active: true, delivery: '', builtin: false };
  const f = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(generalShopViewer);
    if (url.includes('/manage?')) return response({ ...generalShopData, items: [item] });
    if (url.endsWith('/manage/items/general-unlist')) return pending.promise;
    return null;
  });
  const button = f.main.querySelector('[data-action="community-item-active"]');
  assert.ok(button); button.click(); button.click();
  const writes = f.requests.filter(call => call.url.endsWith('/manage/items/general-unlist'));
  assert.equal(writes.length, 1); assert.deepEqual(JSON.parse(writes[0].init.body), { active: false });
  assert.equal(button.disabled, true);
  item.active = false; pending.resolve(response({ id: item.id })); await turn(); await turn();
  assert.match(f.main.querySelector('[data-action="community-item-active"]').textContent, /重新上架/);
});

test('authors correct an unredeemed product into a make-up card without replacing its image or draft', async t => {
  const item = { id: 'wrong-kind', cat: 'digital', kind: 'digital', name: '补签卡', desc: '补签漏签的一天。', price: 8, stock: 99, left: 99, active: true, delivery: '原来的错误资源说明', image: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', canChangeKind: true };
  const fixture = await setup(t, '#/community/manage/items', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, items: [item] });
    if (url.endsWith('/manage/items/wrong-kind')) return response({ id: item.id });
    return null;
  });
  fixture.main.querySelector('[data-action="community-item-edit"][data-id="wrong-kind"]').click();
  const form = fixture.main.querySelector('[data-community-form="item"]');
  const card = form.querySelector('[name="kind"][value="card"]');
  assert.ok(card, 'authors can correct the actual product type');
  card.checked = true; card.dispatchEvent(new fixture.w.Event('change', { bubbles: true }));
  assert.equal(form.elements.namedItem('cat').value, 'card');
  assert.equal(form.querySelector('[data-item-delivery]').hidden, true);
  assert.equal(form.elements.namedItem('name').value, item.name);
  form.dispatchEvent(new fixture.w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  const writes = fixture.requests.filter(call => call.url.endsWith('/manage/items/wrong-kind'));
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].init.body);
  assert.equal(body.cat, 'card'); assert.equal(body.kind, 'card'); assert.equal(body.ref, 'makeup');
  assert.equal(body.delivery, ''); assert.equal(body.image, item.image); assert.equal(body.price, 8); assert.equal(body.stock, 99);
});

test('publication shortcuts send only the intended state and lock through the pending update', async t => {
  const pending = deferred();
  const item = { id: 'on-sale', cat: 'goods', kind: 'goods', name: '收藏卡片', desc: '卡片说明', price: 8, stock: 99, left: 90, active: true, delivery: '' };
  const fixture = await setup(t, '#/community/manage/items', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, items: [item] });
    if (url.endsWith('/manage/items/on-sale')) return pending.promise;
    return null;
  });
  const button = fixture.main.querySelector('[data-action="community-item-active"][data-id="on-sale"]');
  assert.ok(button, 'publication is visible in the management list'); assert.match(button.textContent, /下架/);
  button.click(); button.click();
  const writes = fixture.requests.filter(call => call.url.endsWith('/manage/items/on-sale'));
  assert.equal(writes.length, 1); assert.deepEqual(JSON.parse(writes[0].init.body), { active: false });
  assert.equal(button.disabled, true);
  item.active = false; pending.resolve(response({ id: item.id })); await turn(); await turn();
  assert.match(fixture.main.querySelector('[data-action="community-item-active"]').textContent, /重新上架/);
});

test('publication shortcut failures restore the button without changing the saved list state', async t => {
  const pending = deferred(), notices = [];
  const item = { id: 'unlist-fails', cat: 'goods', kind: 'goods', name: '待下架卡片', desc: '卡片说明', price: 8, stock: 99, left: 90, active: true, delivery: '' };
  const fixture = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, items: [item] });
    if (url.endsWith('/manage/items/unlist-fails')) return pending.promise;
    return null;
  }, { notify: message => notices.push(message) });
  const table = fixture.main.querySelector('.community-table');
  const button = table.querySelector('[data-action="community-item-active"]');
  const row = button.closest('tr'), savedText = row.textContent;
  const readsBefore = fixture.requests.filter(call => call.url.includes('/manage?')).length;
  button.click();
  assert.equal(button.disabled, true);
  pending.resolve({ ok: false, status: 500, json: async () => ({ error: '上架状态未能保存，请重试。' }) });
  await turn(); await turn();
  assert.equal(fixture.main.querySelector('.community-table'), table, 'a rejected update retains the readable list');
  assert.equal(fixture.main.querySelector('[data-action="community-item-active"]'), button);
  assert.equal(button.disabled, false, 'the author can retry after a definitive failure');
  assert.equal(button.dataset.active, 'false'); assert.match(button.textContent, /下架/);
  assert.equal(row.textContent, savedText); assert.match(row.textContent, /上架中/);
  assert.equal(item.active, true);
  assert.deepEqual(notices, ['上架状态未能保存，请重试。']);
  assert.equal(fixture.requests.filter(call => call.url.includes('/manage?')).length, readsBefore, 'a failed write does not reload or optimistically relabel the list');
  const writes = fixture.requests.filter(call => call.url.endsWith('/manage/items/unlist-fails'));
  assert.equal(writes.length, 1); assert.deepEqual(JSON.parse(writes[0].init.body), { active: false });
});

test('a pending publication shortcut cannot repaint the old pane after management navigation', async t => {
  const pending = deferred(), olderContent = deferred();
  let contentReads = 0;
  const item = { id: 'unlist-while-moving', cat: 'goods', kind: 'goods', name: '旧商品列表卡片', desc: '卡片说明', price: 8, stock: 99, left: 90, active: true, delivery: '' };
  const latestContent = { ...topic('current-content'), title: '当前帖子管理内容' };
  const fixture = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?tab=content')) {
      contentReads++;
      if (contentReads === 1) return olderContent.promise;
      return response({ ...managementData, tab: 'content', items: [item], content: [latestContent] });
    }
    if (url.includes('/manage?')) return response({ ...managementData, items: [item] });
    if (url.endsWith('/manage/items/unlist-while-moving')) return pending.promise;
    return null;
  });
  fixture.w.scrollTo = () => {};
  fixture.main.querySelector('[data-action="community-item-active"]').click();
  await fixture.remount('#/community/manage/content');
  assert.equal(contentReads, 1, 'the new pane begins its own read while the publication write is pending');
  assert.equal(fixture.w.location.hash, '#/community/manage/content');
  item.active = false; pending.resolve(response({ id: item.id }));
  await turn(); await turn(); await turn();
  assert.ok(contentReads >= 2, 'the settled write refreshes the current pane and releases its route handoff');
  const page = fixture.main.querySelector('[data-community="manage"]');
  assert.equal(page.dataset.tab, 'content');
  assert.equal(page.querySelector('.community-management-nav [aria-current="page"]').getAttribute('href'), '#/community/manage/content');
  const currentLink = page.querySelector('.community-queue-title');
  assert.equal(currentLink.textContent, latestContent.title);
  assert.equal(page.querySelector('[data-action="community-item-active"]'), null);
  assert.doesNotMatch(page.querySelector('.community-management-content').textContent, /正在读取/);
  olderContent.resolve(response({ ...managementData, tab: 'content', items: [item], content: [{ ...topic('stale-content'), title: '过期帖子管理内容' }] }));
  await turn(); await turn();
  assert.equal(fixture.main.querySelector('[data-community="manage"]'), page);
  assert.equal(page.querySelector('.community-queue-title'), currentLink, 'the superseded read cannot replace the current content');
  assert.equal(currentLink.textContent, latestContent.title);
  assert.equal(fixture.w.location.hash, '#/community/manage/content');
  const writes = fixture.requests.filter(call => call.url.endsWith('/manage/items/unlist-while-moving'));
  assert.equal(writes.length, 1); assert.deepEqual(JSON.parse(writes[0].init.body), { active: false });
});

const ownerStaff = { role: 'owner', boards: ['qa', 'tools'], permissions: communityStaffCapabilities.map(cap => cap.id), delegable: communityStaffCapabilities.map(cap => cap.id), parent: null };
async function staffSetup(t, { actor = ownerStaff, target = null, save } = {}) {
  const targetPerson = { ...person, uid: '10002', steward: Boolean(target), staff: target, canAppoint: true };
  return setup(t, '#/community/manage/stewards', (url, init) => {
    if (url.endsWith('/me')) return response({ ...managementViewer, staff: actor });
    if (url.includes('/manage?')) return response({ ...managementData, actorStaff: actor, stewards: target ? [targetPerson] : [] });
    if (url.includes('/members/10002?')) return response({ person: targetPerson, steward: Boolean(target), canAppoint: true, self: false, staff: target });
    if (url.endsWith('/members/10002/steward')) return save ? save(url, init) : response({ ok: true });
    return null;
  });
}
async function staffForm(fixture, existing = false) {
  const { main, w } = fixture;
  if (existing) main.querySelector('[data-action="community-steward-edit"]').click();
  else {
    const lookup = main.querySelector('[data-community-form="steward-lookup"]');
    lookup.elements.namedItem('uid').value = '10002';
    lookup.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await turn();
  }
  return main.querySelector('[data-community-form="steward-scope"]');
}
function selectStaffField(fixture, form, name, value, checked = true) {
  const field = name === 'role' ? form.elements.namedItem(name) : [...form.querySelectorAll(`input[name="${name}"]`)].find(field => field.value === value);
  if (name === 'role') field.value = value; else field.checked = checked;
  field.dispatchEvent(new fixture.w.Event('change', { bubbles: true }));
  return field;
}
const submitStaff = (fixture, form) => form.dispatchEvent(new fixture.w.Event('submit', { bubbles: true, cancelable: true }));

for (const role of ['general', 'moderator', 'assistant']) test(`owner submits chosen ${role} with original form and board choices intact`, async t => {
  const fixture = await staffSetup(t), form = await staffForm(fixture);
  selectStaffField(fixture, form, 'boards', 'qa');
  selectStaffField(fixture, form, 'permissions', 'topic.delete');
  selectStaffField(fixture, form, 'role', role);
  assert.equal(fixture.main.querySelector('[data-community-form="steward-scope"]'), form);
  assert.equal(form.querySelector('[name="boards"][value="qa"]').checked, true);
  assert.equal(form.querySelector('[name="permissions"][value="topic.delete"]').checked, true);
  submitStaff(fixture, form); await turn();
  const writes = fixture.requests.filter(call => call.url.endsWith('/steward'));
  assert.equal(writes.length, 1);
  const body = JSON.parse(writes[0].init.body);
  assert.equal(body.role, role);
  assert.deepEqual(body.boards, ['qa']);
  assert.ok(body.permissions.includes('topic.delete'));
});

test('delegation check links to execution in place and removing execution clears delegation', async t => {
  const fixture = await staffSetup(t), form = await staffForm(fixture);
  const delegated = selectStaffField(fixture, form, 'delegable', 'topic.delete');
  assert.equal(form.querySelector('[name="permissions"][value="topic.delete"]').checked, true);
  selectStaffField(fixture, form, 'permissions', 'topic.delete', false);
  assert.equal(delegated.checked, false);
  assert.equal(delegated.isConnected, true);
});

test('modern appointment rejects empty boards, forged roles and unauthorized capabilities without writing', async t => {
  const actor = { ...ownerStaff, role: 'general', delegable: ['topic.approve'] };
  const fixture = await staffSetup(t, { actor }), form = await staffForm(fixture);
  submitStaff(fixture, form); await turn();
  assert.equal(fixture.requests.some(call => call.url.endsWith('/steward')), false);
  selectStaffField(fixture, form, 'boards', 'qa');
  const select = form.elements.namedItem('role');
  const forged = fixture.w.document.createElement('option'); forged.value = 'assistant'; select.append(forged); select.value = 'assistant';
  submitStaff(fixture, form); await turn();
  select.value = 'moderator';
  const cap = fixture.w.document.createElement('input'); cap.type = 'checkbox'; cap.name = 'permissions'; cap.value = 'topic.delete'; cap.checked = true; form.append(cap);
  submitStaff(fixture, form); await turn();
  assert.equal(fixture.requests.some(call => call.url.endsWith('/steward')), false);
});

test('owner takeover or role change warns and confirms a precise configuration, while failed saves preserve selections', async t => {
  const target = { role: 'assistant', boards: ['qa'], permissions: ['topic.approve'], delegable: [], parent: { kind: 'reader', id: 'parent' } };
  const fixture = await staffSetup(t, { target, save: () => Promise.resolve({ ok: false, status: 503, json: async () => ({ error: '保存失败请重试' }) }) });
  const form = await staffForm(fixture, true);
  assert.equal(form.elements.namedItem('role').value, 'assistant');
  assert.equal(form.querySelector('[data-steward-chain-warning]').hidden, false);
  submitStaff(fixture, form); await turn();
  assert.equal(fixture.requests.some(call => call.url.endsWith('/steward')), false);
  selectStaffField(fixture, form, 'role', 'moderator');
  submitStaff(fixture, form); await turn();
  assert.equal(fixture.requests.some(call => call.url.endsWith('/steward')), false, 'changed configuration needs a new confirmation');
  submitStaff(fixture, form); await turn();
  assert.equal(fixture.requests.filter(call => call.url.endsWith('/steward')).length, 1);
  assert.equal(form.elements.namedItem('role').value, 'moderator');
  assert.equal(form.querySelector('[name="permissions"][value="topic.approve"]').checked, true);
  assert.match(form.querySelector('[role="status"]').textContent, /保存失败/);
  assert.equal(form.querySelector('button[type="submit"]').disabled, false);
});

test('pending direct appointment locks enhanced role picker and checkboxes through remount', async t => {
  const pending = deferred(), fixture = await staffSetup(t, { save: () => pending.promise }), form = await staffForm(fixture);
  selectStaffField(fixture, form, 'boards', 'tools'); selectStaffField(fixture, form, 'role', 'assistant');
  submitStaff(fixture, form);
  assert.equal(form.elements.namedItem('role').disabled, true);
  await fixture.remount();
  const rebuilt = fixture.main.querySelector('[data-community-form="steward-scope"]');
  assert.equal(rebuilt.elements.namedItem('role').value, 'assistant');
  assert.equal(rebuilt.elements.namedItem('role').disabled, true);
  assert.ok([...rebuilt.querySelectorAll('input')].every(input => input.disabled));
  submitStaff(fixture, rebuilt); assert.equal(fixture.requests.filter(call => call.url.endsWith('/steward')).length, 1);
  pending.resolve(response({ ok: true })); await turn(); await turn();
});

test('authors list a profile background through the existing product form and image upload', async t => {
  const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { main, w, requests } = await setup(t, '#/community/manage/items', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/manage/item-image')) return response({ id: image, frameReady: false });
    if (url.endsWith('/manage/items')) return response({ id: 'new-cover' });
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('form[data-community-form="item"]');
  const kind = form.querySelector('[name="kind"][value="cover"]');
  assert.ok(kind, 'background is a real product type');
  kind.checked = true;
  kind.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(form.elements.namedItem('cat').value, 'look');
  assert.equal(form.querySelector('[data-item-stock]').hidden, true);
  assert.equal(form.querySelector('[data-item-effect]').hidden, true);
  assert.equal(form.querySelector('[data-item-media]').hidden, false);
  assert.match(form.querySelector('[data-item-wear-help]').textContent, /仅.*社区.*背景.*已拥有/);
  form.elements.namedItem('name').value = '林间背景';
  form.elements.namedItem('description').value = '社区主页背景';
  form.elements.namedItem('price').value = '120';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await turn();
  assert.equal(requests.some(entry => entry.url.endsWith('/manage/items')), false, 'background requires an uploaded image');
  fileDrag(w, form, 'drop', [new File(['test'], 'background.webp', { type: 'image/webp' })]);
  await turn(); await turn();
  assert.equal(form.elements.namedItem('image').value, image);
  assert.equal(form.querySelector('[data-item-wear-sample] img').getAttribute('src'), `/api/community/images/${image}.webp`);
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await turn();
  const payload = JSON.parse(requests.find(entry => entry.url.endsWith('/manage/items')).init.body);
  assert.equal(payload.cat, 'look');
  assert.equal(payload.kind, 'cover');
  assert.equal(payload.image, image);
  assert.equal(payload.stock, null);
  assert.equal(payload.effect, null);
});

test('board filtering preserves position and batch review submits only visible pending posts', async t => {
  const data = { ...managementData, queue: { topics: ['p1', 'p2'].map((id, index) => ({ ...topic(id), board: index ? 'tools' : 'qa', pending: true, body: '待审内容' })), replies: [] } };
  const { main, w, requests } = await setup(t, '#/community/manage', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(data);
    if (url.endsWith('/manage/review')) return response({ ok: true, count: 1 });
    return null;
  });
  let top = 420; Object.defineProperty(w, 'scrollY', { get: () => top });
  w.scrollTo = options => { top = options.top; };
  const all = main.querySelector('[data-community-review-all]');
  all.checked = true; all.dispatchEvent(new w.Event('change', { bubbles: true }));
  main.querySelector('[data-action="community-management-board"][data-board="tools"]').click();
  assert.equal(top, 420);
  assert.equal(main.querySelectorAll('[data-community-review-select]').length, 1);
  assert.equal(main.querySelector('[data-community-review-select]').checked, false, 'changing boards clears hidden selections');
  const visibleAll = main.querySelector('[data-community-review-all]');
  visibleAll.checked = true; visibleAll.dispatchEvent(new w.Event('change', { bubbles: true }));
  main.querySelector('[data-action="community-batch-approve"]').click(); await turn();
  assert.deepEqual(JSON.parse(requests.find(item => item.url.endsWith('/manage/review')).init.body).ids, ['p2']);
});

test('a non-VIP assigned tea-room moderator loads the board and frame without acquiring membership posting rights', async t => {
  const viewer = { ...person, mod: true, steward: true, vip: false, moderationBoards: ['vip'], trustLevel: 1 };
  const { main, ui, ctx, requests } = await setup(t, '#/community/boards/vip', url => {
    if (url.endsWith('/me')) return response(viewer);
    if (url.includes('/topics?')) return response(listing(['vip-p1']));
    return null;
  }, { members: false });
  assert.equal(requests.some(entry => entry.url.includes('/topics?') && entry.url.includes('board=vip')), true);
  assert.match(main.textContent, /讨论 vip-p1/);
  assert.doesNotMatch(ui.frameHTML(ctx), /data-frame-highlights-state="error"/);
  assert.equal(main.querySelector('a[href="#/community/new/vip"]'), null);
});

test('verified owner reader preview loads the VIP board and frame while interactions remain read-only', async t => {
  const viewer = { ...person, vip: true, management: { role: 'owner', browsingAsReader: true } };
  const notices = [];
  const { main, ui, ctx, requests, remount, w } = await setup(t, '#/community/boards/vip', url => {
    if (url.endsWith('/me')) return response(viewer);
    if (url.includes('/topics?')) return response({ ...listing(['vip-preview']), items: [{ ...topic('vip-preview'), board: 'vip' }] });
    if (url.includes('/banners?')) return response({ scope: 'vip', version: 1, items: [] });
    return null;
  }, { members: false, painted() {}, notify: value => notices.push(value) });
  assert.equal(requests.some(entry => entry.url.includes('/topics?') && entry.url.includes('board=vip') && (entry.init.method || 'GET') === 'GET'), true);
  assert.match(main.textContent, /讨论 vip-preview/);
  assert.equal(main.querySelector('[data-content-state="members"]'), null);
  assert.match(ui.frameHTML(ctx), /data-frame-highlights-state="ready"/);
  assert.match(ui.frameHTML(ctx), /讨论 vip-preview/);
  assert.equal(requests.some(entry => /\/manage(?:\?|$)/.test(entry.url)), false);

  await remount('#/post/p1');
  main.querySelector('[data-action="community-like"]').click();
  const reply = main.querySelector('[data-community-form="reply"]');
  assert.ok(reply);
  reply.querySelector('textarea').value = '预览不能提交互动';
  reply.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await turn();
  assert.match(notices.at(-1), /当前预览仅供查看/);
  assert.match(reply.querySelector('.community-form-status').textContent, /请先返回管理身份/);
  assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
});

test('verified owner personal reader can like and reply, while stale management controls never write', async t => {
  const shown = thread(); shown.topic.canModerate = true;
  const notices = [];
  const { main, w, requests } = await setup(t, '#/post/p1', (url, init) => {
    if (url.endsWith('/me')) return response(personalReader);
    if (url.endsWith('/topics/p1')) return response(shown);
    if (url.endsWith('/topics/p1/replies')) return response({ id: 'new-reply', reward: 0 });
    return null;
  }, { notify: value => notices.push(value) });
  main.querySelector('[data-action="community-pin"]').click(); await turn();
  assert.equal(requests.some(entry => entry.url.endsWith('/pin')), false);
  assert.match(notices.at(-1), /管理身份/);
  main.querySelector('[data-action="community-like"]').click(); await turn();
  assert.ok(requests.some(entry => entry.url.endsWith('/like') && entry.init.method === 'POST'));
  const form = main.querySelector('[data-community-form="reply"]');
  form.elements.namedItem('body').value = '真实读者身份的正常回复。';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  // As with deliberate reply retries below, wait for the WebCrypto-protected
  // request itself rather than assuming two zero-delay timers finish its hash.
  const deadline = performance.now() + 5000;
  while (!requests.some(entry => entry.url.endsWith('/topics/p1/replies') && entry.init.method === 'POST')) {
    assert.ok(performance.now() < deadline, 'the personal reader reply request must be sent');
    await turn();
  }
  assert.ok(requests.some(entry => entry.url.endsWith('/topics/p1/replies') && entry.init.method === 'POST'));
  const account = new JSDOM(communityAccountHTML({ ...ctxForAccount(), me: personalReader })).window.document;
  assert.equal(account.querySelector('a[href="#/community/manage"]'), null);
  assert.equal(account.querySelector('a[href="#/community/u/10001"]').textContent, '我的主页');
});

const ctxForAccount = () => ({ t: zh => zh, esc: value => String(value ?? ''), icons: {} });

test('verified owner personal reader can check in and mark its own notifications read', async t => {
  let checked = false;
  const { main, requests, remount } = await setup(t, '#/community/home', (url, init) => {
    if (url.endsWith('/me')) return response({ ...personalReader, checkedIn: checked });
    if (url.endsWith('/checkin') && init.method === 'POST') { checked = true; return response({ reward: 10, bonus: 0, streak: 1 }); }
    if (url.includes('/inbox?')) return response({ tab: 'all', unread: { all: 1 }, items: [{ id: 'own-n1', type: 'reply', actor: person, text: '正式通知', title: '正式帖子', href: '#/post/p1', createdAt: '2026-10-01T10:00:00Z', read: false }] });
    if (url.endsWith('/inbox/read')) return response({ ok: true });
    return null;
  });
  const checkin = main.querySelector('[data-action="community-checkin"]'); assert.ok(checkin);
  checkin.click(); await turn(); await turn();
  assert.equal(requests.filter(entry => entry.url.endsWith('/checkin') && entry.init.method === 'POST').length, 1);
  await remount('#/community/inbox');
  main.querySelector('[data-action="community-notice"]').click(); await turn();
  assert.deepEqual(JSON.parse(requests.find(entry => entry.url.endsWith('/inbox/read')).init.body), { id: 'own-n1' });
});

test('verified owner personal reader publishes in the VIP board as its real reader identity', async t => {
  const { main, w, requests } = await setup(t, '#/community/new/vip', (url, init) => {
    if (url.endsWith('/me')) return response(personalReader);
    if (url.endsWith('/topics') && init.method === 'POST') return response({ id: 'reader-topic', reward: 0 });
    return null;
  }, { members: false });
  const form = main.querySelector('[data-community-form="topic"]'); assert.ok(form);
  form.elements.namedItem('title').value = '个人读者的会员主题';
  form.elements.namedItem('body').value = '通过真实读者身份发布的会员主题正文。'.repeat(8);
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const deadline = performance.now() + 5000;
  while (!requests.some(entry => entry.url.endsWith('/topics') && entry.init.method === 'POST')) {
    assert.ok(performance.now() < deadline, 'the personal reader topic request must be sent');
    await turn();
  }
  const write = requests.find(entry => entry.url.endsWith('/topics') && entry.init.method === 'POST'); assert.ok(write, form.querySelector('.community-form-status')?.textContent);
  assert.equal(JSON.parse(write.init.body).board, 'vip');
  assert.equal(JSON.parse(write.init.body).owner, undefined);
  assert.equal(requests.some(entry => /\/manage(?:\/|\?)/.test(entry.url)), false);
});

test('owner personal reader reply drafts are isolated from the owner identity and restored on return', async t => {
  let reader = false;
  const { main, w, ui } = await setup(t, '#/post/p1', (url, init) => {
    if (url.endsWith('/me')) return response(reader ? personalReader : managementViewer);
    if (url.endsWith('/browse-mode')) { reader = JSON.parse(init.body).reader; return response({ ok: true }); }
    return null;
  });
  const writeDraft = value => { const field = main.querySelector('[data-community-form="reply"] textarea'); assert.ok(field); field.value = value; field.dispatchEvent(new w.Event('input', { bubbles: true })); };
  writeDraft('管理身份的草稿'); await ui.setBrowsing(true); await turn();
  assert.equal(main.querySelector('[data-community-form="reply"] textarea').value, '');
  writeDraft('个人读者的草稿'); await ui.setBrowsing(false); await turn();
  assert.equal(main.querySelector('[data-community-form="reply"] textarea').value, '管理身份的草稿');
  await ui.setBrowsing(true); await turn();
  assert.equal(main.querySelector('[data-community-form="reply"] textarea').value, '个人读者的草稿');
  assert.equal(w.location.hash, '#/post/p1');
});

test('an uncertain personal reader publication blocks identity switching until the same operation is confirmed', async t => {
  let reader = true, attempts = 0;
  const notices = [];
  const { main, w, ui, requests } = await setup(t, '#/post/p1', (url, init) => {
    if (url.endsWith('/me')) return response(reader ? personalReader : managementViewer);
    if (url.endsWith('/browse-mode')) { reader = JSON.parse(init.body).reader; return response({ ok: true }); }
    if (url.endsWith('/topics/p1/replies')) { if (!attempts++) throw Error('response lost'); return response({ id: 'confirmed', reward: 0 }); }
    return null;
  }, { notify: value => notices.push(value) });
  const publish = async expectedWrites => {
    const form = main.querySelector('[data-community-form="reply"]'); assert.ok(form);
    const button = form.querySelector('button[type="submit"]'); assert.ok(button);
    assert.equal(button.disabled, false, 'the previous reply attempt must settle before a deliberate retry');
    form.elements.namedItem('body').value = '结果需要确认的正式回复。';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    // WebCrypto may finish after several event-loop turns. Wait for the actual
    // request and busy() settlement, so a retry cannot be silently ignored.
    const deadline = performance.now() + 5000;
    while (requests.filter(entry => entry.url.endsWith('/topics/p1/replies')).length < expectedWrites || (form.isConnected && button.disabled)) {
      assert.ok(performance.now() < deadline, `reply attempt ${expectedWrites} and its form must settle`);
      await turn();
    }
    assert.equal(requests.filter(entry => entry.url.endsWith('/topics/p1/replies')).length, expectedWrites, 'one deliberate reply submit makes one request');
  };
  await publish(1);
  await ui.setBrowsing(false);
  assert.equal(requests.some(entry => entry.url.endsWith('/browse-mode')), false);
  assert.match(notices.at(-1), /提交.*确认|确认.*提交/);
  await publish(2);
  const writes = requests.filter(entry => entry.url.endsWith('/topics/p1/replies'));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].init.headers['X-Idempotency-Key'], writes[1].init.headers['X-Idempotency-Key']);
  await ui.setBrowsing(false); assert.equal(reader, false);
});

for (const [label, managementRole, vip] of [
  ['ordinary reader with stale owner and VIP flags', null, true],
  ['steward with stale owner and VIP flags', 'steward', true],
  ['owner preview without verified VIP entitlement', 'owner', false],
]) test(`${label} cannot unlock the VIP board in reader preview`, async t => {
  const viewer = { ...person, owner: true, mod: true, vip, moderationBoards: ['vip'], management: { role: managementRole, browsingAsReader: true } };
  const { main, ui, ctx, requests } = await setup(t, '#/community/boards/vip', url => url.endsWith('/me') ? response(viewer) : null, { members: true });
  assert.ok(main.querySelector('[data-content-state="members"]'));
  assert.equal(requests.some(entry => entry.url.includes('/topics?') && entry.url.includes('board=vip')), false);
  assert.match(ui.frameHTML(ctx), /data-frame-highlights-state="error"/);
  assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
});

test('cancelling one candidate scope form retains a different moderator edit and its draft', async t => {
  const { main, w } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, stewards: [{ ...moderatorCandidate(true).person, uid: '10003', moderationBoards: ['qa'] }] });
    if (url.endsWith('/members/10002?tab=topics')) return response(moderatorCandidate(false));
    return null;
  });
  main.querySelector('[data-action="community-steward-edit"][data-uid="10003"]').click();
  main.querySelector('[data-community-form="steward-scope"] [name="boards"][value="tools"]').checked = true;
  const lookup = main.querySelector('[data-community-form="steward-lookup"]'); lookup.elements.namedItem('uid').value = '10002';
  lookup.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  main.querySelector('[data-community-form="steward-scope"][data-uid="10002"] [data-action="community-steward-edit-cancel"]').click();
  assert.equal(main.querySelector('[data-community-form="steward-scope"][data-uid="10002"]'), null);
  assert.equal(main.querySelector('[data-community-form="steward-scope"][data-uid="10003"] [name="boards"][value="tools"]').checked, true);
});

test('looking up a previously appointed member refreshes a stale roster before editing their boards', async t => {
  let rosterRequests = 0;
  const { main, w } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, stewards: ++rosterRequests > 1 ? [moderatorCandidate(true).person] : [] });
    if (url.endsWith('/members/10002?tab=topics')) return response(moderatorCandidate(true));
    return null;
  });
  const lookup = main.querySelector('[data-community-form="steward-lookup"]'); lookup.elements.namedItem('uid').value = '10002';
  lookup.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn(); await turn();
  main.querySelector('[data-action="community-steward-edit"][data-uid="10002"]').click();
  assert.ok(main.querySelector('[data-community-form="steward-scope"][data-uid="10002"][data-existing="true"]'));
});

const moderatorCandidate = steward => ({ person: { ...person, uid: '10002', name: '星海', steward }, self: false, canAppoint: true, steward });

test('modern moderators appoint an assistant with explicit capabilities and cannot delegate an ungranted capability', async t => {
  const staff = { role: 'moderator', boards: ['qa'], permissions: ['staff.appoint', 'content.inspect', 'topic.approve'], delegable: ['topic.approve', 'profile.avatar.advise'], parent: { kind: 'reader', id: 'superior' } };
  const viewer = { ...person, mod: true, staffRole: staff.role, staff, management: { role: staff.role, browsingAsReader: false, staff } };
  const { main, w, requests } = await setup(t, '#/community/manage/stewards', (url, init) => {
    if (url.endsWith('/me')) return response(viewer);
    if (url.includes('/manage?')) return response({ ...managementData, owner: false, actorStaff: staff, stewards: [] });
    if (url.endsWith('/members/10002?tab=topics')) return response(moderatorCandidate(false));
    if (url.endsWith('/members/10002/steward')) return response({ ok: true });
    return null;
  });
  const lookup = main.querySelector('[data-community-form="steward-lookup"]');
  lookup.elements.namedItem('uid').value = '10002';
  lookup.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  const form = main.querySelector('[data-community-form="steward-scope"]'); assert.ok(form);
  form.querySelector('[name="boards"][value="qa"]').checked = true;
  form.querySelector('[name="permissions"][value="topic.approve"]').checked = false;
  form.querySelector('[name="delegable"][value="topic.approve"]').checked = true;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.equal(requests.some(entry => entry.url.endsWith('/steward')), false);
  assert.match(form.querySelector('.community-form-status').textContent, /同时.*可执行/);
  form.querySelector('[name="permissions"][value="topic.approve"]').checked = true;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn(); await turn();
  const write = requests.find(entry => entry.url.endsWith('/steward')); assert.ok(write);
  assert.deepEqual(JSON.parse(write.init.body), { on: true, role: 'assistant', boards: ['qa'], permissions: ['topic.approve', 'profile.avatar.advise'], delegable: ['topic.approve'] });
});

test('modern staff configuration remains intact when navigation or reader identity switching is cancelled', async t => {
  const staff = { role: 'moderator', boards: ['qa'], permissions: ['staff.appoint', 'content.inspect'], delegable: ['topic.approve'], parent: { kind: 'reader', id: 'superior' } };
  const { main, ui, w, requests } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response({ ...person, mod: true, staff, staffRole: staff.role, management: { role: staff.role, browsingAsReader: false, staff } });
    if (url.includes('/manage?')) return response({ ...managementData, owner: false, actorStaff: staff, stewards: [{ ...moderatorCandidate(true).person, staff: { ...staff, role: 'assistant', boards: ['qa'], permissions: ['topic.approve'], delegable: [] }, canAppoint: true }] });
    return null;
  });
  main.querySelector('[data-action="community-steward-edit"]').click();
  const form = main.querySelector('[data-community-form="steward-scope"]');
  form.querySelector('[name="delegable"]').checked = true;
  let confirmations = 0; w.confirm = () => { confirmations++; return false; };
  main.querySelector('a[href="#/community/manage/content"]').click(); await turn();
  assert.equal(confirmations, 1); assert.equal(w.location.hash, '#/community/manage/stewards');
  assert.equal(main.querySelector('[data-community-form="steward-scope"]'), form);
  assert.equal(form.querySelector('[name="delegable"]').checked, true);
  await ui.setBrowsing(true); await turn();
  assert.equal(requests.some(entry => entry.url.endsWith('/browse-mode')), false);
  assert.equal(main.querySelector('[data-community-form="steward-scope"]'), form);
});

test('switching modern staff roster editors asks before discarding an edited configuration', async t => {
  const staff = { role: 'moderator', boards: ['qa'], permissions: ['staff.appoint', 'content.inspect'], delegable: ['topic.approve'], parent: { kind: 'reader', id: 'superior' } };
  const { main, w, requests } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response({ ...person, mod: true, staff, staffRole: staff.role, management: { role: staff.role, browsingAsReader: false, staff } });
    if (url.includes('/manage?')) return response({ ...managementData, owner: false, actorStaff: staff, stewards: ['10002', '10003'].map(uid => ({ ...moderatorCandidate(true).person, uid, staff: { ...staff, role: 'assistant', permissions: ['topic.approve'], delegable: [] }, canAppoint: true })) });
    return null;
  });
  main.querySelector('[data-action="community-steward-edit"][data-uid="10002"]').click();
  const form = main.querySelector('[data-community-form="steward-scope"]');
  form.querySelector('[name="delegable"]').checked = true;
  let confirmations = 0; w.confirm = () => { confirmations++; return false; };
  main.querySelector('[data-action="community-steward-edit"][data-uid="10003"]').click();
  assert.equal(confirmations, 1);
  assert.equal(main.querySelector('[data-community-form="steward-scope"]'), form);
  assert.equal(form.querySelector('[name="delegable"]').checked, true);
  assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
});

test('management deletion keeps target-specific penalty and mute refusals despite broader staff capabilities', async t => {
  const staff = { role: 'moderator', boards: ['qa'], permissions: ['content.inspect', 'topic.delete', 'topic.penalty', 'member.mute'], delegable: [], parent: { kind: 'reader', id: 'superior' } };
  const { main } = await setup(t, '#/community/manage/content', url => {
    if (url.endsWith('/me')) return response({ ...person, mod: true, staff, staffRole: staff.role, management: { role: staff.role, browsingAsReader: false, staff } });
    if (url.includes('/manage?')) return response({ ...managementData, owner: false, actorStaff: staff, content: [{ ...topic('p1'), author: { ...person, uid: 'other' }, canDelete: true, canPenalty: false, canMute: false }] });
    return null;
  });
  main.querySelector('[data-action="community-queue-delete"]').click();
  assert.ok(main.querySelector('[data-community-form="delete"]'));
  assert.equal(main.querySelector('[name="violation"], [name="mute"]'), null);
});

test('a protected pending target may be approved but is not offered for single or batch rejection', async t => {
  const staff = { role: 'moderator', boards: ['qa'], permissions: ['content.inspect', 'topic.approve', 'topic.reject'], delegable: [], parent: { kind: 'reader', id: 'superior' } };
  const { main, w, requests } = await setup(t, '#/community/manage', url => {
    if (url.endsWith('/me')) return response({ ...person, mod: true, staff, staffRole: staff.role, management: { role: staff.role, browsingAsReader: false, staff } });
    if (url.includes('/manage?')) return response({ ...managementData, owner: false, actorStaff: staff, queue: { topics: [{ ...topic('p1'), pending: true, body: '待审', canApprove: true, canDelete: false }], replies: [] } });
    return null;
  });
  assert.ok(main.querySelector('[data-action="community-approve"]'));
  assert.equal(main.querySelector('[data-action="community-reject"]'), null);
  const selected = main.querySelector('[data-community-review-select]'); selected.checked = true;
  selected.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(main.querySelector('[data-action="community-batch-approve"]').disabled, false);
  assert.equal(main.querySelector('[data-action="community-batch-reject"]').disabled, true);
  main.querySelector('[data-action="community-batch-reject"]').click();
  assert.equal(main.querySelector('[data-community-form="reject"]'), null);
  assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
});

test('the fixed owner can configure a verified legacy moderator without promoting the appointment', async t => {
  const staff = { role: 'owner', boards: ['qa'], permissions: ['staff.appoint', 'content.inspect', 'topic.approve'], delegable: ['topic.approve'], parent: null };
  const legacy = { ...moderatorCandidate(true).person, uid: '10002', canAppoint: true, staff: { role: 'moderator', boards: ['qa'], permissions: ['topic.approve'], delegable: [], parent: { kind: 'owner', id: 'owner' } } };
  const { main, w, requests } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response({ ...managementViewer, staff, staffRole: 'owner', management: { role: 'owner', browsingAsReader: false, staff } });
    if (url.includes('/manage?')) return response({ ...managementData, actorStaff: staff, stewards: [legacy] });
    if (url.endsWith('/members/10002/steward')) return response({ ok: true });
    return null;
  });
  const edit = main.querySelector('[data-action="community-steward-edit"]'); assert.ok(edit); edit.click();
  const form = main.querySelector('[data-community-form="steward-scope"]');
  assert.equal(form.querySelector('[name="role"]').value, 'moderator');
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn(); await turn();
  assert.equal(JSON.parse(requests.find(entry => entry.url.endsWith('/steward')).init.body).role, 'moderator');
});

test('assistant feature recommendation uses its real write route while final review requires a rejection reason', async t => {
  const notices = [];
  const staff = { role: 'assistant', boards: ['qa'], permissions: ['feature.recommend'], delegable: [], parent: { kind: 'reader', id: 'moderator' } };
  const { main, w, requests, remount } = await setup(t, '#/post/p1', (url, init) => {
    if (url.endsWith('/me')) { const activeStaff = location.hash.endsWith('/features') ? { ...staff, role: 'moderator', permissions: ['feature.decide'] } : staff; return response({ ...person, mod: true, staff: activeStaff, staffRole: activeStaff.role, management: { role: activeStaff.role, browsingAsReader: false, staff: activeStaff } }); }
    if (url.endsWith('/topics/p1')) return response({ ...thread(), topic: { ...thread().topic, canRecommend: true, canFeature: false } });
    if (url.endsWith('/topics/p1/feature-recommend')) return response({ ok: true, id: 'recommendation' });
    if (url.includes('/manage?')) return response({ ...managementData, owner: false, actorStaff: { ...staff, role: 'moderator', permissions: ['feature.decide'] }, features: [{ id: 'recommendation', topic: topic('p1'), by: person, reason: '', createdAt: '2026-10-07T00:00:00Z' }] });
    if (url.endsWith('/manage/feature-recommendations/recommendation/reject')) return response({ ok: true });
    return null;
  }, { notify: text => notices.push(text) });
  main.querySelector('[data-action="community-feature-recommend"]').click(); await turn(); await turn();
  assert.equal(requests.filter(entry => entry.url.endsWith('/feature-recommend')).length, 1);
  assert.ok(notices.some(text => /等待审批/.test(text)));
  await remount('#/community/manage/features');
  const form = main.querySelector('[data-community-form="feature-review"]'), reject = form.querySelector('[value="reject"]');
  form.dispatchEvent(new w.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: reject })); await turn();
  assert.equal(requests.some(entry => entry.url.endsWith('/recommendation/reject')), false);
  assert.match(form.querySelector('.community-form-status').textContent, /驳回理由/);
  form.elements.namedItem('reason').value = '内容仍需要补充来源';
  form.dispatchEvent(new w.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: reject })); await turn();
  assert.deepEqual(JSON.parse(requests.find(entry => entry.url.endsWith('/recommendation/reject')).init.body), { reason: '内容仍需要补充来源' });
});

test('owners look up a member before appointment and use existing APIs without duplicate submissions', async t => {
  let appointed = false;
  const pending = deferred();
  const { main, w, requests } = await setup(t, '#/community/manage/stewards', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, stewards: appointed ? [moderatorCandidate(true).person] : [] });
    if (url.endsWith('/members/10002?tab=topics')) return response(moderatorCandidate(appointed));
    if (url.endsWith('/members/10002/steward')) { appointed = JSON.parse(init.body).on; return pending.promise; }
    return null;
  });
  const form = main.querySelector('[data-community-form="steward-lookup"]');
  form.elements.namedItem('uid').value = '10002';
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.equal(main.querySelector('[data-steward-candidate]').dataset.uid, '10002');
  const scope = main.querySelector('[data-community-form="steward-scope"][data-steward-candidate]');
  scope.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(requests.filter(item => item.url.endsWith('/steward')).length, 0);
  assert.match(scope.querySelector('.community-form-status').textContent, /至少选择一个/);
  for (const board of ['qa', 'tools']) scope.querySelector(`[name="boards"][value="${board}"]`).checked = true;
  scope.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  scope.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(requests.filter(item => item.url.endsWith('/steward')).length, 1);
  assert.deepEqual(JSON.parse(requests.find(item => item.url.endsWith('/steward')).init.body), { on: true, boards: ['qa', 'tools'] });
  pending.resolve(response({ ok: true })); await turn(); await turn();
  assert.equal(main.querySelector('[data-community-form="steward-scope"][data-steward-candidate]'), null);
  assert.ok(main.querySelector('.community-steward-section [data-uid="10002"][data-on="false"]'));
  assert.equal(main.querySelector('[name="uid"]').value, '10002');
});

test('editing assigned boards submits explicit scope, keeps its lock and position, and does not copy another moderator draft', async t => {
  const pending = deferred();
  const stewards = ['10002', '10003'].map((uid, index) => ({ ...moderatorCandidate(true).person, uid, moderationBoards: [index ? 'showcase' : 'qa'] }));
  const { main, w, requests, remount } = await setup(t, '#/community/manage/stewards', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, stewards });
    if (url.endsWith('/members/10003/steward')) { stewards[1].moderationBoards = JSON.parse(init.body).boards; return pending.promise; }
    return null;
  });
  let top = 360; Object.defineProperty(w, 'scrollY', { get: () => top });
  w.scrollTo = options => { top = options.top; };
  main.querySelector('[data-action="community-steward-edit"][data-uid="10002"]').click();
  const first = main.querySelector('[data-community-form="steward-scope"]');
  first.querySelector('[name="boards"][value="tools"]').checked = true;
  main.querySelector('[data-action="community-steward-edit"][data-uid="10003"]').click();
  const scope = main.querySelector('[data-community-form="steward-scope"]');
  assert.equal(scope.dataset.uid, '10003');
  assert.deepEqual([...scope.querySelectorAll('[name="boards"]:checked')].map(input => input.value), ['showcase']);
  scope.querySelector('[name="boards"][value="tools"]').checked = true;
  scope.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  scope.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await remount();
  const current = main.querySelector('[data-community-form="steward-scope"]');
  assert.equal(current.querySelector('button[type="submit"]').disabled, true);
  assert.equal([...current.querySelectorAll('[name="boards"]')].every(input => input.disabled), true);
  assert.equal(main.querySelector('[data-action="community-steward-edit"][data-uid="10002"]').disabled, true);
  assert.equal(requests.filter(item => item.url.endsWith('/steward')).length, 1);
  assert.deepEqual(JSON.parse(requests.find(item => item.url.endsWith('/steward')).init.body), { on: true, boards: ['showcase', 'tools'] });
  assert.equal(top, 360);
  pending.resolve(response({ steward: true })); await turn(); await turn();
  assert.equal(main.querySelector('[data-community-form="steward-scope"]'), null);
  assert.equal(main.querySelector('[data-action="community-steward-edit"][data-uid="10002"]').disabled, false);
});

test('editing a lookup UID invalidates the previous candidate and stale responses cannot appoint the wrong member', async t => {
  const pending = deferred();
  const { main, w } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, stewards: [] });
    if (url.endsWith('/members/10002?tab=topics')) return pending.promise;
    if (url.endsWith('/members/10003?tab=topics')) return response({ ...moderatorCandidate(false), person: { ...person, name: '新成员', uid: '10003' } });
    return null;
  });
  const submit = () => main.querySelector('[data-community-form="steward-lookup"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  main.querySelector('[name="uid"]').value = '10002'; submit();
  const field = main.querySelector('[name="uid"]'); field.value = '10003'; field.dispatchEvent(new w.Event('input', { bubbles: true })); submit(); await turn();
  assert.equal(main.querySelector('[data-steward-candidate]').dataset.uid, '10003');
  pending.resolve(response(moderatorCandidate(false))); await turn();
  assert.equal(main.querySelector('[data-steward-candidate]').dataset.uid, '10003');
  const current = main.querySelector('[name="uid"]'); current.value = '10004'; current.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(main.querySelector('[data-steward-candidate]'), null);
});

test('board selection survives real cleanup and remount between review and reports, then clears outside task queues', async t => {
  const { main, remount } = await setup(t, '#/community/manage', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    return null;
  });
  main.querySelector('[data-action="community-management-board"][data-board="tools"]').click();
  for (const hash of ['#/community/manage/reports', '#/community/manage']) {
    await remount(hash);
    assert.equal(main.querySelector('[data-action="community-management-board"][aria-pressed="true"]').dataset.board, 'tools');
  }
  await remount('#/community/manage/content'); await remount('#/community/manage');
  assert.equal(main.querySelector('[data-action="community-management-board"][aria-pressed="true"]').dataset.board, '');
});

test('an appointment in flight remains visibly locked through same-route remounts', async t => {
  const pending = deferred();
  const { main, requests, remount } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, stewards: [moderatorCandidate(true).person] });
    if (url.endsWith('/members/10002/steward')) return pending.promise;
    return null;
  });
  const button = main.querySelector('[data-action="community-steward"]'); button.click(); button.click();
  assert.equal(button.disabled, true);
  await remount();
  const rebuilt = main.querySelector('[data-action="community-steward"]');
  assert.equal(rebuilt.disabled, true);
  assert.equal(main.querySelector('[data-community-form="steward-lookup"] button[type="submit"]').disabled, true);
  rebuilt.click();
  assert.equal(requests.filter(item => item.url.endsWith('/steward')).length, 1);
  pending.resolve(response({ ok: true })); await turn(); await turn();
  assert.equal(main.querySelector('[data-action="community-steward"]').disabled, false);
  assert.equal(main.querySelector('[data-community-form="steward-lookup"] button[type="submit"]').disabled, false);
});

test('an older roster response cannot overwrite the refreshed list after appointment', async t => {
  const older = deferred(); let rosterRequests = 0;
  const { main, w } = await setup(t, '#/community/manage/stewards', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?tab=stewards')) {
      rosterRequests++;
      if (rosterRequests === 2) return older.promise;
      return response({ ...managementData, stewards: rosterRequests > 2 ? [] : [moderatorCandidate(true).person] });
    }
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/members/10002/steward')) return response({ ok: true });
    return null;
  });
  // Refresh an already readable roster. New-route handoffs now wait for their
  // own core response, while the current roster remains interactive during a
  // normal refresh and must reject its older in-flight response after a write.
  const retry = w.document.createElement('button'); retry.dataset.action = 'community-retry'; main.append(retry); retry.click(); await turn();
  const button = main.querySelector('[data-action="community-steward"]'); button.click(); button.click(); await turn(); await turn();
  assert.equal(main.querySelector('[data-action="community-steward"]'), null);
  older.resolve(response({ ...managementData, stewards: [moderatorCandidate(true).person] })); await turn();
  assert.equal(main.querySelector('[data-action="community-steward"]'), null);
});

function fileDrag(w, target, type, files = []) {
  const event = new w.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } });
  target.dispatchEvent(event);
  return event;
}

test('batch review selects pending posts, submits one request and retains selection while opening rejection', async t => {
  const data = { ...managementData, counts: { ...managementData.counts, queue: 2 }, queue: { topics: ['p1', 'p2'].map(id => ({ ...topic(id), pending: true, body: '待审内容', pendingReason: '需要审核' })), replies: [] } };
  const { main, w, requests } = await setup(t, '#/community/manage', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(data);
    if (url.endsWith('/manage/review')) return response({ ok: true, count: 2 });
    return null;
  });
  const selectAll = main.querySelector('[data-community-review-all]');
  assert.ok(selectAll);
  selectAll.checked = true; selectAll.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(main.querySelectorAll('[data-community-review-select]:checked').length, 2);
  main.querySelector('[data-action="community-batch-reject"]').click();
  const rejection = main.querySelector('form[data-community-form="reject"][data-batch]');
  assert.ok(rejection);
  assert.equal(main.querySelectorAll('[data-community-review-select]:checked').length, 2);
  const reason = rejection.querySelector('input[value="重复内容"]');
  reason.checked = true;
  rejection.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  const batch = requests.filter(entry => entry.url.endsWith('/manage/review'));
  assert.equal(batch.length, 1);
  assert.deepEqual(JSON.parse(batch[0].init.body), { action: 'reject', ids: ['p1', 'p2'], reason: '重复内容', note: '' });
});

test('adding categories and importing a finished nickname effect preserves the product draft and submits usable equipment', async t => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { main, w, requests } = await setup(t, '#/community/manage/items', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, categories: [] });
    if (url.endsWith('/manage/categories')) return response({ id, name: '星海系列' });
    if (url.endsWith('/manage/items')) return response({ id: 'new-effect' });
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('form[data-community-form="item"]');
  form.elements.namedItem('name').value = '星海流光';
  const kind = form.querySelector('[name="kind"][value="color"]'); kind.checked = true;
  kind.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(form.elements.namedItem('cat').value, 'look');
  assert.equal(form.querySelector('[data-item-effect]').hidden, false);
  assert.equal(form.querySelector('[data-item-media]').hidden, true);
  fileDrag(w, form, 'drop', [new File(['{"style":"shimmer","colors":["#976223","#236A7B"]}'], 'effect.json')]); await turn(); await turn();
  const category = main.querySelector('form[data-community-form="category"]');
  category.elements.namedItem('name').value = '星海系列';
  category.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.equal(main.querySelector('form[data-community-form="item"]'), form);
  assert.equal(form.elements.namedItem('name').value, '星海流光');
  assert.equal(form.elements.namedItem('category').value, id);
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  const payload = JSON.parse(requests.find(entry => entry.url.endsWith('/manage/items')).init.body);
  assert.equal(payload.cat, 'look'); assert.equal(payload.kind, 'color'); assert.equal(payload.category, id);
  assert.deepEqual(payload.effect, { style: 'shimmer', colors: ['#976223', '#236A7B'] });
});

test('opening management dialogs preserves document position and does not scroll the content into view', async t => {
  const orders = [{ id: 'o1', item: 'goods', itemName: '物品', price: 10, member: person, status: 'pending', createdAt: '2026-10-05T02:00:00Z', shipping: { name: '用户', phone: '13900000000', address: '模拟地址' } }];
  const { main, w } = await setup(t, '#/community/manage/orders', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response({ ...managementData, orders });
    return null;
  });
  const header = w.document.createElement('header');
  header.innerHTML = '<button>账号菜单</button>'; w.document.body.prepend(header);
  let top = 420, autoScroll = 0;
  Object.defineProperty(w, 'scrollY', { get: () => top });
  w.HTMLElement.prototype.scrollIntoView = () => { autoScroll++; };
  const calls = []; w.scrollTo = options => { calls.push(options); top = options.top; };
  const section = main.querySelector('[data-community]'), replace = section.replaceWith.bind(section);
  section.replaceWith = next => { top = 0; replace(next); };
  main.querySelector('[data-action="community-ship"]').click();
  assert.equal(autoScroll, 0); assert.equal(top, 420);
  assert.deepEqual(calls.at(-1), { left: 0, top: 420, behavior: 'instant' });
  assert.ok(main.querySelector('[role="dialog"] form[data-community-form="ship"]'));
  assert.equal(header.inert, true, 'background header cannot be operated through the dialog');
  assert.equal(main.querySelector('.community-management-nav').inert, true);
  const dialog = main.querySelector('[role="dialog"]'); dialog.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(main.querySelector('[role="dialog"]'), null);
  assert.equal(header.inert, false);
  assert.equal(Boolean(main.querySelector('.community-management-nav').inert), false);
});

test('repainting the equipment editor preserves the same animated wearable preview', async t => {
  const { main, w, ui, ctx } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('form[data-community-form="item"]');
  const kind = form.querySelector('[name="kind"][value="frame"]'); kind.checked = true;
  form.elements.namedItem('image').value = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  kind.dispatchEvent(new w.Event('change', { bubbles: true }));
  const preview = form.querySelector('[data-item-wear-sample]');
  const image = preview.querySelector('.community-frame-image'); assert.ok(image);
  const remountCleanup = ui.mount(main, ctx);
  try {
    assert.equal(main.querySelector('[data-item-wear-sample]'), preview);
    assert.equal(main.querySelector('[data-item-wear-sample] .community-frame-image'), image);
  } finally { remountCleanup(); }
});

test('product uploads preserve typed fields, block saving while pending and submit the stored artwork ID', async t => {
  const pending = deferred(), image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { main, w, requests } = await setup(t, '#/community/manage/items', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/manage/item-image')) return pending.promise;
    if (url.endsWith('/manage/items')) return response({ id: 'new-item' });
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]'), name = form.elements.namedItem('name');
  name.value = '尚未保存的商品';
  const input = form.querySelector('[data-community-item-upload]');
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1, 2, 3])], 'art.gif', { type: 'image/gif' })] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  const submit = form.querySelector('[type="submit"]');
  assert.equal(submit.disabled, true);
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(requests.filter(entry => entry.url.endsWith('/manage/items')).length, 0);
  pending.resolve(response({ id: image })); await turn();
  assert.equal(main.querySelector('[data-community-form="item"]'), form);
  assert.equal(name.value, '尚未保存的商品');
  assert.equal(form.elements.namedItem('image').value, image);
  assert.match(form.querySelector('[data-item-image-preview] img').src, new RegExp(image));
  assert.equal(submit.disabled, false);
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.equal(JSON.parse(requests.find(entry => entry.url.endsWith('/manage/items')).init.body).image, image);
});

for (const [label, failure, expected] of [
  ['HTML 413', () => new Response('<html><title>413 Request Entity Too Large</title></html>', { status: 413, headers: { 'Content-Type': 'text/html' } }), '文件超过上传上限，请缩小后重试。'],
  ['empty JSON 413', () => new Response('{}', { status: 413, headers: { 'Content-Type': 'application/json' } }), '文件超过上传上限，请缩小后重试。'],
  ['specific JSON 413', () => new Response(JSON.stringify({ error: '此类文件最多 25 MiB。' }), { status: 413, headers: { 'Content-Type': 'application/json' } }), '此类文件最多 25 MiB。'],
  ['HTML 502', () => new Response('<html><title>502 Bad Gateway</title></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }), '社区暂时无法读取。'],
]) test(`product upload reports ${label} accurately and preserves the editable draft`, async t => {
  const { main, w, requests } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/manage/item-image')) return failure();
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  form.elements.namedItem('name').value = '尚未保存的补签卡';
  form.elements.namedItem('price').value = '30';
  form.elements.namedItem('image').value = 'previous-artwork';
  const input = form.querySelector('[data-community-item-upload]');
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1, 2, 3])], 'makeup-card.png', { type: 'image/png' })] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await turn();
  assert.equal(form.querySelector('[data-item-upload-status]').textContent, expected);
  assert.equal(main.querySelector('[data-community-form="item"]'), form);
  assert.equal(form.elements.namedItem('name').value, '尚未保存的补签卡');
  assert.equal(form.elements.namedItem('price').value, '30');
  assert.equal(form.elements.namedItem('image').value, 'previous-artwork');
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
  assert.equal(input.disabled, false);
  assert.equal(form.dataset.uploading, undefined);
  assert.equal(form.getAttribute('aria-busy'), 'false');
  assert.equal(requests.filter(entry => entry.url.endsWith('/manage/item-image')).length, 1);
  assert.equal(requests.some(entry => entry.url.endsWith('/manage/items')), false);
});

test('desktop frame drops upload once, retain the draft and position, and clear drag feedback', async t => {
  const pending = deferred(), image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { main, w, requests } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/manage/item-image')) return pending.promise;
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  const kind = form.querySelector('[name="kind"][value="frame"]'); kind.checked = true;
  kind.dispatchEvent(new w.Event('change', { bubbles: true }));
  form.elements.namedItem('name').value = '动态星环';
  form.elements.namedItem('price').value = '70';
  const zone = form.querySelector('[data-item-media]');
  let scrolls = 0; w.scrollTo = () => { scrolls++; };
  const file = new File([new Uint8Array([1, 2, 3])], '星环.gif', { type: 'image/gif' });
  assert.equal(fileDrag(w, w.document.body, 'dragenter').defaultPrevented, true);
  assert.equal(zone.classList.contains('is-dragging'), true);
  fileDrag(w, zone.firstElementChild, 'dragenter');
  fileDrag(w, zone.firstElementChild, 'dragleave');
  assert.equal(zone.classList.contains('is-dragging'), true, 'moving between children does not flash the drop target');
  assert.equal(fileDrag(w, form, 'drop', [file]).defaultPrevented, true);
  const uploads = requests.filter(entry => entry.url.endsWith('/manage/item-image'));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].init.body.get('file').name, '星环.gif');
  assert.equal(form.querySelector('[type="submit"]').disabled, true);
  fileDrag(w, form, 'drop', [file]);
  assert.equal(requests.filter(entry => entry.url.endsWith('/manage/item-image')).length, 1);
  pending.resolve(response({ id: image, frameReady: true })); await turn();
  assert.equal(form.elements.namedItem('image').value, image);
  assert.equal(form.elements.namedItem('name').value, '动态星环');
  assert.equal(form.elements.namedItem('price').value, '70');
  assert.equal(main.querySelector('[data-community-form="item"]'), form);
  assert.ok(form.querySelector('[data-item-wear-sample] .community-frame-image'));
  assert.equal(zone.classList.contains('is-dragging'), false);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
  assert.equal(scrolls, 0);
});

test('equipment drops reject multiple files and invalid images without losing previous artwork', async t => {
  const { main, w, requests } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  form.elements.namedItem('image').value = 'previous';
  const picture = new File(['abc'], 'frame.png', { type: 'image/png' });
  fileDrag(w, form, 'drop', [picture, picture]); await turn();
  assert.match(form.querySelector('[data-item-upload-status]').textContent, /一个|一张/);
  fileDrag(w, form, 'drop', [new File(['bad'], 'frame.html', { type: 'text/html' })]); await turn();
  assert.match(form.querySelector('[data-item-upload-status]').textContent, /PNG/);
  assert.equal(form.elements.namedItem('image').value, 'previous');
  assert.equal(requests.some(entry => entry.url.endsWith('/manage/item-image')), false);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
  fileDrag(w, form, 'drop', []); await turn();
  assert.match(form.querySelector('[data-item-upload-status]').textContent, /文件/);
});

test('nickname JSON drops apply safe effects immediately and save through the existing item API', async t => {
  const { main, w, requests } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/manage/items')) return response({ id: 'imported-effect' });
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  const kind = form.querySelector('[name="kind"][value="color"]'); kind.checked = true;
  kind.dispatchEvent(new w.Event('change', { bubbles: true }));
  form.elements.namedItem('name').value = '新昵称特效';
  form.elements.namedItem('price').value = '50';
  const effect = { style: 'gradient', colors: ['#772255', '#126B65'] };
  const file = new File([JSON.stringify({ format: 'sansphase-name-effect', version: 1, effect })], '昵称特效.json', { type: 'application/json' });
  assert.equal(fileDrag(w, form, 'drop', [file]).defaultPrevented, true);
  await turn(); await turn();
  assert.equal(form.elements.namedItem('effectStyle').value, 'gradient');
  assert.equal(form.elements.namedItem('effectStart').value, '#772255');
  assert.equal(form.elements.namedItem('effectEnd').value, '#126B65');
  assert.equal(form.querySelector('[data-item-wear-sample] .community-uname').dataset.nameEffect, 'gradient');
  assert.equal(form.elements.namedItem('name').value, '新昵称特效');
  assert.equal(form.elements.namedItem('price').value, '50');
  assert.match(form.querySelector('[data-item-effect-status]').textContent, /导入/);
  assert.equal(requests.some(entry => entry.url.endsWith('/manage/item-image')), false);
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.deepEqual(JSON.parse(requests.find(entry => entry.url.endsWith('/manage/items')).init.body).effect, { style: 'gradient', colors: ['#772255', '#126B65'] });
});

test('nickname imports reject executable data, keep existing settings and ignore a late import after switching types', async t => {
  const { main, w } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  const colour = form.querySelector('[name="kind"][value="color"]'); colour.checked = true;
  colour.dispatchEvent(new w.Event('change', { bubbles: true }));
  const original = form.elements.namedItem('effectStart').value;
  fileDrag(w, form, 'drop', [new File(['{"style":"shimmer","colors":["#772255","#126B65"],"css":"script"}'], 'bad.json')]);
  await turn(); await turn();
  assert.equal(form.elements.namedItem('effectStart').value, original);
  assert.match(form.querySelector('[data-item-effect-status]').textContent, /支持|格式|字段/);
  const pending = deferred();
  const delayed = new File(['{}'], 'late.json'); delayed.arrayBuffer = () => pending.promise;
  fileDrag(w, form, 'drop', [delayed]);
  const goods = form.querySelector('[name="kind"][value="goods"]'); goods.checked = true;
  goods.dispatchEvent(new w.Event('change', { bubbles: true }));
  pending.resolve(new TextEncoder().encode('{"style":"solid","colors":["#772255"]}').buffer); await turn(); await turn();
  assert.equal(form.elements.namedItem('effectStart').value, original);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
  assert.doesNotMatch(form.querySelector('[data-item-effect-status]').textContent, /正在/);
});

test('nickname file selection uses the same importer and desktop drag handlers leave other pages alone', async t => {
  const { main, w, ui, ctx } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    return null;
  });
  assert.equal(fileDrag(w, main, 'drop', [new File(['{}'], 'effect.json')]).defaultPrevented, false, 'closed item editors do not claim desktop files');
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  const colour = form.querySelector('[name="kind"][value="color"]'); colour.checked = true;
  colour.dispatchEvent(new w.Event('change', { bubbles: true }));
  const input = form.querySelector('[data-community-effect-upload]');
  Object.defineProperty(input, 'files', { value: [new File(['{"style":"solid","colors":["#456789"]}'], 'effect.json')] });
  input.dispatchEvent(new w.Event('change', { bubbles: true })); await turn(); await turn();
  assert.equal(form.elements.namedItem('effectStyle').value, 'solid');
  assert.equal(form.querySelector('input[type="color"], select[name="effectStyle"]'), null);
  assert.equal(form.elements.namedItem('effectStart').value, '#456789');
  const textDrag = new w.Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(textDrag, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
  form.dispatchEvent(textDrag); assert.equal(textDrag.defaultPrevented, false);
  const cleanup = ui.mount(main, ctx);
  try { cleanup(); assert.equal(fileDrag(w, main, 'drop', [new File(['{}'], 'effect.json')]).defaultPrevented, false); }
  finally { cleanup(); }
});

test('oversized desktop images are rejected before network upload and failed uploads release the editor', async t => {
  const { main, w, requests } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/manage/item-image')) return Promise.reject(new Error('素材上传失败'));
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  const tooBig = new File(['abc'], 'too-big.gif', { type: 'image/gif' });
  Object.defineProperty(tooBig, 'size', { value: 25 * 1024 * 1024 + 1 });
  fileDrag(w, form, 'drop', [tooBig]); await turn();
  assert.match(form.querySelector('[data-item-upload-status]').textContent, /25MB/);
  assert.equal(requests.some(entry => entry.url.endsWith('/manage/item-image')), false);
  fileDrag(w, form, 'drop', [new File(['abc'], 'frame.gif', { type: 'image/gif' })]); await turn();
  assert.match(form.querySelector('[data-item-upload-status]').textContent, /网络连接失败/);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
  assert.equal(form.querySelector('[data-community-item-upload]').disabled, false);
  assert.equal(form.getAttribute('aria-busy'), 'false');
});

test('repainting while a desktop upload is pending retains the form lock and eventual result', async t => {
  const pending = deferred(), image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const { main, w, ui, ctx, requests } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/manage/item-image')) return pending.promise;
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  const file = new File(['abc'], 'frame.gif', { type: 'image/gif' });
  fileDrag(w, form, 'drop', [file]);
  const cleanup = ui.mount(main, ctx);
  try {
    assert.equal(main.querySelector('[data-community-form="item"]'), form);
    assert.equal(form.querySelector('[type="submit"]').disabled, true);
    fileDrag(w, main, 'drop', [file]);
    assert.equal(requests.filter(entry => entry.url.endsWith('/manage/item-image')).length, 1);
    pending.resolve(response({ id: image, frameReady: true })); await turn();
    assert.equal(form.elements.namedItem('image').value, image);
    assert.equal(form.querySelector('[type="submit"]').disabled, false);
  } finally { cleanup(); }
});

test('new nickname equipment requires a finished file instead of silently applying a default', async t => {
  const { main, w, requests } = await setup(t, '#/community/manage/items', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    return null;
  });
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]');
  const colour = form.querySelector('[name="kind"][value="color"]'); colour.checked = true;
  colour.dispatchEvent(new w.Event('change', { bubbles: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(form.querySelector('.community-form-status').textContent, /昵称特效文件/);
  assert.equal(requests.some(entry => entry.url.endsWith('/manage/items')), false);
});

test('management deletes only after entering a reason and stays in its management section', async t => {
  const { main, w, requests } = await setup(t, '#/community/manage/content', (url, init) => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.includes('/manage?')) return response(managementData);
    if (url.endsWith('/delete')) return response({ ok: true });
    return null;
  });
  main.querySelector('[data-action="community-queue-delete"]').click();
  assert.equal(requests.some(entry => entry.url.endsWith('/delete')), false);
  const form = main.querySelector('[data-community-form="delete"]');
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(requests.some(entry => entry.url.endsWith('/delete')), false);
  form.elements.namedItem('reason').value = '重复发布相同内容';
  form.elements.namedItem('violation').checked = false;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.deepEqual(JSON.parse(requests.find(entry => entry.url.endsWith('/delete')).init.body), { reason: '重复发布相同内容', violation: false, mute: 0 });
  assert.equal(w.location.hash, '#/community/manage/content');
  assert.equal(main.querySelector('[data-community-form="delete"]'), null);
});

test('switching browsing perspective drops late management responses and retains the real account', async t => {
  const pending = deferred(); let reader = false;
  const { ui, ctx } = await setup(t, '#/community/manage/items', (url, init) => {
    if (url.endsWith('/me')) return response({ ...managementViewer, owner: !reader, mod: !reader, management: { role: 'owner', browsingAsReader: reader } });
    if (url.endsWith('/browse-mode')) { reader = JSON.parse(init.body).reader; return response({ ok: true }); }
    if (url.includes('/manage?')) return pending.promise;
    return null;
  });
  await ui.setBrowsing(true);
  assert.equal(ui.me().name, '無相'); assert.equal(ui.me().mod, false);
  assert.doesNotMatch(ui.html(ctx), /community-browse-banner|当前仅浏览，互动和管理操作暂停/);
  assert.match(communityAccountHTML({ ...ctx, me: ui.me() }), /返回作者身份/, 'the account menu still restores the actual manager');
  pending.resolve(response({ ...managementData, items: [{ id: 'private', name: '旧管理会话机密资料' }] })); await turn();
  await ui.setBrowsing(false);
  assert.equal(ui.me().mod, true);
  assert.doesNotMatch(ui.html(ctx), /旧管理会话机密资料/);
});

test('ordinary readers cannot initiate either browsing perspective switch', async t => {
  const { ui, w, requests } = await setup(t, '#/community/home');
  await ui.setBrowsing(true);
  await ui.setBrowsing(false);
  assert.equal(requests.some(entry => entry.url.endsWith('/browse-mode')), false);
  assert.equal(w.location.hash, '#/community/home');
});

test('an ordinary reader can check in once and the reminder updates without changing the page', async t => {
  let checked = false;
  const notices = [];
  const { main, w, requests } = await setup(t, '#/community/home', (url, init) => {
    if (url.endsWith('/me')) return response({ ...person, checkedIn: checked });
    if (url.endsWith('/checkin') && init.method === 'POST') { checked = true; return response({ reward: 1, bonus: 0, streak: 1 }); }
    return null;
  }, { notify: value => notices.push(value) });
  const button = main.querySelector('[data-action="community-checkin"]');
  assert.ok(button);
  button.click(); button.click(); await turn(); await turn();
  assert.equal(requests.filter(entry => entry.url.endsWith('/checkin') && entry.init.method === 'POST').length, 1);
  assert.equal(main.querySelector('[data-action="community-checkin"]'), null);
  assert.ok(main.querySelector('.community-ck-pill.is-done'));
  assert.match(notices.at(-1), /签到成功/);
  assert.match(notices.at(-1), /\+1 星尘/);
  assert.doesNotMatch(notices.at(-1), /undefined/);
  assert.equal(w.location.hash, '#/community/home');
});

test('a malformed successful check-in response is not presented as a completed operation', async t => {
  const notices = [];
  const { main } = await setup(t, '#/community/home', (url, init) => {
    if (url.endsWith('/me')) return response({ ...person, checkedIn: false });
    if (url.endsWith('/checkin') && init.method === 'POST') return { ok: true, status: 200, json: async () => { throw new SyntaxError('malformed JSON'); } };
    return null;
  }, { notify: value => notices.push(value) });
  main.querySelector('[data-action="community-checkin"]').click(); await turn(); await turn();
  assert.doesNotMatch(notices.join(''), /签到成功|undefined/);
  assert.match(notices.at(-1), /响应|读取|重试/);
  assert.equal(main.querySelector('[data-action="community-checkin"]').disabled, false);
});

test('redemption retries retain their operation key after a lost response and a later purchase gets a new one', async t => {
  const attempts = [];
  const merchandise = { balance: 100, level: 1, owner: false, inventory: { makeup: 0, pin: 0, highlight: 0 }, decorations: { frame: null, color: null, cover: null },
    items: [{ id: 'card-makeup', cat: 'card', kind: 'card', ref: 'makeup', name: '补签卡', desc: '补签最近七天的一天。', price: 30, builtin: true, active: true, state: { owned: false, left: null, ok: true, code: 'ok', why: '' } }] };
  const { main, w } = await setup(t, '#/community/shop', (url, init) => {
    if (url.endsWith('/shop')) return response(merchandise);
    if (url.endsWith('/shop/redeem')) {
      attempts.push(new Headers(init.headers).get('X-Idempotency-Key'));
      if (attempts.length === 1) return Promise.reject(new Error('response lost after settlement'));
      return response({ item: merchandise.items[0] });
    }
    return null;
  });
  const submit = async expectedAttempts => {
    const form = main.querySelector('form[data-community-form="redeem"]');
    assert.ok(form, 'the deliberate purchase must have a reviewable form');
    const button = form.querySelector('button[type="submit"]');
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    // The protected write awaits WebCrypto before it reaches the request.
    // Wait for the response's actual UI settlement before deliberately retrying.
    const deadline = performance.now() + 5000;
    while (attempts.length < expectedAttempts || (form.isConnected && button.disabled)) {
      assert.ok(performance.now() < deadline, `redemption attempt ${expectedAttempts} and its form must settle`);
      await turn();
    }
    assert.equal(attempts.length, expectedAttempts, 'one deliberate submit makes one request');
  };
  main.querySelector('[data-action="community-redeem"]').click();
  await submit(1);
  assert.ok(main.querySelector('form[data-community-form="redeem"]'), 'a failed response retains the reviewable purchase');
  await submit(2);
  assert.ok(attempts[0], 'protected mutations carry an operation key');
  assert.equal(attempts[1], attempts[0], 'retry the same purchase rather than debit another one');
  assert.equal(main.querySelector('form[data-community-form="redeem"]'), null);
  main.querySelector('[data-action="community-redeem"]').click(); await submit(3);
  assert.ok(attempts[2], 'the later purchase carries its own operation key');
  assert.notEqual(attempts[2], attempts[0], 'a new deliberate purchase remains possible');
});

test('a moderator cannot switch perspective until an unresolved purchase is confirmed with its original key', async t => {
  let reader = false;
  const attempts = [];
  const merchandise = { balance: 100, level: 1, owner: false, inventory: {}, decorations: {}, items: [{ id: 'card-makeup', cat: 'card', kind: 'card', ref: 'makeup', name: '补签卡', price: 30, builtin: true, active: true, state: { owned: false, left: null, ok: true, code: 'ok', why: '' } }] };
  const { main, w, ui } = await setup(t, '#/community/shop', (url, init) => {
    if (url.endsWith('/me')) return response({ ...person, mod: !reader, management: { role: 'steward', browsingAsReader: reader } });
    if (url.endsWith('/browse-mode')) { reader = JSON.parse(init.body).reader; return response({ ok: true }); }
    if (url.endsWith('/shop')) return response(merchandise);
    if (url.endsWith('/shop/redeem')) {
      attempts.push(new Headers(init.headers).get('X-Idempotency-Key'));
      return attempts.length === 1 ? Promise.reject(new Error('response lost')) : response({ item: merchandise.items[0] });
    }
    return null;
  });
  const purchase = async expectedAttempts => {
    main.querySelector('[data-action="community-redeem"]').click();
    const form = main.querySelector('form[data-community-form="redeem"]');
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    // WebCrypto may finish after several event-loop turns when the full suite is busy.
    // Switch perspective only after the lost response has actually been handled.
    const deadline = performance.now() + 5000;
    while (attempts.length < expectedAttempts || (form.isConnected && form.querySelector('button[type="submit"]').disabled)) {
      assert.ok(performance.now() < deadline, 'the redemption request and UI must settle');
      await turn();
    }
  };
  await purchase(1);
  await ui.setBrowsing(true); await ui.setBrowsing(false);
  assert.equal(reader, false, 'an uncertain purchase retains its active identity');
  await purchase(2);
  assert.ok(attempts[0]);
  assert.equal(attempts[1], attempts[0], 'changing only the browsing perspective must not create another economic operation');
  await ui.setBrowsing(true); assert.equal(reader, true);
});

for (const role of ['owner', 'steward']) test(`a read-only ${role} perspective can browse previous check-in months with its correct identity note and no write requests`, async t => {
  const month = new Date().toISOString().slice(0, 7);
  const { main, requests } = await setup(t, '#/community/checkin', url => {
    if (url.endsWith('/me')) return response(readerPreview(role));
    if (url.includes('/checkin')) return response({ checkedIn: false, streak: 0, balance: 0, gainedToday: 0, behaviourToday: 0, vip: false,
      owner: false, browsingAsReader: true, month: new URL(url, 'http://localhost').searchParams.get('month') || month, days: [], monthBonus: 0, checkinsToday: 0, earlyBirds: [], badges: [], makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] } });
    return null;
  });
  const previous = main.querySelector('[data-action="community-month"]');
  assert.ok(previous);
  previous.click(); await turn(); await turn();
  assert.ok(requests.some(entry => /\/checkin\?month=/.test(entry.url)));
  assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
  assert.match(main.textContent, role === 'owner' ? /作者不参与签到/ : /返回版主身份后可以签到/);
  assert.match(main.querySelector('.community-calendar-note').textContent, role === 'owner' ? /作者不参与签到和补签/ : /返回版主身份后可以签到和补签/);
  if (role === 'owner') assert.doesNotMatch(main.textContent, /返回版主身份/);
});

for (const role of ['owner', 'steward']) {
  test(`${role} reader preview filters the real stardust ledger using only GET requests`, async t => {
    const { main, requests } = await setup(t, '#/community/stardust', url => {
      if (url.endsWith('/me')) return response(readerPreview(role));
      if (url.includes('/stardust')) {
        const flow = new URL(url, 'http://localhost').searchParams.get('flow') || 'all';
        return response({ balance: 30, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: true, month: { gained: 5, spent: 5 }, flow,
          ledger: [{ id: `ledger-${flow}`, amount: flow === 'out' ? -5 : 5, kind: flow === 'out' ? 'spend' : 'earn', reason: 'shop', detail: `明细 ${flow}`, createdAt: '2026-10-01T10:00:00Z', reverted: false, topic: null }],
          level: 1, owner: false, steward: false, browsingAsReader: true, stats: {}, progress: null });
      }
      return null;
    });
    for (const flow of ['in', 'out']) {
      main.querySelector(`[data-action="community-flow"][data-flow="${flow}"]`).click(); await turn();
      assert.equal(requests.some(entry => entry.url.endsWith(`/stardust?flow=${flow}`) && (entry.init.method || 'GET') === 'GET'), true);
      assert.match(main.querySelector('.community-ledger-wrap').textContent, new RegExp(`明细 ${flow}`));
      assert.equal(main.querySelector(`[data-flow="${flow}"]`).getAttribute('aria-pressed'), 'true');
    }
    assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
  });

  test(`${role} reader preview opens the post menu and copies visible content without enabling stale write controls`, async t => {
    const copied = clipboardFixture(t), notices = [];
    const shown = thread();
    Object.assign(shown.topic, { board: 'showcase', canModerate: true, meta: { tools: '现有工具', model: '', usage: '作品展示', promptMode: 'public', prompt: '已公开的提示词' } });
    const { main, w, requests } = await setup(t, '#/post/p1', url => {
      if (url.endsWith('/me')) return response(readerPreview(role));
      if (url.endsWith('/topics/p1')) return response(shown);
      return null;
    }, { notify: value => notices.push(value) });
    const section = main.querySelector('[data-community]');
    const button = main.querySelector('[data-action="community-post-menu"]');
    assert.ok(button);
    button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(main.querySelector('#community-post-menu').hidden, false);
    main.querySelector('[data-action="community-pin"]').click();
    assert.match(notices.at(-1), /当前预览仅供查看/);
    button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(main.querySelector('[data-community]'), section);
    main.querySelector('[data-action="community-copy-link"]').click(); await turn();
    main.querySelector('[data-action="community-copy-prompt"]').click(); await turn();
    assert.deepEqual(copied, [w.location.href, '已公开的提示词']);
    main.querySelector('[data-action="community-like"]').click();
    main.querySelector('[data-action="community-bookmark"]').click();
    assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
  });

  test(`${role} reader preview reads, copies and closes an already-owned digital delivery without writing`, async t => {
    const copied = clipboardFixture(t);
    const { main, requests } = await setup(t, '#/community/shop/mine', url => {
      if (url.endsWith('/me')) return response(readerPreview(role));
      if (url.endsWith('/shop/mine')) return response({ balance: 30, inventory: {}, decorations: { frame: null, color: null, cover: null }, looks: [], digital: [{ id: 'pack', name: '已有资源', desc: '正式资源' }], orders: [] });
      if (url.endsWith('/shop/items/pack/delivery')) return response({ name: '已有资源', delivery: '链接：https://x.example/owned' });
      return null;
    });
    main.querySelector('[data-action="community-delivery"]').click(); await turn();
    assert.ok(main.querySelector('.community-delivery'));
    assert.equal(requests.some(entry => entry.url.endsWith('/shop/items/pack/delivery') && (entry.init.method || 'GET') === 'GET'), true);
    main.querySelector('[data-action="community-copy-delivery"]').click(); await turn();
    assert.deepEqual(copied, ['链接：https://x.example/owned']);
    main.querySelector('[data-action="community-delivery-close"]').click();
    assert.equal(main.querySelector('.community-delivery'), null);
    assert.equal(requests.some(entry => entry.init.method === 'POST'), false);
  });
}

for (const role of ['owner', 'steward', 'reader']) test(`${role} inbox notification opens its public post and marks read only outside preview`, async t => {
  const { main, w, requests, remount } = await setup(t, '#/community/inbox', url => {
    if (url.endsWith('/me')) return response(role === 'reader' ? person : readerPreview(role));
    if (url.includes('/inbox?')) return response({ tab: 'all', unread: { all: 1, reply: 1, thanks: 0, system: 0 }, items: [{ id: 'n1', type: 'reply', actor: person, topicId: 'p1', replyId: null, text: '', data: {}, link: '#/post/p1', count: 1, createdAt: '2026-10-01T10:00:00Z', read: false, topicTitle: '公开讨论' }] });
    if (url.endsWith('/inbox/read')) return response({ ok: true });
    return null;
  });
  const notice = main.querySelector('[data-action="community-notice"]');
  assert.ok(notice);
  notice.click(); await turn();
  assert.equal(w.location.hash, '#/post/p1');
  assert.equal(requests.filter(entry => entry.init.method === 'POST').length, role === 'reader' ? 1 : 0);
  if (role === 'reader') assert.equal(requests.some(entry => entry.url.endsWith('/inbox/read') && entry.init.method === 'POST'), true);
  await remount();
  assert.match(main.querySelector('.community-text').textContent, /保留正在阅读的正文/);
  assert.equal(requests.some(entry => entry.url.endsWith('/topics/p1') && (entry.init.method || 'GET') === 'GET'), true);
});

for (const role of ['owner', 'steward']) test(`${role} perspective switches stay on the current board without opening management or scrolling`, async t => {
    let reader = false;
    const notices = [];
    const identity = { ...managementViewer, name: role === 'owner' ? '無相' : '守望', uid: role === 'owner' ? 'owner' : '10006' };
    const { ui, w, requests } = await setup(t, '#/community/boards/qa', (url, init) => {
      if (url.endsWith('/me')) return response({ ...identity, owner: role === 'owner' && !reader, mod: !reader, management: { role, browsingAsReader: reader } });
      if (url.endsWith('/browse-mode')) { reader = JSON.parse(init.body).reader; return response({ ok: true }); }
      return null;
    }, { notify: text => notices.push(text) });
    let top = 420; Object.defineProperty(w, 'scrollY', { get: () => top });
    w.scrollTo = options => { top = options.top; };
    for (const perspective of [true, false]) {
      await ui.setBrowsing(perspective);
      assert.equal(w.location.hash, '#/community/boards/qa');
      assert.equal(top, 420);
      assert.deepEqual([ui.me().name, ui.me().uid], [identity.name, identity.uid]);
      assert.equal(ui.me().management.browsingAsReader, perspective);
    }
    assert.equal(requests.some(entry => /\/manage(?:\?|$)/.test(entry.url)), false, 'management loads only after opening its menu link');
    assert.deepEqual(notices, ['已切换为读者视角。', '已返回管理身份。'], 'operation notices state the result without redundant menu guidance');
});

test('switching perspective on a public thread preserves the unsent reply and its caret', async t => {
  let reader = false;
  const { ui, w, main } = await setup(t, '#/post/p1', (url, init) => {
    if (url.endsWith('/me')) return response({ ...managementViewer, owner: !reader, mod: !reader, management: { role: 'owner', browsingAsReader: reader } });
    if (url.endsWith('/browse-mode')) { reader = JSON.parse(init.body).reader; return response({ ok: true }); }
    return null;
  });
  const field = main.querySelector('#community-reply');
  field.value = '切换身份前还没有发送的回复';
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  field.focus(); field.setSelectionRange(2, 7); field.scrollTop = 45;
  await ui.setBrowsing(true);
  await ui.setBrowsing(false);
  const restored = main.querySelector('#community-reply');
  assert.equal(w.location.hash, '#/post/p1');
  assert.equal(restored.value, '切换身份前还没有发送的回复');
  assert.deepEqual([restored.selectionStart, restored.selectionEnd], [2, 7]);
  assert.equal(restored.scrollTop, 45);
});

test('an existing content edit must finish before switching perspective, keeping its unsaved changes intact', async t => {
  const notices = [];
  const { ui, main, requests } = await setup(t, '#/community/edit/p1', url => {
    if (url.endsWith('/me')) return response(managementViewer);
    if (url.endsWith('/topics/p1')) return response({ ...thread(), topic: { ...thread().topic, canEdit: true } });
    if (url.endsWith('/browse-mode')) return response({ ok: true });
    return null;
  }, { notify: text => notices.push(text) });
  const field = main.querySelector('form[data-edit] textarea[name="body"]');
  assert.ok(field);
  field.value = '尚未保存的正文修改';
  await ui.setBrowsing(true);
  assert.equal(requests.some(entry => entry.url.endsWith('/browse-mode')), false);
  assert.equal(main.querySelector('form[data-edit] textarea[name="body"]'), field);
  assert.equal(field.value, '尚未保存的正文修改');
  assert.match(notices.at(-1), /完成或取消.*编辑/);
});

test('an old perspective response cannot clear or notify a newer account session', async t => {
  const pending = deferred(), notices = [];
  let viewer = managementViewer;
  const { ui, w, main, requests, remount } = await setup(t, '#/community/boards/qa', url => {
    if (url.endsWith('/me')) return response(viewer);
    if (url.endsWith('/browse-mode')) return pending.promise;
    if (url.endsWith('/topics/p1')) return response({ ...thread(), topic: { ...thread().topic, canEdit: true } });
    return null;
  }, { notify: text => notices.push(text) });
  const switchRequest = ui.setBrowsing(true);
  ui.clear(); viewer = { ...person, name: '另一个读者', uid: '10007', management: null };
  await remount('#/community/edit/p1');
  const editor = main.querySelector('form[data-edit]');
  assert.ok(editor, 'an old account request cannot keep a new account editor waiting');
  const meReads = requests.filter(entry => entry.url.endsWith('/me')).length;
  pending.resolve(response({ ok: true })); await switchRequest;
  assert.equal(ui.me().uid, '10007');
  assert.equal(w.location.hash, '#/community/edit/p1');
  assert.equal(main.querySelector('form[data-edit]'), editor);
  assert.equal(requests.filter(entry => entry.url.endsWith('/me')).length, meReads);
  assert.deepEqual(notices, []);
});

test('a pending perspective switch does not offer a new existing-content editor while its permissions are changing', async t => {
  const pending = deferred(); let reader = false;
  const { ui, main, remount } = await setup(t, '#/community/boards/qa', url => {
    if (url.endsWith('/me')) return response({ ...managementViewer, owner: !reader, mod: !reader, management: { role: 'owner', browsingAsReader: reader } });
    if (url.endsWith('/browse-mode')) return pending.promise;
    if (url.endsWith('/topics/p1')) return response({ ...thread(), topic: { ...thread().topic, canEdit: !reader } });
    return null;
  });
  const switching = ui.setBrowsing(true);
  await remount('#/community/edit/p1');
  assert.equal(main.querySelector('form[data-edit]'), null, 'permissions must settle before a non-persistent editor can be offered');
  reader = true; pending.resolve(response({ ok: true })); await switching;
  assert.equal(main.querySelector('form[data-edit]'), null);
});

test('exchange detail viewing hands off to the existing confirmation and cancelling preserves the compact collection', async t => {
  const merchandise = {
    balance: 30, level: 1, owner: false, inventory: { makeup: 0, pin: 0, highlight: 0 }, decorations: { frame: null, color: null, cover: null },
    items: [{ id: 'card-makeup', cat: 'card', kind: 'card', ref: 'makeup', name: '补签卡', desc: '补签最近七天的一天。', price: 30, builtin: true, active: true,
      state: { owned: false, left: null, ok: true, code: 'ok', why: '' } }],
  };
  const { main, w, requests } = await setup(t, '#/community/shop', url => url.endsWith('/shop') ? response(merchandise) : null);
  main.querySelector('.community-sitem-title').click();
  const dialog = w.document.querySelector('.community-shop-dialog');
  assert.ok(dialog);
  assert.match(dialog.querySelector('.community-shop-detail-description').textContent, /最近七天/);
  dialog.querySelector('[data-action="community-redeem"]').click();
  assert.equal(w.document.querySelector('.community-shop-dialog'), null, 'the reviewable confirmation owns focus after the handoff');
  assert.ok(main.querySelector('form[data-community-form="redeem"]'));
  main.querySelector('[data-action="community-redeem-cancel"]').click();
  assert.equal(main.querySelector('form[data-community-form="redeem"]'), null);
  assert.ok(main.querySelector('.community-sitem-title'));
  assert.equal(main.querySelector('details[data-shop-description]'), null);
  main.querySelector('.community-sitem-title').click();
  assert.ok(w.document.querySelector('.community-shop-dialog'), 'details can be opened again after cancellation');
  assert.equal(requests.some(entry => entry.init.method === 'POST'), false, 'viewing an explanation and cancelling must not spend stardust');
});

test('like and bookmark keep the reading DOM, reply draft, caret and editor scroll intact', async t => {
  const { main, w } = await setup(t, '#/post/p1');
  const section = main.querySelector('[data-community]');
  const body = main.querySelector('.community-text');
  const field = main.querySelector('#community-reply');
  field.value = '尚未发送的回复草稿，包含正在编辑的内容。';
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  field.focus(); field.setSelectionRange(4, 9); field.scrollTop = 73;
  for (const kind of ['like', 'bookmark']) {
    const button = main.querySelector(`.community-actbar [data-action="community-${kind}"]`);
    button.click();
    await turn();
    assert.equal(main.querySelector('[data-community]'), section, `${kind} must not recreate the page`);
    assert.equal(main.querySelector('.community-text'), body);
    assert.equal(main.querySelector('#community-reply'), field);
    assert.equal(field.scrollTop, 73);
    assert.deepEqual([field.selectionStart, field.selectionEnd], [4, 9]);
    assert.equal(w.document.activeElement, field);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.disabled, false);
  }
  assert.equal(main.querySelector('.community-actbar [data-action="community-like"] span').textContent, '7');
  assert.equal(main.querySelector('[data-action="community-bookmark"] small').textContent, '2');
});

test('sending a reply does not scroll the page to the new reply', async t => {
  let sent = false;
  const { main, w, requests } = await setup(t, '#/post/p1', (url, init) => {
    if (url.endsWith('/topics/p1/replies') && init.method === 'POST') { sent = true; return response({ id: 'r3' }); }
    if (url.endsWith('/topics/p1') && sent) {
      const data = thread(); data.replies.push({ ...data.replies[0], id: 'r3', body: '新回复内容' }); return response(data);
    }
    return null;
  });
  let autoScroll = 0;
  w.HTMLElement.prototype.scrollIntoView = () => { autoScroll++; };
  main.querySelector('#community-reply').value = '这是准备发送的回复内容。';
  main.querySelector('form[data-community-form="reply"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const deadline = performance.now() + 5000;
  while (!main.querySelector('#reply-r3')) {
    assert.ok(performance.now() < deadline, 'the reply request and rendered response must settle');
    await turn();
  }
  assert.equal(requests.filter(item => item.url.endsWith('/replies') && item.init.method === 'POST').length, 1);
  assert.ok(main.querySelector('#reply-r3')); assert.equal(autoScroll, 0);
});

test('reply sorting moves the existing replies without rebuilding the thread or draft', async t => {
  const { main, w } = await setup(t, '#/post/p1');
  const section = main.querySelector('[data-community]');
  const field = main.querySelector('#community-reply');
  const r1 = main.querySelector('#reply-r1'), r2 = main.querySelector('#reply-r2');
  field.value = '正在输入的回复'; field.dispatchEvent(new w.Event('input', { bubbles: true })); field.scrollTop = 55;
  const button = main.querySelector('[data-action="community-reply-sort"][data-sort="likes"]');
  button.focus(); button.click();
  assert.equal(main.querySelector('[data-community]'), section);
  assert.deepEqual([...main.querySelectorAll('.community-replies > li')], [r2, r1]);
  assert.equal(main.querySelector('#community-reply'), field);
  assert.equal(field.scrollTop, 55);
  assert.equal(w.document.activeElement, button);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
});

test('changing list sort keeps current results while waiting and preserves the surrounding controls', async t => {
  const pending = deferred();
  const { main, w } = await setup(t, '#/community/home', url => url.includes('sort=newest') ? pending.promise : null);
  const section = main.querySelector('[data-community]'), banner = main.querySelector('.community-banner');
  const results = main.querySelector('.community-results'), topics = main.querySelector('.community-curated-list'); assert.ok(topics);
  const field = main.querySelector('#community-search');
  const button = main.querySelector('[data-action="community-sort"][data-sort="newest"]');
  button.focus(); button.click();
  assert.equal(main.querySelector('.community-curated-list'), topics, 'pending sort must not replace a long list with a short loading placeholder');
  assert.equal(results.getAttribute('aria-busy'), 'true');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  pending.resolve(response(listing(['p3', 'p4'])));
  await turn();
  assert.equal(main.querySelector('[data-community]'), section);
  assert.equal(main.querySelector('.community-banner'), banner);
  assert.equal(main.querySelector('.community-results'), results);
  assert.equal(main.querySelector('#community-search'), field);
  assert.equal(w.document.activeElement, button);
  assert.equal(results.hasAttribute('aria-busy'), false);
  assert.match(results.textContent, /讨论 p3/);
});

test('load more appends new rows without detaching existing rows or the surrounding page', async t => {
  const pending = deferred();
  const { main } = await setup(t, '#/community/home', url => url.includes('page=2') ? pending.promise : null);
  const newest = main.querySelector('[data-action="community-sort"][data-sort="newest"]'); assert.ok(newest);
  newest.click(); await turn();
  const section = main.querySelector('[data-community]'), topics = main.querySelector('.community-topics');
  assert.ok(topics, 'this case exercises pagination in the normal post flow');
  const rows = [...topics.children];
  const button = main.querySelector('[data-action="community-more"]');
  button.focus(); button.click();
  assert.equal(main.querySelector('[data-community]'), section);
  assert.equal(button.disabled, true);
  assert.deepEqual([...topics.children], rows);
  pending.resolve(response({ ...listing(['p3', 'p4']), page: 2 }));
  await turn();
  assert.equal(main.querySelector('.community-topics'), topics);
  assert.deepEqual([...topics.children].slice(0, 2), rows);
  assert.equal(topics.children.length, 4);
});

test('search retains typed input, focus and old rows until the replacement result arrives', async t => {
  const pending = deferred();
  const { main, w } = await setup(t, '#/community/home', url => url.includes('q=needle') ? pending.promise : null);
  const field = main.querySelector('#community-search'), rows = main.querySelector('.community-curated-list'); assert.ok(rows);
  field.value = 'needle'; field.focus(); field.setSelectionRange(2, 4);
  field.form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(main.querySelector('.community-curated-list'), rows);
  pending.resolve(response(listing(['match'])));
  await turn();
  assert.equal(main.querySelector('#community-search'), field);
  assert.equal(w.document.activeElement, field);
  assert.equal(field.value, 'needle');
  assert.deepEqual([field.selectionStart, field.selectionEnd], [2, 4]);
  assert.match(main.querySelector('.community-search-summary').textContent, /needle/);
});

test('rapid sort changes ignore an earlier request for the same final sort', async t => {
  const first = deferred(), second = deferred(), final = deferred();
  let newestCalls = 0;
  const { main } = await setup(t, '#/community/home', url => {
    if (url.includes('sort=newest')) return ++newestCalls === 1 ? first.promise : final.promise;
    if (url.includes('sort=active')) return second.promise;
    return null;
  });
  const rows = main.querySelector('.community-curated-list'); assert.ok(rows);
  for (const sort of ['newest', 'active', 'newest']) {
    const control = main.querySelector(`[data-action="community-sort"][data-sort="${sort}"]`); assert.ok(control);
    control.click();
  }
  first.resolve(response(listing(['old']))); await turn();
  assert.equal(main.querySelector('.community-curated-list'), rows);
  assert.equal(main.querySelector('.community-results').getAttribute('aria-busy'), 'true');
  final.resolve(response(listing(['final']))); await turn();
  second.resolve(response(listing(['wrong-sort']))); await turn();
  assert.match(main.querySelector('.community-results').textContent, /讨论 final/);
  assert.doesNotMatch(main.querySelector('.community-results').textContent, /wrong-sort/);
});

test('opening and closing the post menu preserves the reading surface and reply field', async t => {
  const ownThread = thread(); ownThread.topic.canEdit = true;
  const { main } = await setup(t, '#/post/p1', url => url.endsWith('/topics/p1') ? response(ownThread) : null);
  const section = main.querySelector('[data-community]'), field = main.querySelector('#community-reply');
  const button = main.querySelector('[data-action="community-post-menu"]');
  assert.ok(button);
  button.click();
  assert.equal(main.querySelector('[data-community]'), section);
  assert.equal(main.querySelector('#community-reply'), field);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});
