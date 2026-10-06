import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { communityAccountHTML } from '../src/community.ts';

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
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
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
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn(); await turn();
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
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn(); await turn();
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
  const publish = () => { const form = main.querySelector('[data-community-form="reply"]'); form.elements.namedItem('body').value = '结果需要确认的正式回复。'; form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); };
  publish(); await turn(); await turn();
  await ui.setBrowsing(false);
  assert.equal(requests.some(entry => entry.url.endsWith('/browse-mode')), false);
  assert.match(notices.at(-1), /提交.*确认|确认.*提交/);
  publish(); await turn(); await turn();
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
  const { main, remount } = await setup(t, '#/community/manage/stewards', url => {
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
  await remount('#/community/manage/reports'); await remount('#/community/manage/stewards');
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
  const submit = () => main.querySelector('form[data-community-form="redeem"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  main.querySelector('[data-action="community-redeem"]').click();
  submit(); await turn(); await turn();
  assert.ok(main.querySelector('form[data-community-form="redeem"]'), 'a failed response retains the reviewable purchase');
  submit(); await turn(); await turn();
  assert.ok(attempts[0], 'protected mutations carry an operation key');
  assert.equal(attempts[1], attempts[0], 'retry the same purchase rather than debit another one');
  assert.equal(main.querySelector('form[data-community-form="redeem"]'), null);
  main.querySelector('[data-action="community-redeem"]').click(); submit(); await turn(); await turn();
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

test('exchange descriptions remain expanded when opening and cancelling a redemption panel', async t => {
  const merchandise = {
    balance: 30, level: 1, owner: false, inventory: { makeup: 0, pin: 0, highlight: 0 }, decorations: { frame: null, color: null, cover: null },
    items: [{ id: 'card-makeup', cat: 'card', kind: 'card', ref: 'makeup', name: '补签卡', desc: '补签最近七天的一天。', price: 30, builtin: true, active: true,
      state: { owned: false, left: null, ok: true, code: 'ok', why: '' } }],
  };
  const { main, requests } = await setup(t, '#/community/shop', url => url.endsWith('/shop') ? response(merchandise) : null);
  const details = main.querySelector('[data-shop-description="card-makeup"]');
  assert.ok(details);
  details.querySelector('summary').click();
  assert.equal(details.open, true);
  main.querySelector('[data-action="community-redeem"]').click();
  assert.ok(main.querySelector('form[data-community-form="redeem"]'));
  assert.equal(main.querySelector('[data-shop-description="card-makeup"]').open, true);
  main.querySelector('[data-action="community-redeem-cancel"]').click();
  assert.equal(main.querySelector('form[data-community-form="redeem"]'), null);
  assert.equal(main.querySelector('[data-shop-description="card-makeup"]').open, true);
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
  for (let attempt = 0; attempt < 10 && !main.querySelector('#reply-r3'); attempt++) await turn();
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
  const results = main.querySelector('.community-results'), topics = main.querySelector('.community-topics');
  const field = main.querySelector('#community-search');
  const button = main.querySelector('[data-action="community-sort"][data-sort="newest"]');
  button.focus(); button.click();
  assert.equal(main.querySelector('.community-topics'), topics, 'pending sort must not replace a long list with a short loading placeholder');
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
  const section = main.querySelector('[data-community]'), topics = main.querySelector('.community-topics');
  const rows = [...topics.children];
  const button = main.querySelector('[data-action="community-more"]');
  button.focus(); button.click();
  assert.equal(main.querySelector('[data-community]'), section);
  assert.equal(button.disabled, true);
  assert.deepEqual([...topics.children], rows);
  pending.resolve(response(listing(['p3', 'p4'])));
  await turn();
  assert.equal(main.querySelector('.community-topics'), topics);
  assert.deepEqual([...topics.children].slice(0, 2), rows);
  assert.equal(topics.children.length, 4);
});

test('search retains typed input, focus and old rows until the replacement result arrives', async t => {
  const pending = deferred();
  const { main, w } = await setup(t, '#/community/home', url => url.includes('q=needle') ? pending.promise : null);
  const field = main.querySelector('#community-search'), rows = main.querySelector('.community-topics');
  field.value = 'needle'; field.focus(); field.setSelectionRange(2, 4);
  field.form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(main.querySelector('.community-topics'), rows);
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
    if (url.includes('sort=hot')) return second.promise;
    return null;
  });
  const rows = main.querySelector('.community-topics');
  for (const sort of ['newest', 'hot', 'newest']) main.querySelector(`[data-action="community-sort"][data-sort="${sort}"]`).click();
  first.resolve(response(listing(['old']))); await turn();
  assert.equal(main.querySelector('.community-topics'), rows);
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
