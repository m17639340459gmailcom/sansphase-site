import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import * as communityRuntime from '../src/community-runtime-client.ts';
import { setContentHTML } from '../src/content-images.ts';
import { createStableCommunityFrame } from '../src/community-layout/stable-frame.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { communityStaffCapabilities } from '../src/community-staff.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const owner = { name: '作者', uid: 'owner', role: 'owner', owner: true, mod: true, vip: true, agreed: true,
  checkedIn: true, streak: 1, nextReward: { total: 1 }, unread: { all: 0 }, balance: 0, inventory: {}, moderationBoards: ['qa', 'tools'],
  management: { role: 'owner', browsingAsReader: false } };
const topic = { id: 'p1', board: 'qa', title: '待审核的真实内容', body: '待审正文', pending: true, pendingReason: '先审后发',
  author: owner, createdAt: '2026-10-01T10:00:00Z' };
const management = tab => ({ owner: true, tab, counts: { queue: 1, reports: 0, orders: 0, sanctions: 0 },
  kpis: { topics24h: 1, replies24h: 0 }, queue: { topics: [topic], replies: [] }, reports: [], content: [topic],
  items: [], orders: [], sanctions: [], stewards: [], data: null, profiles: [], backgrounds: [] });
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const error = status => ({ ok: false, status, json: async () => ({ error: status === 503 ? 'identity unavailable' : '权限已变化' }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setTimeout(resolve, 15));
async function until(check, reason) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() >= deadline) assert.fail(reason); await turn(); }
}

// Run the application's real replacement branch, rather than a template-only
// approximation which could pass while app.mjs still replaces the whole main.
const app = readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8');
const start = app.indexOf('  cleanCommunity();\n  const pageMarkup =');
// Include the complete readiness call, regardless of its internal arguments.
const end = app.indexOf("  cleanReaderAdmin=page==='admin'", start);
assert.ok(start > 0 && end > start, 'find the formal app cleanup/render/mount entry');
assert.match(app.slice(start, end), /communityReady\(/, 'retain the formal readiness call after mounting');
const applicationRender = new Function('main', 'views', 'communityFrame', 'communityUI', 'communityModule', 'communityContext', 'setContentHTML',
  'cleanCommunity', 'communityReady', 'communityEnabled', 'preserveScroll', `"use strict"; const page='community', contentStatus=null, readerUI=null, id='';
  ${app.slice(start, end)}
  return cleanCommunity;`);
const hashStart = app.indexOf('window.addEventListener("hashchange", (event) =>');
const updateStart = app.indexOf('  const update = () => {', hashStart), updateEnd = app.indexOf('  // Community routes swap', updateStart);
assert.ok(hashStart > 0 && updateStart > hashStart && updateEnd > updateStart, 'find the formal hashchange scroll update');
const applicationHashUpdate = new Function('render', 'preserveManagementScroll', 'communityEnabled', 'communityFrame', 'window', 'main', 'to',
  `const homeRoot=null; ${app.slice(updateStart, updateEnd)} return update();`);

async function setup(t, handle = () => null, first = '#/community/manage', width = 1600, waitForInitial = true) {
  const dom = new JSDOM('<html><body><main id="main"></main></body></html>', { url: `http://localhost/${first}`, pretendToBeVisual: true });
  const w = dom.window, scrolls = [];
  w.scrollTo = options => { scrolls.push(options); };
  Object.defineProperty(w, 'innerWidth', { configurable: true, value: width });
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement',
    'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event', 'MutationObserver'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    const supplied = handle(url, options);
    if (supplied) return supplied;
    if (url.endsWith('/me')) return response(owner);
    if (url.includes('/manage?')) return response(management(new URL(url, w.location.origin).searchParams.get('tab')));
    if (url.endsWith('/summary')) return response({ total: 1, boards: {}, hot: [] });
    if (options.method === 'POST') return response({ ok: true });
    throw new Error(`Unexpected request ${url}`);
  };
  const ui = createCommunityUI({ request }), main = w.document.getElementById('main');
  const frame = createStableCommunityFrame(w.document, w, request);
  const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    icons: {}, members: true, painted: () => {}, simpleCompose: false };
  let cleanup = () => {};
  const render = (hash, preserveScroll = false) => {
    w.history.replaceState(null, '', hash);
    // These handoff fixtures start after preparation; keep the real runtime
    // namespace present while executing the formal app cleanup/render/mount branch.
    cleanup = applicationRender(main, { community: () => ui.html(ctx) }, frame, ui, communityRuntime, () => ctx, setContentHTML, cleanup, () => {}, () => true, preserveScroll);
  };
  t.after(() => {
    w.history.replaceState(null, '', '#/home'); cleanup(); frame.dispose();
    for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
    w.close();
  });
  render(first);
  if (waitForInitial) await until(() => main.querySelector('.community-management-nav'), 'initial management becomes ready');
  return { w, main, ui, calls, render, scrolls, frame };
}

