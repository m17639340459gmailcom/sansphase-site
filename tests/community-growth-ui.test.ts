import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { communityAccountHTML, nameHTML, nameLabelHTML, whoHTML } from '../src/community.ts';
import { communityMemberHTML, communityStardustHTML } from '../src/community-pages.ts';
import type { Common, CommunityMe, CommunityPerson } from '../src/community.ts';
import type { CommunityMember, CommunityStardust } from '../src/community-pages.ts';
import type { CommunityGrowthState } from '../src/community-growth.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: Window & { close(): void } } };
const common: Common = { t: zh => zh, esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!), icons: {}, now: Date.parse('2026-10-05T00:00:00Z') };
const growth: CommunityGrowthState = { level: 1, points: 37, configured: false };
const reader: CommunityPerson & { growth: CommunityGrowthState | null } = { name: '<星野>', uid: '10001', role: 'reader', level: 2, vip: true, growth, nameEffect: { style: 'shimmer', colors: ['#8FE3C8', '#C9B6F2'] } };
const me: CommunityMe = { ...reader, owner: false, mod: false, balance: 200, checkedIn: false, streak: 0, nextReward: { total: 1, bonus: 0 }, gainedToday: 0, behaviourToday: 0, dailyCap: 6, unread: { all: 0, reply: 0, thanks: 0, system: 0 }, agreed: true, inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null };
const stardust: CommunityStardust = { balance: 200, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: true, month: { gained: 37, spent: 0 }, flow: 'all', ledger: [], level: 2, owner: false, steward: false, stats: {}, progress: null, growth };
const member: CommunityMember = { person: reader, bio: '', joinedAt: null, cover: null, streak: 0, stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: true, badges: [], muted: null, canMute: false, canAppoint: false, steward: false, tab: 'topics', topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: { balance: 200, checkedIn: false, unread: 0, orders: 0 } };
function documentOf(markup: string) { return new JSDOM(markup); }

test('shared member names show growth next to the original nickname without consuming trust or VIP marks', () => {
  const dom = documentOf(whoHTML(reader, common));
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector('.community-uname')!.textContent, '<星野>');
    assert.equal(doc.querySelector('.community-uname')!.getAttribute('data-name-effect'), 'shimmer');
    assert.equal(doc.querySelector('.community-growth-chip')?.textContent, 'G1 星芽');
    assert.equal(doc.querySelector('.community-uname .community-growth-chip'), null, 'badge does not receive the nickname gradient');
    assert.equal(doc.querySelector('.community-lv')!.textContent, '观测');
    assert.equal(doc.querySelector('.community-vip')!.textContent, 'VIP');
    assert.match(doc.querySelector('.community-growth-chip')!.getAttribute('title')!, /成长等级/);
    assert.equal(doc.querySelector('.community-uname')!.getAttribute('href'), '#/community/u/10001');
  } finally { dom.window.close(); }
});

test('linked and unlinked names include exactly one growth mark, including appointed moderators', () => {
  for (const markup of [nameHTML(reader, common), nameLabelHTML(reader, common), whoHTML({ ...reader, steward: true }, common)]) {
    const dom = documentOf(markup);
    try { assert.equal(dom.window.document.querySelectorAll('.community-growth-chip').length, 1); }
    finally { dom.window.close(); }
  }
  const moderator = documentOf(whoHTML({ ...reader, steward: true }, common));
  try {
    assert.equal(moderator.window.document.querySelector('.community-lv.is-steward')!.textContent, '⬟协管');
    assert.equal(moderator.window.document.querySelector('.community-vip')!.textContent, 'VIP');
  } finally { moderator.window.close(); }
});

test('owners and legacy responses without growth have no invented growth mark', () => {
  const { growth: _growth, ...legacy } = reader;
  for (const person of [{ ...reader, role: 'owner' as const }, { ...reader, growth: null }, legacy]) {
    assert.doesNotMatch(whoHTML(person, common), /community-growth-chip/);
  }
});

test('cached self names use the current account growth state while other members retain their own', () => {
  const cached = { ...reader, growth: { level: 8 as const, points: 9000, configured: false } };
  const dom = documentOf(nameHTML(cached, { ...common, meForSort: me }));
  try { assert.equal(dom.window.document.querySelector('.community-growth-chip')?.textContent, 'G1 星芽'); }
  finally { dom.window.close(); }
  const other = documentOf(nameLabelHTML({ ...cached, uid: '10002' }, { ...common, meForSort: me }));
  try { assert.equal(other.window.document.querySelector('.community-growth-chip')?.textContent, 'G8 引星'); }
  finally { other.window.close(); }
  const profile = documentOf(communityMemberHTML({ ...common, meForSort: me, member: { state: 'ready', data: { ...member, person: cached } }, me }));
  try {
    assert.equal(profile.window.document.querySelector('.community-m-name .community-growth-chip')?.textContent, 'G1 星芽');
    assert.match(profile.window.document.querySelector('.community-me-quick a[href="#/community/stardust/levels"]')!.textContent!, /G1 星芽/);
  } finally { profile.window.close(); }
});

