import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { communityAccountHTML, nameHTML, nameLabelHTML, whoHTML } from '../src/community.ts';
import { communityMemberHTML, communityStardustHTML } from '../src/community-pages.ts';
import type { Common, CommunityMe, CommunityPerson } from '../src/community.ts';
import type { CommunityMember, CommunityStardust } from '../src/community-pages.ts';
import { communityGrowthLevels } from '../src/community-growth.ts';
import { communityLevelExplorerHTML } from '../src/community-level-explorer.ts';
import type { CommunityGrowthState } from '../src/community-growth.ts';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: Window & { close(): void } } };
const common: Common = { t: zh => zh, esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!), icons: {}, now: Date.parse('2026-10-05T00:00:00Z') };
const growth: CommunityGrowthState = { level: 1, points: 37, configured: false };
const reader: CommunityPerson & { growth: CommunityGrowthState | null } = { name: '<星野>', uid: '10001', role: 'reader', level: 2, vip: true, growth, nameEffect: { style: 'shimmer', colors: ['#8FE3C8', '#C9B6F2'] } };
const me: CommunityMe = { ...reader, owner: false, mod: false, balance: 200, checkedIn: false, streak: 0, nextReward: { total: 1, bonus: 0 }, gainedToday: 0, behaviourToday: 0, dailyCap: 6, unread: { all: 0, reply: 0, thanks: 0, system: 0 }, agreed: true, inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null };
const stardust: CommunityStardust = { balance: 200, gainedToday: 0, behaviourToday: 0, dailyCap: 6, checkedIn: true, month: { gained: 37, spent: 0 }, flow: 'all', ledger: [], level: 2, owner: false, steward: false, stats: {}, progress: null, growth };
const member: CommunityMember = { person: reader, bio: '', joinedAt: null, cover: null, streak: 0, stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, following: false, self: true, badges: [], muted: null, canMute: false, canAppoint: false, steward: false, tab: 'topics', topics: [], replies: [], bookmarks: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, quick: { balance: 200, checkedIn: false, unread: 0, orders: 0 } };
function documentOf(markup: string) { return new JSDOM(markup); }

test('shared member names show growth, permission and VIP as icon-only marks next to the original nickname', () => {
  const dom = documentOf(whoHTML(reader, common));
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector('.community-uname')!.textContent, '<星野>');
    assert.equal(doc.querySelector('.community-uname')!.getAttribute('data-name-effect'), 'shimmer');
    const marks = [...doc.querySelectorAll<HTMLElement>('.community-who > .community-name > .community-level-marks > .community-level-badge')];
    assert.deepEqual(marks.map(mark => mark.className), ['community-level-badge is-growth', 'community-level-badge is-trust', 'community-level-badge is-vip'], 'growth, permission, VIP in that order');
    assert.deepEqual(marks.map(mark => mark.getAttribute('title')), ['成长等级：星芽', '权限等级：L2 观测', 'VIP 会员']);
    assert.ok(marks.every(mark => mark.getAttribute('role') === 'img' && mark.getAttribute('aria-label') === mark.getAttribute('title')), 'the name lives in the label, not on screen');
    assert.equal(doc.querySelector('.community-level-marks')!.textContent, '', 'no level or icon names are displayed beside the nickname');
    assert.deepEqual(marks.map(mark => mark.querySelector('[data-level-icon]')!.getAttribute('data-level-icon')), ['constellation-g1', 'trust-l2', 'vip-1']);
    assert.deepEqual([...doc.querySelectorAll('.community-level-badge.is-trust img')].map(image => [image.getAttribute('src'), image.getAttribute('data-theme')]), [['/assets/community/levels/compact/trust-l2.webp', null]], 'one static permission derivative serves both themes');
    assert.equal(doc.querySelector('.community-uname .community-level-marks'), null, 'marks do not receive the nickname gradient');
    assert.equal(doc.querySelector('.community-lv, .community-vip, .community-growth-chip'), null, 'the text tags are gone from the nickname line');
    assert.equal(doc.querySelector('.community-uname')!.getAttribute('href'), '#/community/u/10001');
  } finally { dom.window.close(); }
});