// Exercise the existing contact endpoint with actual, narrowly granted staff
// permissions; a queue mock cannot establish that this tab is independently allowed.
async function contactService(t, permissions = ['profile.avatar.advise']) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-contact-ui-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory), principal = { kind: 'owner', id: 'owner' };
  const member = id => ({ kind: 'reader', id });
  const people = new Map(['general', 'moderator', 'assistant'].map((id, index) => [id, { uid: String(10001 + index) }]));
  const all = communityStaffCapabilities.map(cap => cap.id);
  acceptCommunityConvention(store, [principal, ...[...people.keys()].map(member)]);
  store.staff.appoint(principal, member('general'), { role: 'general', boards: ['qa'], permissions: all, delegable: all });
  store.staff.appoint(member('general'), member('moderator'), { role: 'moderator', boards: ['qa'], permissions: all, delegable: all });
  const grant = caps => store.staff.appoint(member('moderator'), member('assistant'), { role: 'assistant', boards: ['qa'], permissions: caps, delegable: [] });
  grant(permissions);
  let service;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  service = createCommunityService({ store, directory, siteOrigin: origin,
    identify: async () => ({ ...member('assistant'), name: '资料协管', vip: false }),
    people: async authors => new Map(authors.flatMap(author => author.kind === 'owner'
      ? [['owner:owner', { name: '站长', uid: 'owner', active: true, vip: true, avatar: null, bio: '', joinedAt: null }]]
      : people.has(author.id) ? [[`reader:${author.id}`, { name: author.id, uid: people.get(author.id).uid, active: true, vip: false, avatar: null, bio: '', joinedAt: null }]] : [])),
  });
  t.after(async () => {
    await new Promise(done => server.close(done)); store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { grant, request: (url, options) => fetch(origin + url, options) };
}

test('cold contact entry uses its own real authorized channel without requiring content inspection', async t => {
  const service = await contactService(t);
  assert.equal((await service.request('/api/community/manage?tab=queue')).status, 403);
  const allowed = await service.request('/api/community/manage?tab=contact');
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).allowedTabs, ['contact', 'profiles']);
  const { main, calls, ui } = await setup(t, service.request, '#/community/manage/contact');
  await until(() => main.querySelector('[data-community-form="moderation-contact"]'), 'contact form reads its authorized channel');
  assert.ok(calls.some(call => call.url.includes('/manage?tab=contact')));
  assert.equal(calls.some(call => call.url.includes('/manage?tab=queue')), false);
  assert.equal(main.querySelector('[data-content-state="forbidden"]'), null);
  assert.deepEqual(ui.me().staff.permissions, ['profile.avatar.advise']);
});

