import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCommunityUI } from '../src/community-ui.ts';
import { communityLevelExplorerHTML } from '../src/community-level-explorer.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: true };
const communityVIPMultipliers = [2, 3, 4, 6, 8, 11, 15, 20];
const thresholds = [0, 1200, 3600, 7200, 13200, 21600, 31200, 43200, 56400, 72000];
const data = { vipCatalogue: communityVIPMultipliers.map((multiplier, index) => ({ level: index + 1, multiplier })), balance: 200, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: true, month: { gained: 37, spent: 0 }, flow: 'all', ledger: [], level: 1, owner: false, steward: false, stats: { visitDays: 9, likesRecv: 12, distinctReplies: 5 }, progress: { next: 2, rows: [{ key: 'visitDays', label: '累计访问天数', labelEn: 'Days visited', need: 15, have: 9 }], clean: false }, growth: { level: 1, points: 37, configured: false } };
const ok = data => ({ ok: true, json: async () => structuredClone(data) });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

async function setup(t, browsing = false) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/#/community/stardust/levels', pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const calls = [], scrolls = [], notices = [];
  w.scrollTo = (...args) => scrolls.push(args);
  const request = async url => {
    calls.push(url);
    if (url.endsWith('/me')) return ok({ name: '读者', uid: '10001', role: 'reader', owner: false, mod: browsing, agreed: true, unread: { all: 0 }, management: browsing ? { role: 'steward', browsingAsReader: true } : null });
    if (url.includes('/stardust')) return ok(data);
    throw Error(url);
  };
  const main = w.document.querySelector('main'), ui = createCommunityUI({ request });
  const ctx = { ...common, notify: text => notices.push(text) };
  main.innerHTML = ui.html(ctx); const cleanup = ui.mount(main, ctx);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  await turn(); await turn();
  return { main, w, calls, scrolls, notices };
}

test('level details hide upgrade formulas and reward schedules in both languages', () => {
  for (const english of [false, true]) {
    for (let level = 1; level <= 10; level++) {
      const dom = new JSDOM(communityLevelExplorerHTML(data, { ...common, t: (zh, en) => english ? en : zh }, { mode: 'growth', growth: level, trust: null }));
      const detail = dom.window.document.querySelector('[data-level-detail]');
      assert.equal(detail.querySelector('.community-level-threshold, .community-level-earn, .community-level-conditions'), null);
      assert.doesNotMatch(detail.textContent, /累计经验|升级条件|经验怎么获得|每项每天|Total experience|Requirements|How to earn experience|Each action/);
      assert.equal(dom.window.document.querySelector('a[href*="credits"], .community-level-credit'), null);
      assert.doesNotMatch(dom.window.document.body.textContent, /图标来源|Icon credits|up to 20 EXP|最多 20 经验/);
      dom.window.close();
    }
    for (const owner of [false, true]) {
      const dom = new JSDOM(communityLevelExplorerHTML({ ...data, owner }, { ...common, t: (zh, en) => english ? en : zh }, { mode: 'trust', growth: null, trust: 2 }));
      assert.equal(dom.window.document.querySelector('a[href*="credits"], .community-level-credit'), null);
      assert.equal(dom.window.document.querySelector('.community-level-conditions'), null);
      assert.doesNotMatch(dom.window.document.body.textContent, /升级条件|累计访问天数|30 天内|Requirements|Days visited|No violation in/);
      dom.window.close();
    }
  }
});

test('all growth levels are browsable by adjacent steps without requests, navigation, page replacement or scroll', async t => {
  const { main, w, calls, scrolls, notices } = await setup(t);
  const page = main.querySelector('[data-community]'), banner = main.querySelector('.community-banner');
  const initialCalls = calls.length, initialScrolls = scrolls.length;
  main.scrollTop = 210;
  for (let level = 1; level <= 10; level++) {
    if (level > 1) main.querySelector('[data-level-step="1"]').click();
    assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, String(level));
    assert.equal(main.querySelectorAll('.community-level-scale, [role="tablist"], [data-level-gallery]').length, 0);
    assert.equal(main.querySelectorAll('[data-level-detail]').length, 1);
    assert.equal(main.querySelector('[data-level-preview] .community-growth-art').textContent, '');
    assert.equal(main.querySelector('[data-community]'), page);
    assert.equal(main.querySelector('.community-banner'), banner);
    assert.equal(main.scrollTop, 210);
    assert.equal(main.querySelector('[data-level-track] [aria-pressed="true"]').dataset.level, String(level));
    assert.ok(main.querySelectorAll('[data-level-track] [data-level]').length <= 3);
  }
  assert.equal(calls.length, initialCalls); assert.equal(scrolls.length, initialScrolls);
  assert.deepEqual(notices, []);
  assert.equal(w.location.hash, '#/community/stardust/levels');
  main.querySelector('[data-level-step="-1"]').click();
  assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, '9');
  assert.equal(w.document.activeElement, main.querySelector('[data-level-step="-1"]'));
});

