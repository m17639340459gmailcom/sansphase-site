import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const denied = status => ({ ok: false, status, json: async () => ({ error: '拒绝访问' }) });
const reader = { name: '读者', uid: '10001', role: 'reader', owner: false, vip: true, agreed: true, unread: { all: 0 }, balance: 0, checkedIn: true, streak: 1, nextReward: { total: 5 } };
const summary = { total: 1, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [] };
const topic = id => ({ id, board: 'qa', title: `帖子标题-${id}`, author: reader, createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T00:00:00Z', likes: 0, replies: 0 });
const thread = id => ({ topic: { ...topic(id), body: `正文-${id}`, canReply: true, images: [] }, author: reader, related: [], replies: [] });
const member = (uid, tab) => ({ person: { ...reader, name: `用户-${uid}`, uid }, bio: `签名-${uid}`, joinedAt: null, cover: null, streak: 0,
  stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: false,
  badges: [], muted: null, canMute: false, canAppoint: false, steward: false, tab, topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: null });

async function setup(t, hash = '#/post/p0') {
  const w = new JSDOM('<main></main>', { url: `http://localhost/${hash}`, pretendToBeVisual: true }).window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  w.scrollTo = () => {};
  let person = reader, unavailable = false, intercept = () => null;
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    const special = intercept(url, init); if (special) return special;
    if (url.endsWith('/me')) return response(person);
    if (url.endsWith('/summary')) return response(summary);
    if (url.startsWith('/api/community/banners')) return response({ scope: 'home', version: 1, items: [] });
    if (unavailable) throw Error('网络暂时断开');
    const post = /^\/api\/community\/topics\/([^?]+)$/.exec(url);
    if (post) return response(thread(decodeURIComponent(post[1])));
    const profile = /^\/api\/community\/members\/(\d+)\?tab=(\w+)$/.exec(url);
    if (profile) return response(member(profile[1], profile[2]));
    if (url.includes('/topics?')) {
      const params = new URL(url, 'http://localhost').searchParams, q = params.get('q') || 'empty';
      return response({ items: [topic(q)], total: 1, page: 1, pageSize: 20 });
    }
    throw Error(url);
  };
  const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'), icons: {}, members: true };
  const ui = createCommunityUI({ request }), main = w.document.querySelector('main'); main.innerHTML = ui.html(common);
  let cleanup = ui.mount(main, common);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  const mount = async hash => { w.history.replaceState(null, '', hash); cleanup(); main.innerHTML = ui.html(common); cleanup = ui.mount(main, common); await flush(); };
  const search = async q => {
    const form = main.querySelector('[data-community-form="search"]'); assert.ok(form);
    form.elements.namedItem('q').value = q; form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await flush();
  };
  await flush();
  return { w, main, ui, calls, mount, search, offline: value => { unavailable = value; }, identity: value => { person = value; }, intercept: value => { intercept = value; } };
}

test('navigation retains recent post DTOs after fresh identity but evicts the oldest beyond 24', async t => {
  const { main, mount, offline, calls } = await setup(t);
  for (let i = 1; i <= 24; i++) await mount(`#/post/p${i}`);
  offline(true);
  await mount('#/post/p23'); assert.match(main.textContent, /正文-p23/);
  await mount('#/post/p0'); assert.doesNotMatch(main.textContent, /正文-p0/);
  assert.ok(main.querySelector('[data-content-state="error"]'));
  assert.equal(calls.filter(call => call.url.endsWith('/me')).length, 27, 'cache reuse still reads fresh identity on every entrance');
});

test('member page history is bounded to 48 DTOs without changing recent cached profiles', async t => {
  const { main, mount, offline } = await setup(t, '#/community/u/20000');
  for (let i = 1; i <= 48; i++) await mount(`#/community/u/${20000 + i}`);
  offline(true);
  await mount('#/community/u/20047'); assert.match(main.textContent, /签名-20047/);
  await mount('#/community/u/20000'); assert.doesNotMatch(main.textContent, /签名-20000/);
  assert.ok(main.querySelector('[data-content-state="error"]'));
});

test('search history is bounded to 64 DTOs while current results remain readable', async t => {
  const { main, search, offline } = await setup(t, '#/community/home');
  for (let i = 1; i <= 64; i++) await search(`q${i}`);
  offline(true);
  await search('q63'); assert.match(main.textContent, /帖子标题-q63/);
  await search(''); assert.doesNotMatch(main.textContent, /帖子标题-empty/);
  assert.ok(main.querySelector('[data-content-state="error"]'));
});

test('recent cached DTOs wait for fresh identity, then cannot survive account or VIP changes', async t => {
  const f = await setup(t), identity = deferred();
  await f.mount('#/post/p1'); f.offline(true);
  f.intercept(url => url.endsWith('/me') ? identity.promise : null);
  await f.mount('#/post/p0'); assert.doesNotMatch(f.main.textContent, /正文-p0/);
  identity.resolve(response(reader)); await flush(); assert.match(f.main.textContent, /正文-p0/);
  f.intercept(() => null); f.identity({ ...reader, uid: '10002', name: '另一个读者' });
  await f.mount('#/post/p1'); assert.doesNotMatch(f.main.textContent, /正文-p1/);
  f.offline(false); await f.mount('#/post/p2'); assert.match(f.main.textContent, /正文-p2/);
  f.offline(true); f.identity({ ...reader, uid: '10002', vip: false });
  await f.mount('#/post/p3'); await f.mount('#/post/p2'); assert.doesNotMatch(f.main.textContent, /正文-p2/);
});

test('old same-resource reads cannot replace a new page after its request token has settled', async t => {
  const f = await setup(t), old = deferred(); let wait = true;
  f.intercept(url => url.endsWith('/topics/p1') && wait ? (wait = false, old.promise) : null);
  await f.mount('#/post/p1'); await f.mount('#/post/p2'); await f.mount('#/post/p1');
  assert.match(f.main.textContent, /正文-p1/);
  old.resolve(response({ ...thread('p1'), topic: { ...thread('p1').topic, body: '晚到的旧正文' } })); await flush();
  f.offline(true); await f.mount('#/post/p2'); await f.mount('#/post/p1');
  assert.match(f.main.textContent, /正文-p1/); assert.doesNotMatch(f.main.textContent, /晚到的旧正文/);
});

test('late historical reads beyond the bound cannot blank the current DTO during a later offline repaint', async t => {
  const f = await setup(t), old = Array.from({ length: 30 }, () => deferred());
  f.intercept(url => { const match = /\/topics\/old-(\d+)$/.exec(url); return match ? old[Number(match[1])].promise : null; });
  for (let i = 0; i < old.length; i++) await f.mount(`#/post/old-${i}`);
  await f.mount('#/post/current'); assert.match(f.main.textContent, /正文-current/);
  for (let i = 0; i < old.length; i++) { old[i].resolve(response(thread(`old-${i}`))); await flush(); }
  const button = f.w.document.createElement('button'); button.dataset.action = 'community-retry'; f.main.append(button);
  f.offline(true); button.click(); await flush(); assert.match(f.main.textContent, /正文-current/);
});

test('a definite new identity rejection clears retained history rather than falling back to private DTOs', async t => {
  const f = await setup(t); await f.mount('#/post/p1');
  f.intercept(url => url.endsWith('/me') ? denied(403) : null); await f.mount('#/post/p0');
  assert.equal(f.ui.me(), null); assert.doesNotMatch(f.main.textContent, /正文-p0/);
  f.intercept(() => null); f.offline(true); await f.mount('#/post/p1');
  assert.doesNotMatch(f.main.textContent, /正文-p1/);
});

test('same-account staff role, parent, delegable and capability changes retire permission DTO history', async t => {
  const f = await setup(t);
  const staff = { role: 'moderator', boards: ['qa'], permissions: ['content.inspect', 'topic.delete'], delegable: ['topic.delete'], parent: { kind: 'reader', id: 'superior' } };
  const original = { ...reader, mod: true, staffRole: 'moderator', staff, management: { role: 'moderator', browsingAsReader: false, staff } };
  const changes = [
    { staffRole: 'assistant', staff: { ...staff, role: 'assistant' } },
    { staff: { ...staff, permissions: ['content.inspect'] } },
    { staff: { ...staff, delegable: [] } },
    { staff: { ...staff, parent: { kind: 'reader', id: 'new-superior' } } },
    { management: { ...original.management, role: 'general' } },
    { management: { ...original.management, staff: { ...staff, delegable: [] } } },
  ];
  for (let index = 0; index < changes.length; index++) {
    f.offline(false); f.identity(original); await f.mount(`#/post/staff-${index}`);
    assert.match(f.main.textContent, new RegExp(`正文-staff-${index}`));
    f.identity({ ...original, ...changes[index] }); f.offline(true);
    await f.mount('#/post/uncached'); await f.mount(`#/post/staff-${index}`);
    assert.doesNotMatch(f.main.textContent, new RegExp(`正文-staff-${index}`));
    assert.equal(f.ui.me().uid, reader.uid);
  }
});