test('profile-only staff hand off profiles to contact only after its fresh identity and contact read', async t => {
  const service = await contactService(t), identity = deferred(), content = deferred(); let hold = false;
  const { main, calls, render } = await setup(t, (url, options) => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=contact')) return content.promise.then(() => service.request(url, options));
    return service.request(url, options);
  }, '#/community/manage/profiles');
  await until(() => main.querySelector('[data-community="manage"][data-tab="profiles"]')?.querySelector('.community-management-body'), 'profile channel is ready');
  const sidebar = main.querySelector('.community-management-nav'), source = main.querySelector('.community-management-content');
  const identityReads = calls.filter(call => call.url.endsWith('/me')).length;
  hold = true; render('#/community/manage/contact'); await turn();
  assert.equal(main.querySelector('.community-management-nav'), sidebar);
  assert.equal(main.querySelector('.community-management-content'), source);
  assert.ok(source.closest('[inert]'));
  assert.equal(calls.filter(call => call.url.endsWith('/me')).length, identityReads + 1);
  content.resolve(); await turn();
  assert.equal(main.querySelector('[data-community-form="moderation-contact"]'), null, 'contact cannot activate before fresh identity');
  identity.resolve(await service.request('/api/community/me'));
  await until(() => main.querySelector('[data-community-form="moderation-contact"]'), 'fresh contact target completes');
  assert.equal(main.querySelector('.community-management-nav'), sidebar);
  assert.equal(source.isConnected, false);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.equal(calls.some(call => call.url.includes('/manage?tab=queue')), false);
});

test('same-account removal of content inspection retires old management DTOs while contact remains usable', async t => {
  const service = await contactService(t, ['content.inspect', 'profile.avatar.advise']), content = deferred(); let hold = false;
  const { main, ui, calls, render } = await setup(t, (url, options) => hold && url.includes('/manage?tab=contact') ? content.promise.then(() => service.request(url, options)) : service.request(url, options), '#/community/manage/profiles');
  await until(() => main.querySelector('[data-community="manage"][data-tab="profiles"]')?.querySelector('.community-management-body'), 'initial profile channel is ready');
  const source = main.querySelector('.community-management-content'), uid = ui.me().uid;
  service.grant(['profile.avatar.advise']); hold = true; render('#/community/manage/contact');
  await until(() => !source.isConnected, 'changed capability immediately retires the old management source');
  assert.equal(ui.me().uid, uid);
  assert.deepEqual(ui.me().staff.permissions, ['profile.avatar.advise']);
  assert.equal(main.querySelector('[data-community-form="moderation-contact"]'), null);
  content.resolve();
  await until(() => main.querySelector('[data-community-form="moderation-contact"]'), 'contact opens without the revoked inspection capability');
  assert.equal(main.querySelector('[data-content-state="forbidden"]'), null);
  assert.equal(calls.some(call => call.url.includes('/manage?tab=queue')), false);
});

test('cold management entry displays only a loading state until its own identity and data confirm access', async t => {
  const identity = deferred(), content = deferred();
  const { main } = await setup(t, url => url.endsWith('/me') ? identity.promise : url.includes('/manage?') ? content.promise : null,
    '#/community/manage', 1600, false);
  assert.ok(main.querySelector('.community-status[aria-busy="true"]'));
  assert.equal(main.querySelector('.community-management-nav'), null);
  assert.ok(main.querySelector('.community-management-page > .community-management-content'), 'cold loading must already reserve the real workspace columns');
  assert.ok(main.querySelector('.community-management-placeholder[aria-hidden="true"]'), 'reserve only geometry, without exposing stale role navigation');
  content.resolve(response(management('queue'))); await turn();
  assert.equal(main.querySelector('[data-action="community-approve"]'), null);
  identity.resolve(response(owner)); await until(() => main.querySelector('[data-action="community-approve"]'), 'cold entry completes');
});