test('linked and unlinked names include exactly one set of marks; moderators keep their text role and non-members have no VIP mark', () => {
  for (const markup of [nameHTML(reader, common), nameLabelHTML(reader, common), whoHTML({ ...reader, steward: true }, common)]) {
    const dom = documentOf(markup);
    try { assert.equal(dom.window.document.querySelectorAll('.community-level-marks').length, 1); assert.equal(dom.window.document.querySelectorAll('.community-level-badge.is-growth').length, 1); }
    finally { dom.window.close(); }
  }
  const moderator = documentOf(whoHTML({ ...reader, steward: true }, common));
  try {
    assert.equal(moderator.window.document.querySelector('.community-lv.is-steward')!.textContent, '⬟协管');
    assert.equal(moderator.window.document.querySelector('.community-level-badge.is-trust'), null, 'an appointment is not a permission level');
    assert.ok(moderator.window.document.querySelector('.community-level-badge.is-vip [data-vip-art="1"]'));
  } finally { moderator.window.close(); }
  for (const vip of [false, undefined]) assert.doesNotMatch(whoHTML({ ...reader, vip }, common), /is-vip|vip-art/, 'no VIP icon unless the member is VIP');
});

test('owners have no marks and legacy responses without growth have no invented growth mark', () => {
  const { growth: _growth, ...legacy } = reader;
  for (const person of [{ ...reader, role: 'owner' as const }, { ...reader, growth: null }, legacy]) {
    assert.doesNotMatch(whoHTML(person, common), /is-growth|growth-art/);
  }
  assert.doesNotMatch(whoHTML({ ...reader, role: 'owner' }, common), /community-level-marks/);
  assert.match(whoHTML({ ...reader, growth: null }, common), /is-trust.*is-vip/);
});

test('cached self names use the current account growth state while other members retain their own', () => {
  const cached = { ...reader, growth: { level: 8 as const, points: 9000, configured: false } };
  const dom = documentOf(nameHTML(cached, { ...common, meForSort: me }));
  try { assert.equal(dom.window.document.querySelector('.community-level-badge.is-growth')?.getAttribute('title'), '成长等级：星芽'); }
  finally { dom.window.close(); }
  const other = documentOf(nameLabelHTML({ ...cached, uid: '10002' }, { ...common, meForSort: me }));
  try { assert.equal(other.window.document.querySelector('.community-level-badge.is-growth')?.getAttribute('title'), '成长等级：引星'); }
  finally { other.window.close(); }
  const profile = documentOf(communityMemberHTML({ ...common, meForSort: me, member: { state: 'ready', data: { ...member, person: cached } }, me }));
  try {
    assert.equal(profile.window.document.querySelector('.community-m-name .community-level-badge.is-growth')?.getAttribute('title'), '成长等级：星芽');
    assert.match(profile.window.document.querySelector('.community-me-quick a[href="#/community/stardust/levels"]')!.textContent!, /星芽/);
  } finally { profile.window.close(); }
});

test('account menu and member profile show the same growth while keeping role, trust, VIP and UID', () => {
  const menu = documentOf(communityAccountHTML({ ...common, icons: {}, nickname: reader.name, author: false, me }));
  try {
    assert.equal(menu.window.document.querySelector('.community-menu-head .community-level-badge.is-growth')?.getAttribute('title'), '成长等级：星芽');
    assert.match(menu.window.document.querySelector('.community-menu-head')!.textContent!, /观测 · UID 10001/);
  } finally { menu.window.close(); }
  const profile = documentOf(communityMemberHTML({ ...common, member: { state: 'ready', data: member }, me }));
  try {
    const doc = profile.window.document;
    const large = [...doc.querySelectorAll<HTMLElement>('.community-m-name > .community-level-marks.is-large > .community-level-badge')];
    assert.deepEqual(large.map(mark => mark.getAttribute('title')), ['成长等级：星芽', '权限等级：L2 观测', 'VIP 会员'], 'the profile shows the three icons, large, on their own row');
    assert.equal(doc.querySelector('.community-m-name > .community-level-marks.is-large:first-child + h1 + .community-m-tags') !== null, true, 'the row sits above the name');
    assert.equal(doc.querySelector('.community-m-name h1 .community-level-marks'), null, 'the name line itself carries no icons');
    assert.equal(doc.querySelector('.community-m-tags .community-lv, .community-m-tags .community-vip'), null, 'the text level and VIP tags are replaced by the icons');
    assert.match(doc.querySelector('.community-me-quick a[href="#/community/stardust/levels"]')!.textContent!, /星芽/);
  } finally { profile.window.close(); }
});