test('keyboard selection preserves focus and roles; reader previews can browse growth and trust details', async t => {
  const { main, w, notices, calls } = await setup(t, true);
  const first = main.querySelector('[data-level-preview]');
  first.focus(); first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, '10');
  assert.equal(w.document.activeElement, main.querySelector('[data-level-preview]'));
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, '9');
  main.querySelector('[data-level-mode="trust"]').click();
  assert.equal(main.querySelectorAll('[role="tab"]').length, 0);
  main.querySelector('[data-level="2"]').click();
  assert.match(main.querySelector('[data-level-detail]').textContent, /权限与限制/);
  assert.doesNotMatch(main.querySelector('[data-level-detail]').textContent, /累计访问天数|9 \/ 15|30 天内/);
  assert.match(main.querySelector('[data-level-detail]').textContent, /不自动给予管理权/);
  main.querySelector('[data-level-step="1"]').click();
  assert.doesNotMatch(main.querySelector('[data-level-detail]').textContent, /近 100 天访问天数|精华 ≥|被采纳 ≥/);
  main.querySelector('[data-level-mode="growth"]').click();
  assert.equal(main.querySelector('[data-level-preview]').getAttribute('data-selected-level'), '9');
  assert.deepEqual(notices, []); assert.equal(calls.filter(url => url.includes('/stardust')).length, 1);
});

test('level navigation uses two bare arrows and adjacent art with an arc, without a thumbnail row or framed control group', async () => {
  const page = new JSDOM(communityLevelExplorerHTML(data, common));
  const doc = page.window.document;
  assert.equal(doc.querySelectorAll('[data-level-step]').length, 2);
  assert.ok(doc.querySelector('[data-carousel-neighbour] img[src="/assets/community/levels/constellation-g2.svg"]'));
  assert.equal(doc.querySelector('[data-level-step="-1"]').disabled, true);
  assert.equal(doc.querySelectorAll('[data-level-track] [aria-pressed="true"]').length, 1);
  assert.ok(doc.querySelector('[data-carousel-arc] path'));
  assert.equal(doc.querySelector('.community-level-controls, [data-level-gallery]'), null);
  assert.equal(doc.querySelector('.community-level-head .community-seg'), null);
  page.window.close();
  const css = await readFile(new URL('../src/community.css', import.meta.url), 'utf8');
  assert.match(css, /\.community-emblem-arrow\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent/);
  assert.doesNotMatch(css, /\.community-level-controls\s*\{|\.community-level-gallery\s*\{/);
});

test('arc keyboard selection keeps the focused stop and never scrolls the page', async t => {
  const { main, w, scrolls } = await setup(t);
  const before = scrolls.length;
  main.scrollTop = 210;
  const first = main.querySelector('[data-level-track] [aria-pressed="true"]');
  first.focus();
  first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(w.document.activeElement, main.querySelector('[data-level-track] [data-level="10"]'));
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(w.document.activeElement, main.querySelector('[data-level-track] [data-level="9"]'));
  assert.equal(main.scrollTop, 210);
  assert.equal(scrolls.length, before);
  assert.equal(main.querySelector('[data-level-gallery]'), null);
});

test('VIP tiers show only the eight multipliers and no fabricated personal grade or progress', () => {
  assert.deepEqual([...communityVIPMultipliers], [2, 3, 4, 6, 8, 11, 15, 20]);
  for (const english of [false, true]) {
    for (const vip of [undefined, false, true]) {
      for (let level = 1; level <= 8; level++) {
        const dom = new JSDOM(communityLevelExplorerHTML({ ...data, vip }, { ...common, t: (zh, en) => english ? en : zh }, { mode: 'vip', growth: null, trust: null, vip: level }));
        const doc = dom.window.document;
        assert.equal(doc.querySelectorAll('[data-level-mode]').length, 4);
        assert.equal(doc.querySelector('[data-level-mode="vip"]').getAttribute('aria-pressed'), 'true');
        assert.equal(doc.querySelector('[data-vip-multiplier]').textContent.trim(), `${communityVIPMultipliers[level - 1]}×`);
        assert.equal(doc.querySelector('[data-level-preview]').dataset.selectedLevel, String(level));
        const progress = doc.querySelector('[data-vip-progress]');
        assert.equal(progress.getAttribute('role'), 'progressbar');
        assert.equal(progress.hasAttribute('aria-valuenow'), false, 'missing ledger is not zero real progress');
        assert.equal(progress.dataset.available, 'false');
        assert.ok(progress.getAttribute('aria-valuetext'));
        assert.doesNotMatch(doc.querySelector('[data-level-status]').textContent, /VIP[1-8]/, 'membership boolean must not invent a settled tier');
        assert.doesNotMatch(doc.querySelector('[data-level-detail]').textContent, /累计.*登录|1,095|1095|72,000|360 天|成长日|\d+\s*\/\s*\d+|登录.*\+\d/);
        assert.match(doc.querySelector('[data-level-detail]').textContent, english ? /not available/i : /暂未提供/);
        dom.window.close();
      }
    }
  }
});

test('VIP selection, keyboard bounds and mode changes preserve page position and per-mode selection', async t => {
  const { main, w, calls, scrolls, notices } = await setup(t, true);
  const page = main.querySelector('[data-community]'), banner = main.querySelector('.community-banner');
  const initialCalls = calls.length, initialScrolls = scrolls.length;
  main.scrollTop = 210;
  main.querySelector('[data-level-mode="vip"]').click();
  for (let level = 1; level <= 8; level++) {
    if (level > 1) main.querySelector('[data-level-step="1"]').click();
    assert.equal(main.querySelector('[data-vip-multiplier]').textContent.trim(), `${communityVIPMultipliers[level - 1]}×`);
    assert.equal(main.querySelector('[data-community]'), page);
    assert.equal(main.querySelector('.community-banner'), banner);
    assert.equal(main.scrollTop, 210);
  }
  assert.equal(main.querySelectorAll('[data-level-track] [data-level]').length, 2);
  assert.equal(main.querySelector('[data-level-track] [data-level="8"]').getAttribute('aria-pressed'), 'true');
  main.querySelector('[data-level-mode="growth"]').click();
  assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, '1');
  main.querySelector('[data-level-mode="vip"]').click();
  assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, '8');
  const preview = main.querySelector('[data-level-preview]');
  preview.focus(); preview.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, '1');
  assert.equal(main.querySelector('[data-level-track] [data-level="1"]').getAttribute('aria-pressed'), 'true');
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(main.querySelector('[data-level-preview]').dataset.selectedLevel, '8');
  assert.equal(calls.length, initialCalls); assert.equal(scrolls.length, initialScrolls);
  assert.deepEqual(notices, []);
  assert.equal(w.location.hash, '#/community/stardust/levels');
});