for (const width of [1600, 390]) for (const first of ['identity', 'content']) test(`real management navigation keeps its sidebar and old content until both fresh reads finish (${width}px, ${first} first)`, async t => {
  let navigating = false;
  const identity = deferred(), content = deferred();
  const { w, main, calls, render } = await setup(t, url => {
    if (navigating && url.endsWith('/me')) return identity.promise;
    if (navigating && url.includes('/manage?tab=items')) return content.promise;
    return null;
  }, '#/community/manage', width);
  const shell = main.querySelector('[data-community="manage"]'), sidebar = main.querySelector('.community-management-nav');
  const body = main.querySelector('.community-management-content'), approve = body.querySelector('[data-action="community-approve"]');
  const link = sidebar.querySelector('a[href="#/community/manage/items"]');
  const identities = calls.filter(call => call.url.endsWith('/me')).length;
  approve.focus(); navigating = true; render('#/community/manage/items'); await turn();
  assert.equal(main.querySelector('[data-community="manage"]'), shell);
  assert.equal(main.querySelector('.community-management-nav'), sidebar);
  assert.equal(main.querySelector('.community-management-content'), body);
  assert.equal(body.hasAttribute('inert'), true);
  assert.equal(body.getAttribute('aria-busy'), 'true');
  assert.equal(sidebar.closest('[inert]'), null, 'management navigation remains usable');
  assert.notEqual(w.document.activeElement, approve, 'old business control loses keyboard focus');
  assert.equal(main.querySelector('.community-status'), null, 'no replacement loading page');
  assert.equal(calls.filter(call => call.url.endsWith('/me')).length, identities + 1, 'every subnavigation checks authority again');
  const writes = calls.filter(call => call.options.method === 'POST').length;
  approve.click(); await turn();
  assert.equal(calls.filter(call => call.options.method === 'POST').length, writes, 'old approvals cannot execute while waiting');
  let blocked = null;
  const observe = event => { if (event.target === link) { blocked = event.defaultPrevented; event.preventDefault(); } };
  w.document.addEventListener('click', observe);
  link.dispatchEvent(new w.MouseEvent('click', { button: 0, bubbles: true, cancelable: true }));
  w.document.removeEventListener('click', observe); assert.equal(blocked, false);
  const keyboardNavigation = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  link.dispatchEvent(keyboardNavigation); assert.equal(keyboardNavigation.defaultPrevented, false, 'sidebar keyboard navigation remains enabled');
  link.focus();
  (first === 'identity' ? identity : content).resolve(response(first === 'identity' ? owner : management('items'))); await turn();
  assert.equal(main.querySelector('.community-management-content'), body, 'one finished read cannot release the target');
  (first === 'identity' ? content : identity).resolve(response(first === 'identity' ? management('items') : owner));
  await until(() => main.querySelector('[data-action="community-item-edit"]'), 'target items becomes ready');
  assert.equal(main.querySelector('[data-community="manage"]'), shell);
  assert.equal(main.querySelector('.community-management-nav'), sidebar);
  assert.equal(main.querySelector('a[href="#/community/manage/items"]'), link, 'retain the actual navigation link at commit');
  assert.equal(w.document.activeElement, link, 'committing the new content does not discard sidebar focus');
  assert.equal(link.getAttribute('aria-current'), 'page');
  assert.equal(body.isConnected, false);
  assert.equal(main.querySelector('.community-management-content').hasAttribute('inert'), false);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
});

test('even a previously loaded management target waits for its own new authority and data', async t => {
  let hold = false;
  const identity = deferred(), content = deferred();
  const { main, calls, render } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=queue')) return content.promise;
    return null;
  });
  render('#/community/manage/items'); await until(() => main.querySelector('[data-action="community-item-edit"]'), 'first items read');
  const items = main.querySelector('.community-management-content'), count = calls.filter(call => call.url.endsWith('/me')).length;
  hold = true; render('#/community/manage'); await turn();
  assert.equal(main.querySelector('.community-management-content'), items);
  assert.equal(calls.filter(call => call.url.endsWith('/me')).length, count + 1);
  content.resolve(response(management('queue'))); await turn();
  assert.equal(main.querySelector('[data-action="community-approve"]'), null, 'cached queue is not activated before fresh identity');
  identity.resolve(response(owner)); await until(() => main.querySelector('[data-action="community-approve"]'), 'fresh queue commit');
});

