import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommunityUI } from '../src/community-ui.ts';
import { emptyBadgeMetrics, evaluateCommunityBadges } from '../src/community-badge-policy.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, members: true };
const badgeState = evaluateCommunityBadges(emptyBadgeMetrics(), [
  { family: 'appreciation', tier: 'gold', achievedAt: '2026-09-01T00:00:00Z', revokedAt: null },
  { family: 'appreciation', tier: 'diamond', achievedAt: '2026-09-02T00:00:00Z', revokedAt: null },
], [{ id: 'streak365', achievedAt: '2025-09-01T00:00:00Z', revokedAt: null }]);
const member = { person: { uid: '10002', name: '林间', role: 'reader', level: 1 }, bio: '', joinedAt: '2025-01-01T00:00:00Z', cover: null, streak: 0, stats: { topics: 0, replies: 0, likes: 320, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: false, badges: ['streak365'], badgeState, muted: null, canMute: false, canAppoint: false, steward: false, tab: 'badges', topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: null };
const ok = data => ({ ok: true, json: async () => structuredClone(data) });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
async function setup(t, browsing = false) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/#/community/u/10002/badges', pretendToBeVisual: true });
  const w = dom.window;
  const names = ['window', 'document', 'location', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'Event'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names) globalThis[name] = name === 'window' ? w : w[name];
  const calls = [], scrolls = [], notices = [];
  w.scrollTo = (...args) => scrolls.push(args);
  const request = async url => {
    calls.push(url);
    if (url.endsWith('/me')) return ok({ name: '作者', uid: '10001', role: browsing ? 'owner' : 'reader', owner: browsing, mod: browsing, agreed: true, unread: { all: 0 }, management: browsing ? { role: 'owner', browsingAsReader: true } : null });
    if (url.includes('/members/10002')) return ok(member);
    throw Error(url);
  };
  const main = w.document.querySelector('main'), ui = createCommunityUI({ request });
  const ctx = { ...common, notify: text => notices.push(text) };
  main.innerHTML = ui.html(ctx); const cleanup = ui.mount(main, ctx);
  t.after(() => { cleanup(); ui.clear(); w.close(); for (const [name, value] of previous) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  await turn(); await turn();
  return { main, w, calls, scrolls, notices };
}

for (const browsing of [false, true]) test(`${browsing ? 'owner reader perspective' : 'reader'} can browse six families and three materials in place without requests or notifications`, async t => {
  const { main, w, calls, scrolls, notices } = await setup(t, browsing);
  const page = main.querySelector('[data-community="member"]'), hero = page.querySelector('.community-m-hero'), wall = page.querySelector('.community-badge-wall');
  const initialCalls = calls.length, initialScrolls = scrolls.length;
  main.scrollTop = 237;
  const path = w.location.hash;
  for (const card of wall.querySelectorAll('button')) {
    card.click();
    for (const tier of ['gold', 'diamond', 'aurora']) {
      main.querySelector(`[data-badge-tier="${tier}"]`).click();
      assert.equal(main.querySelector('[data-badge-detail]').dataset.tier, tier);
      assert.equal(main.querySelector('[data-badge-detail]').querySelector('[data-badge-art]').dataset.badgeArt, card.dataset.badgeFamilyCard);
      assert.equal(main.querySelector('[data-community="member"]'), page);
      assert.equal(page.querySelector('.community-m-hero'), hero);
      assert.equal(page.querySelector('.community-badge-wall'), wall);
      assert.equal(main.scrollTop, 237);
      assert.equal(w.location.hash, path);
      assert.equal(calls.length, initialCalls);
      assert.equal(scrolls.length, initialScrolls);
      assert.equal(main.querySelector('[data-badge-detail]').dataset.earned, String(card.dataset.badgeFamilyCard === 'appreciation' && tier !== 'aurora'));
    }
  }
  assert.equal(wall.querySelector('[data-badge-family-card="appreciation"]').dataset.tier, 'diamond');
  assert.equal(wall.querySelector('[data-badge-family-card="attendance"]').dataset.earned, 'false');
  assert.equal(notices.length, 0);
});

test('keyboard activation of a finish keeps its focus and an unearned hero static', async t => {
  const { main, w } = await setup(t);
  main.querySelector('[data-badge-family-card="appreciation"]').click();
  const sample = main.querySelector('[data-badge-tier="aurora"]');
  sample.focus(); sample.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(w.document.activeElement, main.querySelector('[data-badge-tier="aurora"]'));
  assert.equal(main.querySelector('[data-badge-detail] [data-badge-art]').dataset.finish, 'locked');
  assert.equal(main.querySelector('[data-badge-tier="aurora"] [data-badge-art]').dataset.finish, 'aurora', 'a labeled material sample previews its finish');
  assert.equal(main.querySelector('[data-badge-family-card="appreciation"] [data-badge-art]').dataset.finish, 'diamond');
});
