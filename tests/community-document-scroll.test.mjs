import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const viewer = { name: '测试管理者', uid: 'owner', role: 'owner', owner: true, mod: true, management: { role: 'owner', browsingAsReader: false }, unread: { all: 0 }, agreed: true };
const topic = (id, board = 'qa') => ({ id, board, title: `帖子 ${id}`, author: viewer, createdAt: '2026-10-05T00:00:00Z', lastActivityAt: '2026-10-05T00:00:00Z', replies: 0, pending: true, body: '测试正文' });
const response = data => ({ ok: true, json: async () => structuredClone(data) });
const config = scope => ({ scope, version: 1, items: [] });
const data = { owner: true, tab: 'banners', banners: [config('home'), config('qa'), config('tools')], counts: { queue: 20, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 0, replies24h: 0 }, queue: { topics: Array.from({ length: 20 }, (_, index) => topic(`p${index}`, index % 2 ? 'tools' : 'qa')), replies: [] }, reports: [], orders: [], items: [], sanctions: [] };

async function setup(t, hash, handle = () => null, identity = viewer, ctxOptions = {}) {
  const dom = new JSDOM('<main></main>', { url: `http://localhost/${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const main = w.document.querySelector('main');
  let top = 0;
  let forcedHeight = null;
  let nativeShift = 0;
  const naturalHeight = () => {
    if (forcedHeight !== null) return forcedHeight;
    const section = main.querySelector('[data-community]');
    if (section?.querySelector('.community-banner-candidate-list')) return 2600;
    if (section?.querySelector('.community-banner-candidate-status')) return 620;
    const rows = section?.querySelectorAll('.community-queue-item').length || 0;
    return rows ? 600 + rows * 120 : 620;
  };
  const height = () => Math.max(naturalHeight(), parseFloat(main.querySelector('[data-community]')?.style.minHeight || '0'));
  const maxScroll = () => Math.max(0, height() + 70 - w.innerHeight);
  Object.defineProperty(w, 'scrollY', { get: () => { top = Math.min(top, maxScroll()); return top; } });
  const scrolls = [];
  const focusCalls = [];
  const originalFocus = w.HTMLElement.prototype.focus;
  w.HTMLElement.prototype.focus = function(options) { focusCalls.push({ control: this, options }); originalFocus.call(this, options); };
  w.scrollTo = value => { scrolls.push(value); top = Math.max(0, Math.min(value.top ?? top, maxScroll())); };
  Object.defineProperty(w.HTMLElement.prototype, 'getBoundingClientRect', { value() {
    const ownHeight = this.hasAttribute('data-community') ? Math.max(naturalHeight(), parseFloat(this.style.minHeight || '0')) : 36;
    const y = this.hasAttribute('data-community') ? 70 - top : 580 - top;
    return { top: y, bottom: y + ownHeight, left: 0, right: 1000, width: 1000, height: ownHeight, x: 0, y, toJSON() {} };
  } });
  const replace = w.Element.prototype.replaceWith;
  Object.defineProperty(w.Element.prototype, 'replaceWith', { value(...nodes) {
    replace.apply(this, nodes);
    // Model the real browser: a shorter document clamps both native scroll and scrollTo.
    if (this.hasAttribute?.('data-community')) top = Math.min(top, maxScroll());
    if (this.hasAttribute?.('data-community') && nativeShift) { top += nativeShift; nativeShift = 0; }
  } });
  const frames = new Map(); let frameId = 0;
  w.requestAnimationFrame = callback => { const id = ++frameId; frames.set(id, callback); return id; };
  w.cancelAnimationFrame = id => frames.delete(id);
  const flushFrames = () => { const next = [...frames.values()]; frames.clear(); next.forEach(callback => callback(0)); };
  const request = async (url, init = {}) => {
    const supplied = handle(url, init); if (supplied) return supplied;
    if (url.endsWith('/me')) return response(identity);
    if (url.includes('/manage?')) return response({ ...data, owner: Boolean(identity.owner), moderationBoards: identity.owner ? undefined : ['qa', 'tools'] });
    if (url.includes('/topics?')) return response({ items: Array.from({ length: 20 }, (_, index) => ({ ...topic(`c${index}`, new URL(url, w.location.href).searchParams.get('board') || 'qa'), pending: false })), total: 20, page: 1, pageSize: 20 });
    throw Error(url);
  };
  const ctx = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, ...ctxOptions };
  const ui = createCommunityUI({ request }); main.innerHTML = ui.html(ctx); const cleanup = ui.mount(main, ctx);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  await turn(); await turn(); flushFrames();
  return { main, w, ui, top: () => w.scrollY, setTop: value => { top = value; }, scrolls, focusCalls, frames, flushFrames, setHeight: value => { forcedHeight = value; }, maxScroll, shiftOnReplacement: value => { nativeShift = value; } };
}

test('a rebuilt focused scope does not turn a native layout shift into a different reading position', async t => {
  const { main, top, setTop, shiftOnReplacement, flushFrames } = await setup(t, '#/community/manage/banners');
  setTop(520);
  const scope = main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]');
  scope.focus({ preventScroll: true });
  shiftOnReplacement(60);
  scope.click();
  assert.equal(top(), 520, 'restore the viewport, not the changed geometry of a replaced button');
  await turn(); flushFrames(); assert.equal(top(), 520);
});

test('banner scope loading cannot clamp document reading position before its new candidates arrive', async t => {
  const pending = deferred(); let delay = true;
  const { main, w, top, setTop, flushFrames, focusCalls } = await setup(t, '#/community/manage/banners', url => delay && url.includes('topics?') && url.includes('board=qa') ? pending.promise : null);
  setTop(520);
  const scope = main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]'); scope.focus({ preventScroll: true }); scope.click();
  assert.equal(top(), 520, 'a loading placeholder must retain the document height needed by the current viewport');
  assert.equal(main.querySelector('.community-banner-candidates').getAttribute('aria-busy'), 'true');
  delay = false;
  pending.resolve(response({ items: Array.from({ length: 20 }, (_, index) => ({ ...topic(`qa${index}`), pending: false })), total: 20, page: 1, pageSize: 20 }));
  await turn(); flushFrames();
  assert.equal(top(), 520);
  assert.equal(main.querySelector('[data-community]').style.minHeight, '', 'completed content must not retain an oversized blank floor');
  assert.equal(w.document.activeElement.dataset.scope, 'qa');
  const restoredFocus = focusCalls.filter(call => call.control.dataset.scope === 'qa' && call.control !== scope);
  assert.ok(restoredFocus.length > 0);
  assert.ok(restoredFocus.every(call => call.options?.preventScroll), 'focus restoration must never scroll a rebuilt control into view');
});

test('rapid scope switches retain reading position and an older response cannot release the active loading guard', async t => {
  const qa = deferred(), tools = deferred();
  const { main, top, setTop, flushFrames } = await setup(t, '#/community/manage/banners', url => {
    if (!url.includes('topics?')) return null;
    if (url.includes('board=qa')) return qa.promise;
    if (url.includes('board=tools')) return tools.promise;
    return null;
  });
  setTop(520);
  main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]').click();
  main.querySelector('[data-action="community-banner-scope"][data-scope="tools"]').click();
  qa.resolve(response({ items: [], total: 0, page: 1, pageSize: 20 })); await turn(); flushFrames();
  assert.equal(top(), 520);
  assert.equal(main.querySelector('.community-banner-candidates').getAttribute('aria-busy'), 'true');
  assert.equal(main.querySelector('[data-action="community-banner-scope"][aria-pressed="true"]').dataset.scope, 'tools');
  tools.resolve(response({ items: Array.from({ length: 20 }, (_, index) => ({ ...topic(`tools${index}`, 'tools'), pending: false })), total: 20, page: 1, pageSize: 20 }));
  await turn(); flushFrames(); assert.equal(top(), 520); assert.equal(main.querySelector('[data-community]').style.minHeight, '');
});

test('an existing reading frame keeps ownership of scroll restoration without a competing document height guard', async t => {
  let restores = 0;
  const { main, scrolls, flushFrames } = await setup(t, '#/community/manage/banners', () => null, viewer, { beforePaint: () => () => { restores++; } });
  const before = restores;
  main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]').click(); await turn(); flushFrames();
  assert.ok(restores > before);
  assert.equal(main.querySelector('[data-community]').style.minHeight, '');
  assert.equal(scrolls.length, 0);
});

test('user scrolling during a banner request takes precedence over the earlier saved position', async t => {
  const pending = deferred();
  const { main, w, top, setTop, flushFrames } = await setup(t, '#/community/manage/banners', url => url.includes('topics?') && url.includes('board=qa') ? pending.promise : null);
  setTop(520); main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]').click();
  setTop(280); w.dispatchEvent(new w.Event('scroll'));
  pending.resolve(response({ items: Array.from({ length: 20 }, (_, index) => ({ ...topic(`qa${index}`), pending: false })), total: 20, page: 1, pageSize: 20 }));
  await turn(); flushFrames(); assert.equal(top(), 280);
});

test('a scroll event still queued when the final layout frame runs cannot restore an older position', async t => {
  const pending = deferred();
  const { main, top, setTop, flushFrames } = await setup(t, '#/community/manage/banners', url => url.includes('topics?') && url.includes('board=qa') ? pending.promise : null);
  setTop(520); main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]').click();
  pending.resolve(response({ items: Array.from({ length: 20 }, (_, index) => ({ ...topic(`qa${index}`), pending: false })), total: 20, page: 1, pageSize: 20 }));
  await turn(); setTop(280); flushFrames(); assert.equal(top(), 280);
});

test('completed short content releases its temporary height and settles at the closest available document position', async t => {
  const pending = deferred();
  const { main, top, setTop, flushFrames, maxScroll } = await setup(t, '#/community/manage/banners', url => url.includes('topics?') && url.includes('board=qa') ? pending.promise : null);
  setTop(520); main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]').click();
  pending.resolve(response({ items: [], total: 0, page: 1, pageSize: 20 })); await turn(); flushFrames();
  assert.equal(main.querySelector('[data-community]').style.minHeight, '');
  assert.equal(top(), Math.min(520, maxScroll()));
});

for (const owner of [true, false]) test(`board review filtering protects reading position in the ${owner ? 'author' : 'moderator'} workspace`, async t => {
  const identity = { ...viewer, owner, role: owner ? 'owner' : 'steward', management: { role: owner ? 'owner' : 'steward', browsingAsReader: false } };
  const { main, top, setTop, flushFrames } = await setup(t, '#/community/manage', () => null, identity);
  setTop(900); main.querySelector('[data-action="community-management-board"][data-board="qa"]').click();
  flushFrames(); assert.equal(top(), 900); assert.equal(main.querySelectorAll('.community-queue-item').length, 10);
});

test('leaving management cancels pending document restoration and does not move the new route', async t => {
  const pending = deferred();
  const { main, w, top, setTop, flushFrames } = await setup(t, '#/community/manage/banners', url => url.includes('topics?') && url.includes('board=qa') ? pending.promise : null);
  setTop(520); main.querySelector('[data-action="community-banner-scope"][data-scope="qa"]').click();
  w.history.replaceState(null, '', '#/community/home'); setTop(0);
  pending.resolve(response({ items: [], total: 0, page: 1, pageSize: 20 })); await turn(); flushFrames();
  assert.equal(top(), 0); assert.equal(w.location.hash, '#/community/home');
});