for (const status of [401, 403, 503]) test(`a management handoff retires old data on me ${status} and uses the real error actions`, async t => {
  let hold = false;
  const identity = deferred(), content = deferred();
  const { main, ui, render } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=items')) return content.promise;
    return null;
  });
  const old = main.querySelector('.community-management-content');
  hold = true; render('#/community/manage/items'); identity.resolve(error(status));
  await until(() => main.querySelector(`[data-content-state="${status === 401 ? 'auth' : status === 403 ? 'forbidden' : 'error'}"]`), 'actual identity error');
  assert.equal(old.isConnected, false); assert.equal(main.querySelector('.community-management-nav'), null);
  assert.equal(main.querySelector('[data-action="community-approve"]'), null);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  content.resolve(response(management('items'))); await turn();
  assert.equal(main.querySelector('[data-action="community-item-edit"]'), null, 'late management result cannot revive controls');
  if (status === 503) {
    assert.equal(ui.me().uid, owner.uid, 'service failure is not logout');
    assert.doesNotMatch(main.textContent, /社区尚未开放/);
    hold = false; main.querySelector('[data-action="community-retry"]').click();
    await until(() => main.querySelector('[data-action="community-item-edit"]'), 'the displayed retry actually recovers');
  }
});

test('quick A to B to A uses the latest authority and core rather than older ready results', async t => {
  let hold = false, meIndex = 0;
  const identities = [deferred(), deferred()], item = deferred(), queue = deferred();
  const { main, ui, render } = await setup(t, url => {
    if (!hold) return null;
    if (url.endsWith('/me')) return identities[meIndex++].promise;
    if (url.includes('/manage?tab=items')) return item.promise;
    if (url.includes('/manage?tab=queue')) return queue.promise;
    return null;
  });
  const shell = main.querySelector('[data-community="manage"]');
  hold = true; render('#/community/manage/items'); render('#/community/manage');
  identities[0].resolve(response({ ...owner, uid: 'wrong-account' })); item.resolve(response(management('items'))); await turn();
  assert.equal(ui.me().uid, owner.uid); assert.equal(main.querySelector('[data-community="manage"]'), shell);
  assert.equal(main.querySelector('[data-community-pending-route]')?.dataset.communityPendingRoute, 'true');
  identities[1].resolve(response(owner)); queue.resolve(response({ ...management('queue'), queue: { topics: [{ ...topic, title: '最新审核内容' }], replies: [] } }));
  await until(() => main.textContent.includes('最新审核内容'), 'latest target commits');
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.equal(main.querySelector('[data-action="community-item-edit"]'), null);
});

test('an older successful management identity cannot revive the source after the latest request rejects access', async t => {
  let hold = false, meIndex = 0;
  const identities = [deferred(), deferred()], item = deferred(), queue = deferred();
  const { main, render } = await setup(t, url => {
    if (!hold) return null;
    if (url.endsWith('/me')) return identities[meIndex++].promise;
    if (url.includes('/manage?tab=items')) return item.promise;
    if (url.includes('/manage?tab=queue')) return queue.promise;
    return null;
  });
  hold = true; render('#/community/manage/items'); render('#/community/manage'); identities[1].resolve(error(403));
  await until(() => main.querySelector('[data-content-state="forbidden"]'), 'latest authority rejection');
  identities[0].resolve(response(owner)); item.resolve(response(management('items'))); queue.resolve(response(management('queue'))); await turn();
  assert.ok(main.querySelector('[data-content-state="forbidden"]'));
  assert.equal(main.querySelector('.community-management-nav'), null);
  assert.equal(main.querySelector('[data-action="community-approve"]'), null);
});

test('a fresh target management rejection replaces its old protected data without losing verified navigation', async t => {
  let hold = false;
  const identity = deferred(), content = deferred();
  const { main, render } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=content')) return content.promise;
    return null;
  });
  const sidebar = main.querySelector('.community-management-nav'), old = main.querySelector('.community-management-content');
  hold = true; render('#/community/manage/content'); identity.resolve(response(owner)); content.resolve(error(403));
  await until(() => main.querySelector('[data-content-state="forbidden"]'), 'target access rejection is displayed');
  assert.equal(old.isConnected, false); assert.equal(main.querySelector('.community-management-nav'), sidebar);
  assert.equal(main.querySelector('[data-action="community-approve"]'), null);
  assert.equal(main.querySelector('[data-action="community-queue-delete"]'), null);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
});