test('account menu and member profile show the same growth while keeping role, trust, VIP and UID', () => {
  const menu = documentOf(communityAccountHTML({ ...common, icons: {}, nickname: reader.name, author: false, me }));
  try {
    assert.equal(menu.window.document.querySelector('.community-menu-head .community-growth-chip')?.textContent, 'G1 星芽');
    assert.match(menu.window.document.querySelector('.community-menu-head')!.textContent!, /观测 · UID 10001/);
  } finally { menu.window.close(); }
  const profile = documentOf(communityMemberHTML({ ...common, member: { state: 'ready', data: member }, me }));
  try {
    const doc = profile.window.document;
    assert.equal(doc.querySelector('.community-m-name h1 .community-growth-chip')?.textContent, 'G1 星芽');
    assert.equal(doc.querySelector('.community-m-tags .community-lv')!.textContent, '观测');
    assert.equal(doc.querySelector('.community-m-tags .community-vip')!.textContent, 'VIP');
    assert.match(doc.querySelector('.community-me-quick a[href="#/community/stardust/levels"]')!.textContent!, /G1 星芽/);
  } finally { profile.window.close(); }
});

test('levels show one approved icon and arrow controls without a bottom grade strip', () => {
  const dom = documentOf(communityStardustHTML({ ...common, stardust: { state: 'ready', data: stardust }, tab: 'levels' }));
  try {
    const doc = dom.window.document, panel = doc.querySelector('[data-level-explorer]');
    assert.ok(panel);
    assert.equal(panel.querySelectorAll('[data-level-preview]').length, 1);
    assert.equal(panel.querySelector('[data-level-preview] h2')?.textContent, '星芽');
    assert.equal(panel.querySelectorAll('.community-level-scale, [role="tablist"]').length, 0);
    assert.equal(panel.querySelectorAll('[data-step]').length, 2);
    assert.match(panel.querySelector('[data-level-detail]')!.textContent!, /成长等级/);
    assert.equal(panel.querySelector('.community-level-threshold, .community-level-earn'), null);
    assert.match(panel.textContent!, /待启用/);
    assert.doesNotMatch(panel.innerHTML, /community-meter|37|200/, 'legacy contribution totals and balance are not represented as actual experience');
    assert.equal(doc.querySelectorAll('.community-rung, .community-lv-hero, .community-ladder').length, 0, 'old stacked sections are removed');
    assert.equal(panel.querySelectorAll('[data-level-mode]').length, 3);
  } finally { dom.window.close(); }
});

test('owners can see the ten titles without receiving a personal growth level', () => {
  const dom = documentOf(communityStardustHTML({ ...common, stardust: { state: 'ready', data: { ...stardust, owner: true, level: 4, growth: null } }, tab: 'levels' }));
  try {
    const panel = dom.window.document.querySelector('[data-level-explorer]');
    assert.ok(panel);
    assert.equal(panel.querySelectorAll('[role="tab"]').length, 0);
    assert.equal(panel.querySelectorAll('[data-step]').length, 2);
    assert.equal(panel.querySelector('[data-personal-level]'), null);
    assert.match(panel.textContent!, /作者不参与成长等级/);
  } finally { dom.window.close(); }
});

test('stardust only invites an eligible real reader to check in, not owners or read-only moderator previews', () => {
  for (const data of [{ ...stardust, checkedIn: false, owner: true }, { ...stardust, checkedIn: false, browsingAsReader: true }]) {
    const dom = documentOf(communityStardustHTML({ ...common, stardust: { state: 'ready', data }, tab: 'ledger' }));
    try {
      assert.equal(dom.window.document.querySelector('.community-banner a[href="#/community/checkin"]'), null);
      assert.doesNotMatch(dom.window.document.querySelector('.community-banner')!.textContent!, /今天还没签到|去签到/);
    } finally { dom.window.close(); }
  }
  const readerPage = documentOf(communityStardustHTML({ ...common, stardust: { state: 'ready', data: { ...stardust, checkedIn: false } }, tab: 'ledger' }));
  try { assert.equal(readerPage.window.document.querySelector('.community-banner a[href="#/community/checkin"]')!.textContent, '去签到'); }
  finally { readerPage.window.close(); }
});
