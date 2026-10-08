import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityAccountHTML, communityManagementHref, avatarHTML } from '../src/community.ts';
import { communityCheckinHTML, communityRankHTML, communityInboxHTML } from '../src/community-pages.ts';
import { communityNewsHTML } from '../src/community-news.ts';

const now = Date.parse('2026-10-09T04:00:00Z');
const at = '2026-10-09T00:00:00Z';
const purchased = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {}, now };
const person = { name: '现任协管', uid: '10008', role: 'reader', avatar: '/approved-avatar.webp', frame: `image:${purchased}`, staffRole: 'assistant', steward: true, level: 1, vip: false };
const me = extra => ({ ...person, balance: 10, owner: false, mod: false, staff: null, unread: { all: 0, reply: 0, thanks: 0, system: 0 }, checkedIn: true, ...extra });
const ready = data => ({ state: 'ready', data });
function documentOf(html, check) {
  const dom = new JSDOM(html);
  try { check(dom.window.document); } finally { dom.window.close(); }
}

test('an appointed reader perspective retains its public artwork without restoring management controls', () => {
  const viewer = me({ management: { role: 'assistant', browsingAsReader: true } });
  assert.equal(communityManagementHref(viewer), null);
  documentOf(communityAccountHTML({ ...common, me: viewer }), document => {
    assert.ok(document.querySelector('[data-staff-art="frame-assistant"]'));
    assert.ok(document.querySelector('[data-staff-art="badge-assistant"]'));
    assert.equal(document.querySelector('a[href^="#/community/manage"]'), null);
    assert.equal(document.querySelector('[data-action="community-browse-mode"]').dataset.reader, 'false');
  });
  const artworkOnly = me({ staffRole: 'general', management: null });
  assert.equal(communityManagementHref(artworkOnly), null, 'a visual role field alone never grants workspace access');
  documentOf(communityAccountHTML({ ...common, me: artworkOnly }), document => {
    assert.ok(document.querySelector('[data-staff-art="badge-general"]'));
    assert.equal(document.querySelector('a[href^="#/community/manage"], [data-action="community-browse-mode"]'), null);
  });
});

function publicSurfaces(context) {
  const topic = { id: 'news', board: 'ai-news', author: person, title: 'AI资讯岗位展示', createdAt: at, lastActivityAt: at, replies: 0, likes: 0 };
  const board = { id: 'ai-news', zh: 'AI资讯', en: 'AI News', icon: 'brain', color: 'violet', type: 'resource', description: '' };
  return [
    communityCheckinHTML({ ...context, checkin: ready({ checkedIn: true, streak: 1, balance: 10, gainedToday: 1, behaviourToday: 0, vip: false, month: '2026-10', days: ['2026-10-09'], checkinsToday: 1,
      earlyBirds: [{ person, at }], makeup: { used: 0, allowed: 2, left: 2, free: false, cards: 0, cost: 30, days: [] }, badges: [] }) }),
    communityRankHTML({ ...context, rank: ready({ contributions: [{ person, score: 2, likes: 2, accepted: 0, featured: 0 }], streaks: [{ person, streak: 1 }], early: [{ person, at }] }) }),
    communityInboxHTML({ ...context, tab: 'all', inbox: ready({ unread: { all: 1, reply: 1, thanks: 0, system: 0 }, items: [{ id: 'notice', type: 'reply', actor: person, topicId: 'topic', replyId: 'reply', text: '回复了你的主题', data: {}, link: null, count: 1, createdAt: at, read: false, topicTitle: '岗位展示' }] }) }),
    communityNewsHTML({ ...context, board, list: ready({ items: [topic], total: 1, page: 1, pageSize: 6 }) }),
  ];
}

test('check-in, ranking, notifications and latest news use fresh own appointment after stale author DTOs', () => {
  for (const staffRole of ['assistant', 'moderator', 'general']) {
    const context = { ...common, meForSort: me({ staffRole }) };
    for (const html of publicSurfaces(context)) documentOf(html, document => {
      assert.ok(document.querySelector(`[data-staff-art="frame-${staffRole}"]`));
      assert.ok(document.querySelector(`[data-staff-art="badge-${staffRole}"]`));
      assert.ok([...document.querySelectorAll('[data-staff-art]')].every(node => node.dataset.staffArt.endsWith(`-${staffRole}`)));
    });
  }
});

test('the same public surfaces retire a revoked own role and return its stored purchased frame', () => {
  const context = { ...common, meForSort: me({ staffRole: null, steward: false, management: null }) };
  for (const html of publicSurfaces(context)) documentOf(html, document => {
    assert.equal(document.querySelector('[data-staff-art], .community-lv.is-steward'), null);
    assert.ok(document.querySelector(`.community-frame-image[src="/api/community/images/${purchased}.webp"]`));
  });
});

test('anonymous product avatar samples never borrow the current staff frame', () => {
  documentOf(avatarHTML({ name: '装扮预览', role: 'reader', uid: null, frame: `image:${purchased}` }, { ...common, meForSort: me() }), document => {
    assert.equal(document.querySelector('[data-staff-art]'), null);
    assert.ok(document.querySelector('.community-frame-image'));
  });
});