test('same moderator losing an assigned board retires the old scope before the new scoped core returns', async t => {
  let hold = false, reads = 0;
  const moderator = { ...owner, uid: 'moderator', role: 'reader', owner: false, moderationBoards: ['qa', 'tools'], management: { role: 'steward', browsingAsReader: false } };
  const scoped = { ...moderator, moderationBoards: ['tools'] }, identity = deferred(), content = deferred();
  const { main, ui, render } = await setup(t, url => {
    if (url.endsWith('/me')) return hold ? reads++ === 0 ? identity.promise : response(scoped) : response(moderator);
    if (hold && url.includes('/manage?tab=content')) return content.promise;
    if (url.includes('/manage?')) return response({ ...management('queue'), owner: false, moderationBoards: moderator.moderationBoards });
    return null;
  });
  const old = main.querySelector('.community-management-content'); hold = true; render('#/community/manage/content'); identity.resolve(response(scoped));
  await until(() => !old.isConnected, 'old board scope is retired as soon as fresh identity narrows it');
  assert.equal(main.querySelector('[data-action="community-approve"]'), null);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.deepEqual(ui.me().moderationBoards, ['tools']);
  content.resolve(response({ ...management('content'), owner: false, moderationBoards: ['tools'], queue: { topics: [], replies: [] }, content: [] }));
  await until(() => main.querySelector('.community-management-nav'), 'new scoped management returns');
  assert.equal(main.textContent.includes(topic.title), false);
});

test('banner drafts stay account and scope owned through a management handoff and old pending input is ignored', async t => {
  let hold = false;
  const identity = deferred(), content = deferred(), config = { scope: 'home', version: 1,
    items: [{ topicId: 'p1', board: 'qa', title: '原展示标题', topicTitle: '原帖', cover: null, image: null }] };
  const { w, main, render } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=items')) return content.promise;
    if (url.includes('/manage?tab=banners')) return response({ ...management('banners'), banners: [config] });
    if (url.includes('/topics?')) return response({ items: [], total: 0, page: 1, pageSize: 20 });
    return null;
  }, '#/community/manage/banners');
  const title = main.querySelector('input[name="banner-title-0"]'); title.value = '独立保存的本地草稿';
  title.dispatchEvent(new w.Event('input', { bubbles: true }));
  hold = true; render('#/community/manage/items');
  assert.equal(title.isConnected, true); assert.ok(title.closest('[inert]'));
  title.value = '待交接旧页面不应写入'; title.dispatchEvent(new w.Event('input', { bubbles: true }));
  identity.resolve(response(owner)); content.resolve(response(management('items')));
  await until(() => main.querySelector('[data-action="community-item-edit"]'), 'leave banners');
  hold = false; render('#/community/manage/banners');
  await until(() => main.querySelector('input[name="banner-title-0"]'), 'return to banners after fresh authority');
  assert.equal(main.querySelector('input[name="banner-title-0"]').value, '独立保存的本地草稿');
});

test('a write already submitted on the source can finish without trapping the target handoff or submitting it twice', async t => {
  const write = deferred(), identity = deferred(), content = deferred(); let hold = false, identities = 0, targets = 0;
  const { main, calls, render } = await setup(t, (url, options) => {
    if (url.endsWith('/topics/p1/approve') && options.method === 'POST') return write.promise;
    if (hold && url.endsWith('/me') && identities++ === 0) return identity.promise;
    if (hold && url.includes('/manage?tab=items') && targets++ === 0) return content.promise;
    return null;
  });
  const approve = main.querySelector('[data-action="community-approve"]'); approve.click();
  await until(() => calls.some(call => call.url.endsWith('/topics/p1/approve')), 'source approval reaches its existing endpoint');
  assert.equal(approve.disabled, true);
  hold = true; render('#/community/manage/items'); approve.click();
  write.resolve(response({ ok: true }));
  await until(() => main.querySelector('[data-action="community-item-edit"]'), 'write-triggered refresh completes the new route gate');
  assert.equal(calls.filter(call => call.url.endsWith('/topics/p1/approve')).length, 1);
  identity.resolve(response(owner)); content.resolve(response(management('items'))); await turn();
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
});

