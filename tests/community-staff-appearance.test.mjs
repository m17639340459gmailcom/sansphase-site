import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { avatarHTML, nameHTML, levelMarksHTML, roleChipHTML, communityAccountHTML, communityTopicsHTML, communityHomeHTML } from '../src/community.ts';
import { communityPostHTML } from '../src/community-post.ts';
import { communityMemberHTML } from '../src/community-pages.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const equipment = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const person = overrides => ({ name: '管理成员', role: 'reader', uid: '10006', avatar: '/approved-avatar.webp', level: 2, vip: true,
  growth: { level: 4 }, vipGrowth: { active: true, level: 3 }, frame: `image:${equipment}`, ...overrides });
const ready = data => ({ state: 'ready', data });
const me = overrides => ({ ...person(overrides), owner: false, mod: true, balance: 50, unread: { all: 0 }, inventory: { makeup: 0, pin: 0, highlight: 0 } });
function inspect(html, callback) {
  const dom = new JSDOM(html);
  try { callback(dom.window.document); } finally { dom.window.close(); }
}
const frameSrc = role => `/assets/community/staff/compact/frame-${role}.webp?v=staff-20261009-r2`;
const badgeSrc = role => `/assets/community/staff/compact/badge-${role}.webp?v=staff-20261009-r2`;

for (const role of ['assistant', 'moderator', 'general']) {
  test(`existing ${role} appointments display one matching role frame and mark without changing equipment`, () => {
    const member = Object.freeze(person({ staffRole: role }));
    const before = structuredClone(member);
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl']) inspect(avatarHTML(member, common, size) + nameHTML(member, common), doc => {
      assert.equal(doc.querySelector('.community-av > img').getAttribute('src'), '/approved-avatar.webp');
      assert.equal(doc.querySelector('.community-staff-frame > img').getAttribute('src'), frameSrc(role));
      assert.equal(doc.querySelectorAll('.community-staff-frame').length, 1);
      assert.equal(doc.querySelector('.community-frame-image, .is-frame-image'), null, 'only one frame is displayed while the role is active');
      assert.equal(doc.querySelector('.community-level-badge.is-staff img').getAttribute('src'), badgeSrc(role));
      assert.equal(doc.querySelectorAll('.community-level-badge.is-staff').length, 1);
      assert.equal(doc.querySelectorAll('.community-level-badge.is-growth, .community-level-badge.is-trust, .community-level-badge.is-vip').length, 3);
    });
    assert.deepEqual(member, before);
  });
}

test('ordinary, legacy and owner records do not infer role artwork from VIP, earned levels or old flags', () => {
  for (const data of [{ staffRole: null }, { staffRole: undefined, steward: true }, { staffRole: 'invalid' }, { staffRole: 'owner' }, { role: 'owner', staffRole: 'general' }]) {
    inspect(avatarHTML(person(data), common) + levelMarksHTML(person(data), common), doc => {
      assert.equal(doc.querySelector('[data-staff-art]'), null);
      assert.equal(doc.querySelector('.community-frame-image').getAttribute('src'), `/api/community/images/${equipment}.webp`);
    });
  }
});

test('fresh own identity overrides a cached appointment, including revocation and an owner reader preview', () => {
  const stale = Object.freeze(person({ staffRole: 'general', steward: true }));
  for (const live of [me({ staffRole: null, steward: false, mod: false }), me({ staffRole: null, management: { role: 'owner', browsingAsReader: true, interactive: true } })]) {
    const ctx = { ...common, meForSort: live };
    inspect(avatarHTML(stale, ctx) + nameHTML(stale, ctx) + roleChipHTML(stale, ctx), doc => {
      assert.equal(doc.querySelector('[data-staff-art], .community-lv.is-steward'), null);
      assert.equal(doc.querySelector('.community-frame-image').getAttribute('src'), `/api/community/images/${equipment}.webp`);
    });
  }
  const promoted = { ...common, meForSort: me({ staffRole: 'moderator' }) };
  inspect(avatarHTML(stale, promoted) + nameHTML(stale, promoted) + roleChipHTML(stale, promoted), doc => {
    assert.equal(doc.querySelector('.community-staff-frame img').getAttribute('src'), frameSrc('moderator'));
    assert.equal(doc.querySelector('.community-level-badge.is-staff img').getAttribute('src'), badgeSrc('moderator'));
    assert.equal(doc.querySelector('.community-lv.is-steward').textContent, '版主');
  });
  assert.equal(stale.staffRole, 'general');
  inspect(avatarHTML({ ...stale, uid: 'different-member' }, promoted), doc => {
    assert.equal(doc.querySelector('.community-staff-frame img').getAttribute('src'), frameSrc('general'), 'a viewer role is never borrowed by another member');
  });
});

test('frames and role marks use the shared person rendering in the header, feeds, replies and member page', () => {
  const author = person({ staffRole: 'moderator' });
  const topic = { id: 'topic', board: 'qa', title: '职位显示检查', body: '正文', author, createdAt: '2026-10-09T00:00:00Z', lastActivityAt: '2026-10-09T00:00:00Z', likes: 0, replies: 1, tags: [], images: [] };
  const surfaces = [
    communityAccountHTML({ ...common, me: me({ staffRole: 'moderator' }), nickname: author.name }),
    communityTopicsHTML([topic], common),
    communityHomeHTML({ ...common, summary: { state: 'loading' }, list: ready({ items: [topic], total: 1, page: 1, pageSize: 6 }), sort: 'curated', query: '' }),
    communityPostHTML({ ...common, thread: ready({ topic, replies: [{ id: 'reply', author, body: '回复', createdAt: topic.createdAt, likes: 0 }], related: [], author: { ...author, topics: 1, replies: 1 } }) }),
    communityMemberHTML({ ...common, member: ready({ person: author, bio: '', joinedAt: null, cover: null, streak: 0, topics: [], replies: [], bookmarks: [],
      stats: { topics: 1, replies: 1, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, badges: [], counts: { topics: 0, replies: 0, bookmarks: 0 }, tab: 'topics' }) }),
  ];
  for (const html of surfaces) inspect(html, doc => {
    assert.ok(doc.querySelector('.community-staff-frame img[src="' + frameSrc('moderator') + '"]'));
    assert.ok(doc.querySelector('[data-staff-art="badge-moderator"] img[src="' + badgeSrc('moderator') + '"]'));
    assert.equal(doc.querySelector('[data-staff-art$="-general"], [data-staff-art$="-assistant"]'), null);
  });
});
