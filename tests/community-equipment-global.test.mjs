import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { avatarHTML, nameHTML, nameLabelHTML, communityTopicsHTML } from '../src/community.mjs';
import { communityRankHTML, communityInboxHTML } from '../src/community-pages.mjs';
import { communityPostHTML } from '../src/community-post.mjs';

const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const common = { t: zh => zh, esc, icons: {}, now: Date.parse('2026-10-05T12:00:00Z') };
const oldFrame = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const newFrame = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const colorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const effect = { style: 'gradient', colors: ['#976223', '#236A7B'] };
const person = (overrides = {}) => ({
  uid: 'u1', name: '星海旅人', role: 'reader', avatar: '/avatar.webp', level: 1,
  vip: false, steward: false, frame: `image:${newFrame}`, color: `effect:${colorId}`, nameEffect: effect,
  ...overrides,
});
const me = (overrides = {}) => ({
  ...person(), owner: false, mod: false, balance: 100, checkedIn: false, streak: 1,
  nextReward: { total: 1, bonus: 0 }, gainedToday: 0, behaviourToday: 0, dailyCap: 60,
  unread: { all: 0, reply: 0, thanks: 0, system: 0 }, agreed: true,
  inventory: { makeup: 0, pin: 0, highlight: 0 }, muted: null, ...overrides,
});
const ready = data => ({ state: 'ready', data });
const topic = (overrides = {}) => ({
  id: 't1', board: 'qa', title: '需要解答的问题', author: person({ uid: 'u2', name: '提问者' }),
  createdAt: '2026-10-05T01:00:00Z', lastActivityAt: '2026-10-05T02:00:00Z', replies: 1, likes: 0,
  ...overrides,
});
const thread = (bounty = 10) => ready({
  topic: { ...topic(), body: '这是问题的正文。', bounty, bountyState: 'paid', solved: true, images: [], canDelete: false, canReply: true },
  replies: [{ id: 'r1', author: person(), body: '这是被采纳的回答。', createdAt: '2026-10-05T02:00:00Z', byTopicAuthor: false, accepted: true, canDelete: false, likes: 1 }],
  author: { ...person({ uid: 'u2', name: '提问者' }), topics: 1, replies: 1, badges: [] },
  related: [], viewer: { level: 1, muted: null },
});