for (const preserveScroll of [false, true]) test(`management resets reading position only at commit and honors the existing task-switch preserveScroll=${preserveScroll}`, async t => {
  let hold = false;
  const identity = deferred(), content = deferred();
  const { w, main, scrolls, render, frame } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=reports')) return content.promise;
    return null;
  });
  scrolls.length = 0; hold = true;
  applicationHashUpdate(options => render('#/community/manage/reports', Boolean(options?.preserveScroll)), preserveScroll, () => true, frame, w, main, 'community');
  await turn();
  assert.equal(scrolls.length, 0, 'waiting does not jump the retained workspace');
  identity.resolve(response(owner)); content.resolve(response(management('reports')));
  await until(() => !main.querySelector('[data-community-pending-route]'), 'task target finishes');
  assert.equal(scrolls.length, preserveScroll ? 0 : 1);
  if (!preserveScroll) assert.deepEqual(scrolls[0], { top: 0, behavior: 'instant' });
});

for (const kind of ['reject', 'delete']) test(`a retained ${kind} dialog cannot submit, close, trap navigation or operate on the target route`, async t => {
  let hold = false;
  const identity = deferred(), content = deferred();
  const { w, main, calls, render } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=items')) return content.promise;
    return null;
  }, kind === 'delete' ? '#/community/manage/content' : '#/community/manage');
  main.querySelector(`[data-action="${kind === 'delete' ? 'community-queue-delete' : 'community-reject'}"]`).click();
  const form = main.querySelector(`[data-community-form="${kind}"]`);
  assert.ok(form.closest('[role="dialog"]'));
  if (kind === 'delete') form.elements.namedItem('reason').value = '明确的删除理由';
  else form.querySelector('input[name="reason"]').checked = true;
  const writes = calls.filter(call => call.options.method === 'POST').length;
  hold = true; render('#/community/manage/items');
  assert.equal(form.isConnected, true); assert.ok(form.closest('[inert]'));
  const escape = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); form.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true); assert.equal(form.isConnected, true);
  const submit = new w.Event('submit', { bubbles: true, cancelable: true }); form.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  const sidebar = main.querySelector('.community-management-nav'), link = sidebar.querySelector('a[href="#/community/manage/items"]');
  assert.equal(sidebar.closest('[inert]'), null);
  let prevented = null;
  const observe = event => { if (event.target === link) { prevented = event.defaultPrevented; event.preventDefault(); } };
  w.document.addEventListener('click', observe); link.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  w.document.removeEventListener('click', observe); assert.equal(prevented, false);
  await turn(); assert.equal(calls.filter(call => call.options.method === 'POST').length, writes);
  identity.resolve(response(owner)); content.resolve(response(management('items')));
  await until(() => main.querySelector('[data-action="community-item-edit"]'), 'the target commits without the old dialog');
  assert.equal(form.isConnected, false); assert.equal(main.querySelector('[role="dialog"]'), null);
});

for (const outcome of ['complete', 'rejected']) test(`an already started banner upload remains owned by its original draft during a management handoff (${outcome})`, async t => {
  let hold = false;
  const identity = deferred(), content = deferred(), upload = deferred(), image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const config = { scope: 'home', version: 1, items: [] };
  const { w, main, calls, render } = await setup(t, (url, options) => {
    if (url.includes('/manage/banner-image?') && options.method === 'POST') return upload.promise;
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=items')) return content.promise;
    if (url.includes('/manage?tab=banners')) return response({ ...management('banners'), banners: [config] });
    if (url.includes('/topics?')) return response({ items: [], total: 0, page: 1, pageSize: 20 });
    return null;
  }, '#/community/manage/banners');
  main.querySelector('[data-action="community-banner-add-image"]').click();
  const file = new File(['image'], 'banner.webp', { type: 'image/webp' }), selected = main.querySelector('[data-banner-file]');
  Object.defineProperty(selected, 'files', { value: [file] }); selected.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => calls.some(call => call.url.includes('/manage/banner-image?')), 'the original upload reaches the existing endpoint');
  const field = main.querySelector('[data-banner-file]'), form = field.form;
  hold = true; render('#/community/manage/items'); assert.ok(field.closest('[inert]'));
  Object.defineProperty(field, 'files', { value: [file] }); field.dispatchEvent(new w.Event('change', { bubbles: true }));
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const drop = new w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file], dropEffect: 'none' } }); field.dispatchEvent(drop);
  if (outcome === 'rejected') { identity.resolve(error(403)); await until(() => main.querySelector('[data-content-state="forbidden"]'), 'new authority rejects management'); }
  upload.resolve(response({ id: image })); await turn();
  assert.equal(calls.filter(call => call.url.includes('/manage/banner-image?')).length, 1);
  assert.equal(calls.some(call => call.url.endsWith('/manage/banners') && call.options.method === 'POST'), false);
  if (outcome === 'complete') {
    assert.equal(main.querySelector('[data-banner-preview-image]'), null, 'the late callback cannot redraw the held source over the pending target');
    identity.resolve(response(owner)); content.resolve(response(management('items')));
    await until(() => main.querySelector('[data-action="community-item-edit"]'), 'items target completes');
    assert.equal(main.querySelector('[data-banner-preview-image]'), null);
    hold = false; render('#/community/manage/banners');
    await until(() => main.querySelector('[data-banner-preview-image]'), 'the uploaded result remains in its original owned banner draft');
    assert.equal(main.querySelector('[data-banner-preview-image]').getAttribute('src'), `/api/community/images/${image}.webp`);
  } else {
    content.resolve(response(management('items'))); await turn();
    assert.ok(main.querySelector('[data-content-state="forbidden"]'));
    assert.equal(main.querySelector('[data-banner-preview-image]'), null);
    assert.equal(main.querySelector('[data-action="community-item-edit"]'), null);
  }
});

