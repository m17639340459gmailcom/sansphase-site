import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';

const turn = () => new Promise(resolve => setTimeout(resolve, 30));
const me = { name: '作者', uid: '10001', role: 'owner', owner: true, mod: true, management: { role: 'owner', browsingAsReader: false }, unread: { all: 0 }, moderationBoards: ['qa', 'tools'] };
const config = scope => ({ scope, version: 1, items: [] });
const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
async function setup(t) {
  const dom = new JSDOM('<main id="main"></main>', { url: 'http://localhost/#/community/manage/banners', pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const scrolls = []; w.scrollTo = value => scrolls.push(value);
  Object.defineProperty(w, 'scrollY', { value: 380, configurable: true });
  let configs = [config('home'), config('qa')];
  const writes = [];
  const request = async (url, init = {}) => {
    let data;
    if (url.endsWith('/me')) data = me;
    else if (url.includes('manage?tab=banners')) data = { owner: true, banners: configs, tab: 'banners', counts: { queue: 0, reports: 0, orders: 0, sanctions: 0 }, kpis: { topics24h: 2, replies24h: 0 }, queue: { topics: [], replies: [] }, reports: [], orders: [], items: [], sanctions: [], data: null };
    else if (url.includes('/topics?')) {
      const board = new URL(url, w.location.href).searchParams.get('board') || 'qa';
      data = { items: [{ id: `${board}-post`, title: `${board} 原帖`, board, author: me, createdAt: '2026-10-05T00:00:00Z', lastActivityAt: '2026-10-05T00:00:00Z', replies: 0 }], total: 1, page: 1, pageSize: 20 };
    } else if (url.endsWith('/manage/banners')) {
      const body = JSON.parse(init.body); writes.push(body);
      const existing = configs.find(config => config.scope === body.scope);
      data = { ...body, version: existing.version + 1, items: body.items.map(item => ({ ...item, board: 'qa', topicTitle: 'qa 原帖', image: null, topicImage: null })) };
      configs = configs.map(config => config.scope === body.scope ? data : config);
    } else throw Error(`Unexpected request ${url}`);
    return { ok: true, json: async () => structuredClone(data) };
  };
  const main = w.document.querySelector('main');
  const ui = createCommunityUI({ request }); main.innerHTML = ui.html(common);
  const release = ui.mount(main, common);
  t.after(() => { release(); ui.clear(); dom.window.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  await turn(); await turn();
  return { ui, w, main, writes, scrolls, click: selector => main.querySelector(selector)?.click() };
}

test('banner settings preserve scoped edits and reading position through scope changes, cancel and save', async t => {
  const { main, w, writes, scrolls, click } = await setup(t);
  assert.ok(main.querySelector('a[href="#/community/manage/banners"][aria-current]'));
  click('[data-action="community-banner-add"]');
  const title = main.querySelector('input[name="banner-title-0"]');
  title.value = '首页自定义标题'; title.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(main.querySelector('[data-banner-preview-title]').textContent, '首页自定义标题');
  click('[data-action="community-banner-scope"][data-scope="qa"]'); await turn();
  assert.equal(main.querySelector('[data-banner-item]'), null);
  click('[data-action="community-banner-add"]');
  assert.equal(main.querySelector('input[name="banner-title-0"]').value, '');
  click('[data-action="community-banner-scope"][data-scope="home"]'); await turn();
  assert.equal(main.querySelector('input[name="banner-title-0"]').value, '首页自定义标题');
  main.querySelector('form[data-community-form="banners"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await turn();
  assert.equal(writes[0].scope, 'home'); assert.equal(writes[0].items[0].title, '首页自定义标题');
  const latest = main.querySelector('input[name="banner-title-0"]'); latest.value = '不要保存'; latest.dispatchEvent(new w.Event('input', { bubbles: true }));
  click('[data-action="community-banner-cancel"]');
  assert.equal(main.querySelector('input[name="banner-title-0"]').value, '首页自定义标题', 'cancel must not copy old DOM values back into the form');
  click('[data-action="community-banner-scope"][data-scope="qa"]'); await turn();
  assert.ok(main.querySelector('[data-banner-item]'), 'saving home must retain the independent board draft');
  assert.equal(w.location.hash, '#/community/manage/banners'); assert.equal(w.scrollY, 380); assert.equal(scrolls.length, 0);
});

test('identity reset clears banner drafts and a dirty banner cannot be lost by switching to reader perspective', async t => {
  const { main, ui, click } = await setup(t);
  click('[data-action="community-banner-add"]');
  await ui.setBrowsing(true);
  assert.ok(main.querySelector('[data-banner-item]'));
  assert.equal(ui.me().management.browsingAsReader, false);
  ui.clear();
  assert.equal(ui.me(), null);
});
