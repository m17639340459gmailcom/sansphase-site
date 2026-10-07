import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityAccountHTML } from '../src/community.ts';
import { communityMemberHTML } from '../src/community-pages.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const reader = { uid: '10001', name: '管理读者', role: 'reader', owner: false, mod: true, unread: { all: 0 }, balance: 0, level: 0 };
const modern = (permissions, role = 'assistant', extra = {}) => ({ ...reader,
  staffRole: role, staff: { role, boards: ['qa'], permissions, delegable: [], parent: { kind: 'reader', id: 'parent' } },
  management: { role, browsingAsReader: false }, ...extra });
const link = (markup, name) => {
  const dom = new JSDOM(markup);
  try { return [...dom.window.document.querySelectorAll('a')].find(item => item.textContent.includes(name))?.getAttribute('href') ?? null; }
  finally { dom.window.close(); }
};

test('account management entry selects a concrete permitted first tab', () => {
  const cases = [
    [['content.inspect'], 'assistant', '#/community/manage'],
    [['report.review'], 'moderator', '#/community/manage/reports'],
    [['profile.avatar.advise'], 'assistant', '#/community/manage/profiles'],
    [['profile.nickname.decide'], 'moderator', '#/community/manage/profiles'],
    [['banner.manage'], 'moderator', '#/community/manage/banners'],
    [['staff.appoint'], 'general', '#/community/manage/stewards'],
    [['member.mute'], 'moderator', '#/community/manage/sanctions'],
    [['feature.decide'], 'moderator', '#/community/manage/features'],
    [['feature.decide'], 'assistant', '#/community/manage/contact'],
    [['topic.approve'], 'assistant', '#/community/manage/contact'],
  ];
  for (const [permissions, role, expected] of cases) {
    assert.equal(link(communityAccountHTML({ ...common, me: modern(permissions, role) }), '管理台'), expected, `${role}: ${permissions}`);
  }
});

test('empty, revoked, ordinary and reader perspectives have no management entry', () => {
  for (const me of [
    modern([]), modern(['not-a-capability']), modern(['banner.manage'], 'moderator', { staff: null }),
    modern(['banner.manage'], 'moderator', { management: null }),
    modern(['content.inspect'], 'assistant', { management: { role: 'assistant', browsingAsReader: true } }),
    { ...reader, mod: false, staff: null, management: null },
  ]) assert.equal(link(communityAccountHTML({ ...common, me }), '管理台'), null);
});

test('owner and verified legacy management retain their existing queue entry', () => {
  for (const me of [
    { ...reader, owner: true, role: 'owner', mod: true, management: { role: 'owner', browsingAsReader: false } },
    { ...reader, management: { role: 'steward', browsingAsReader: false } }, reader,
  ]) assert.equal(link(communityAccountHTML({ ...common, me }), '管理台'), '#/community/manage');
});

test('own profile management shortcut uses the same concrete capability entry', () => {
  const data = { person: reader, tab: 'topics', quick: { balance: 0, checkedIn: false, unread: 0, orders: 0 },
    stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, counts: { topics: 0, replies: 0, bookmarks: 0 }, badges: [], topics: [], self: true };
  for (const [permissions, expected] of [[['profile.avatar.advise'], '#/community/manage/profiles'], [['banner.manage'], '#/community/manage/banners'], [[], null]]) {
    assert.equal(link(communityMemberHTML({ ...common, member: { state: 'ready', data }, me: modern(permissions) }), '社区管理'), expected);
  }
});