function inspect(html, check) {
  const dom = new JSDOM(html);
  try { check(dom.window.document); } finally { dom.window.close(); }
}
function assertName(node, expectedEffect = effect) {
  assert.ok(node, 'the nickname uses the shared person renderer');
  assert.equal(node.dataset.nameEffect, expectedEffect.style);
  assert.equal(node.style.getPropertyValue('--name-start'), expectedEffect.colors[0]);
  assert.equal(node.style.getPropertyValue('--name-end'), expectedEffect.colors.at(-1));
  for (const theme of ['light', 'dark']) {
    assert.match(node.style.getPropertyValue(`--name-${theme}-start`), /^#[0-9A-F]{6}$/);
    assert.match(node.style.getPropertyValue(`--name-${theme}-end`), /^#[0-9A-F]{6}$/);
  }
}
function assertAvatar(doc, expectedFrame = newFrame, avatar = '/avatar.webp') {
  const node = doc.querySelector('.community-av');
  assert.ok(node?.classList.contains('is-frame-image'));
  assert.equal(node.querySelector('img:not(.community-frame-image)')?.getAttribute('src'), avatar);
  assert.equal(node.querySelector('.community-frame-image')?.getAttribute('src'), `/api/community/images/${expectedFrame}.webp`);
}

test('shared avatar, linked nickname and label render custom equipment with both theme palettes', () => {
  inspect(avatarHTML(person(), common) + nameHTML(person(), common) + nameLabelHTML(person(), common), doc => {
    assertAvatar(doc);
    const names = doc.querySelectorAll('.community-uname');
    assert.equal(names.length, 2);
    names.forEach(node => assertName(node));
    assert.equal(names[0].tagName, 'A');
    assert.equal(names[1].tagName, 'SPAN');
  });
});

test('current viewer equipment overrides stale same-UID cached people without mutating the cache', () => {
  const stale = Object.freeze(person({ avatar: '/old-avatar.webp', frame: `image:${oldFrame}`, color: 'aurora', nameEffect: null }));
  const snapshot = structuredClone(stale);
  const current = { ...common, meForSort: me({ avatar: '/current-avatar.webp' }) };
  inspect(avatarHTML(stale, current) + nameHTML(stale, current) + nameLabelHTML(stale, current), doc => {
    assertAvatar(doc, newFrame, '/current-avatar.webp');
    assert.equal(doc.querySelectorAll('.is-color-aurora').length, 0);
    doc.querySelectorAll('.community-uname').forEach(node => assertName(node));
  });
  assert.deepEqual(stale, snapshot);
});

test('taking off equipment clears cached frames and nickname effects immediately', () => {
  const stale = Object.freeze(person());
  const current = { ...common, meForSort: me({ avatar: null, frame: null, color: null, nameEffect: null }) };
  inspect(avatarHTML(stale, current) + nameHTML(stale, current) + nameLabelHTML(stale, current), doc => {
    assert.equal(doc.querySelectorAll('.community-av img').length, 0, 'removed avatar falls back to initials');
    assert.equal(doc.querySelectorAll('.community-frame-image, .is-frame-image, [data-name-effect]').length, 0);
    doc.querySelectorAll('.community-uname').forEach(node => {
      assert.equal(node.className, 'community-uname');
      assert.equal(node.getAttribute('style'), null);
    });
  });
  assert.equal(stale.frame, `image:${newFrame}`);
});

test('viewer overrides cannot change other members or UID-less equipment previews', () => {
  const current = { ...common, meForSort: me({ frame: null, color: null, nameEffect: null, avatar: null }) };
  for (const uid of ['u2', null]) {
    const other = person({ uid });
    inspect(avatarHTML(other, current) + nameHTML(other, current) + nameLabelHTML(other, current), doc => {
      assertAvatar(doc);
      doc.querySelectorAll('.community-uname').forEach(node => assertName(node));
    });
  }
  const uidless = { ...common, meForSort: me({ uid: null, frame: null, color: null, nameEffect: null, avatar: null }) };
  inspect(avatarHTML(person({ uid: null }), uidless) + nameLabelHTML(person({ uid: null }), uidless), doc => {
    assertAvatar(doc);
    assertName(doc.querySelector('.community-uname'));
  });
});

test('ordinary notification actors show equipped nickname effects without nested links in the notice button', () => {
  const inbox = ready({ items: [{ id: 'n1', type: 'follow', actor: person(), createdAt: '2026-10-05T02:00:00Z', read: false, data: {}, topicId: null, topicTitle: null }], unread: { all: 1, reply: 0, thanks: 0, system: 0 } });
  inspect(communityInboxHTML({ ...common, inbox, tab: 'all' }), doc => {
    assertName(doc.querySelector('.community-note-t .community-uname'));
    assertAvatar(doc);
    assert.equal(doc.querySelectorAll('.community-note a').length, 0);
  });
});

test('the monthly leaderboard lead retains their equipped nickname and frame', () => {
  const rank = ready({ contributions: [{ person: person(), score: 8, likes: 3, accepted: 1, featured: 0 }], streaks: [], early: [] });
  inspect(communityRankHTML({ ...common, rank }), doc => {
    assertName(doc.querySelector('.community-banner-lead .community-uname'));
    assertAvatar(doc);
  });
});

test('topic last-reply metadata renders the reply author equipment', () => {
  inspect(communityTopicsHTML([topic({ lastReply: { author: person(), at: '2026-10-05T02:00:00Z' } })], common), doc => {
    assertName(doc.querySelector('.community-topic-meta time .community-uname'));
  });
});

test('accepted-answer notices and active quote labels display nickname equipment with and without a bounty', () => {
  for (const bounty of [0, 10]) {
    inspect(communityPostHTML({ ...common, thread: thread(bounty), me: me(), quoting: 'r1' }), doc => {
      assertName(doc.querySelector('.community-bounty.is-solved .community-uname'));
      assertName(doc.querySelector('.community-quoting .community-uname'));
      assert.equal(doc.querySelectorAll('.community-quoting a').length, 0);
    });
  }
});