test('levels show a center icon and adjacent choices on an arc without the old strip or framed arrow group', () => {
  const dom = documentOf(communityStardustHTML({ ...common, stardust: { state: 'ready', data: stardust }, tab: 'levels' }));
  try {
    const doc = dom.window.document, panel = doc.querySelector('[data-level-explorer]');
    assert.ok(panel);
    assert.equal(panel.querySelectorAll('[data-level-preview]').length, 1);
    assert.equal(panel.querySelector('[data-level-track] .community-emblem-title')?.textContent, '星芽');
    assert.equal(panel.querySelectorAll('.community-level-scale, [role="tablist"]').length, 0);
    assert.equal(panel.querySelectorAll('[data-step]').length, 0);
    assert.equal(panel.querySelectorAll('[data-level-track] [data-level]').length, 2);
    assert.equal(panel.querySelector('[data-level-gallery]'), null);
    assert.match(panel.querySelector('[data-level-detail]')!.textContent!, /成长等级/);
    assert.equal(panel.querySelector('.community-level-threshold, .community-level-earn'), null);
    assert.match(panel.textContent!, /经验记录暂未提供/);
    assert.equal(panel.querySelector('.community-meter'), null);
    assert.doesNotMatch(panel.textContent!, /37|200/, 'legacy contribution totals and balance are not represented as actual experience');
    assert.equal(doc.querySelectorAll('.community-rung, .community-lv-hero, .community-ladder').length, 0, 'old stacked sections are removed');
    assert.deepEqual([...panel.querySelectorAll<HTMLElement>('[data-level-mode]')].map(button => button.dataset.levelMode),
      ['growth', 'trust', 'vip', 'staff'], 'appointed management has its own fourth tab rather than changing earned community levels');
  } finally { dom.window.close(); }
});

test('owners can see the ten titles without receiving a personal growth level', () => {
  const dom = documentOf(communityStardustHTML({ ...common, stardust: { state: 'ready', data: { ...stardust, owner: true, level: 4, growth: null } }, tab: 'levels' }));
  try {
    const panel = dom.window.document.querySelector('[data-level-explorer]');
    assert.ok(panel);
    assert.equal(panel.querySelectorAll('[role="tab"]').length, 0);
    assert.equal(panel.querySelectorAll('[data-step]').length, 0);
    assert.equal(panel.querySelectorAll('[data-level-track] [data-level]').length, 2);
    assert.equal(panel.querySelector('[data-level-gallery]'), null);
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
  const personal = documentOf(communityStardustHTML({ ...common, stardust: { state: 'ready', data: { ...stardust, checkedIn: false, browsingAsReader: true, readOnly: false } }, tab: 'ledger' }));
  try { assert.equal(personal.window.document.querySelector('.community-banner a[href="#/community/checkin"]')!.textContent, '去签到'); }
  finally { personal.window.close(); }
});


test('all growth titles omit G-number prefixes from visible text, tooltip and accessible labels in both languages', () => {
  for (const english of [false, true]) for (const growth of communityGrowthLevels) {
    const context = { ...common, t: (zh: string, en: string) => english ? en : zh };
    const state: CommunityGrowthState = { level: growth.level, points: 0, configured: true };
    const person = { ...reader, growth: state };
    const markup = whoHTML(person, context)
      + communityAccountHTML({ ...context, nickname: person.name, author: false, me: { ...me, growth: state } })
      + communityMemberHTML({ ...context, member: { state: 'ready', data: { ...member, person } } })
      + communityLevelExplorerHTML({ ...stardust, growth: state }, context, { mode: 'growth', growth: growth.level, trust: null });
    const dom = documentOf(markup), doc = dom.window.document;
    try {
      assert.doesNotMatch(doc.body.textContent || '', /\bG(?:10|[1-9])\b/);
      for (const node of doc.querySelectorAll('[title], [aria-label]')) {
        assert.doesNotMatch((node.getAttribute('title') || '') + ' ' + (node.getAttribute('aria-label') || ''), /\bG(?:10|[1-9])\b/);
      }
      assert.match(doc.querySelector('[data-personal-level]')!.textContent!, new RegExp(english ? growth.en : growth.name));
      assert.equal(doc.querySelector('[data-level-preview] [data-growth-art]')!.getAttribute('data-growth-art'), String(growth.level), 'internal rank and approved asset identity remain unchanged');
    } finally { dom.window.close(); }
  }
});