test('ten approved constellation medallions retain file hashes and provenance without an on-page credit entry', async () => {
  const directory = new URL('../public/assets/community/levels/', import.meta.url);
  const sources = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
  assert.equal(sources.icons.length, 10);
  assert.equal(new Set(sources.icons.map(item => item.slug)).size, 10);
  assert.equal(sources.motion, undefined, 'the superseded raster motion records are gone');
  const files = new Set();
  for (let level = 1; level <= 10; level++) {
    const record = sources.icons[level - 1];
    assert.equal(record.level, level);
    assert.equal(record.slug, `constellation-g${level}`);
    assert.equal(record.file, `constellation-g${level}.svg`);
    const asset = await readFile(new URL(record.file, directory));
    const hash = createHash('sha256').update(asset).digest('hex');
    assert.equal(hash, record.sha256);
    assert.equal(record.bytes, asset.length);
    files.add(hash);
    assert.equal(record.kind, 'original-vector');
    assert.equal(record.generator, 'scripts/build-growth-constellation.mjs');
    assert.equal(record.license, undefined, 'project artwork is not attributed to stock artists');
    const svg = new JSDOM(asset.toString(), { contentType: 'image/svg+xml' });
    assert.equal(svg.window.document.querySelector('script, foreignObject, image, use, a'), null);
    svg.window.close();
    const page = new JSDOM(communityLevelExplorerHTML(data, common, { mode: 'growth', growth: level, trust: null }));
    const icon = page.window.document.querySelector('[data-level-preview] [data-level-icon]');
    assert.equal(icon.dataset.levelIcon, record.slug);
    assert.equal(page.window.document.querySelector('[data-level-preview] svg, [data-level-preview] b'), null, 'no inline SVG or grade text inside the artwork');
    assert.equal(page.window.document.querySelector('[data-level-preview]').getAttribute('aria-controls'), 'community-level-detail');
    assert.equal(page.window.document.querySelector('a[href="/assets/community/levels/credits.html"]'), null);
    page.window.close();
  }
  assert.equal(files.size, 10);
  for (const old of ['feather.svg', 'c-g2-v3.webp', 'c-g7-motion-v2.svg', 'c-g10-v3.webp', 'c-g10-motion-v2.svg']) {
    await assert.rejects(readFile(new URL(old, directory)), { code: 'ENOENT' }, `superseded asset ${old} must not ship`);
  }
});

test('owner and legacy views do not fabricate personal experience; hostile translated labels are escaped', () => {
  for (const entry of [{ ...data, owner: true, growth: null }, { ...data, growth: undefined }]) {
    const dom = new JSDOM(communityLevelExplorerHTML(entry, common));
    assert.equal(dom.window.document.querySelector('[data-personal-level]'), null);
    assert.doesNotMatch(dom.window.document.querySelector('[data-level-explorer]').innerHTML, /37|余额|已获得.*经验/);
    dom.window.close();
  }
  const dom = new JSDOM(communityLevelExplorerHTML(data, { ...common, t: () => '<img src=x onerror=alert(1)>' }));
  assert.equal(dom.window.document.querySelector('img[src="x"], [onerror]'), null);
  assert.ok([...dom.window.document.querySelectorAll('img')].every(image => image.getAttribute('src').startsWith('/assets/community/levels/')));
  dom.window.close();
});