test('old management forms, file selection and drop cannot write during navigation', async t => {
  let hold = false;
  const identity = deferred(), content = deferred();
  const { w, main, calls, render } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identity.promise;
    if (hold && url.includes('/manage?tab=content')) return content.promise;
    return null;
  }, '#/community/manage/items');
  main.querySelector('[data-action="community-item-edit"]').click();
  const form = main.querySelector('[data-community-form="item"]'), field = form.querySelector('[data-community-item-upload]');
  const file = new File(['image'], 'test.webp', { type: 'image/webp' });
  hold = true; render('#/community/manage/content'); await turn();
  assert.equal(form.isConnected, true); assert.ok(form.closest('[inert]'));
  const writes = calls.filter(call => call.options.method === 'POST').length;
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  Object.defineProperty(field, 'files', { value: [file] }); field.dispatchEvent(new w.Event('change', { bubbles: true }));
  const drop = new w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file], dropEffect: 'none' } }); form.dispatchEvent(drop);
  await turn(); assert.equal(calls.filter(call => call.options.method === 'POST').length, writes);
  identity.resolve(response(owner)); content.resolve(response(management('content')));
  await until(() => main.querySelector('[data-action="community-queue-delete"]'), 'content target completes');
  assert.equal(form.isConnected, false, 'a completed route handoff retires the old form');
});

for (const kind of ['account', 'permission']) test(`${kind} change immediately retires the management source before pending core can finish`, async t => {
  let hold = false;
  const next = kind === 'account' ? { ...owner, uid: 'other-owner' } : { ...owner, owner: false, mod: false, management: null };
  const identity = deferred(), content = deferred(); let identityReads = 0;
  const { main, ui, render } = await setup(t, url => {
    if (hold && url.endsWith('/me')) return identityReads++ === 0 ? identity.promise : response(next);
    if (hold && url.includes('/manage?tab=items')) return content.promise;
    return null;
  });
  const old = main.querySelector('.community-management-content'); hold = true; render('#/community/manage/items'); identity.resolve(response(next));
  await until(() => !old.isConnected, 'old privileged source retires on changed identity');
  await until(() => ui.me()?.uid === next.uid, 'the changed authority is processed');
  assert.equal(main.querySelector('[data-action="community-approve"]'), null);
  assert.equal(main.querySelector('[data-community-pending-route]'), null);
  assert.equal(ui.me().uid, next.uid);
  if (kind === 'permission') assert.ok(main.querySelector('[data-content-state="forbidden"]'));
  content.resolve(response(management('items'))); await turn();
  if (kind === 'permission') assert.equal(main.querySelector('[data-action="community-item-edit"]'), null);
});
