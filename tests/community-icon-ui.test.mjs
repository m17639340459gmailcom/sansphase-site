import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityAccountHTML, nameHTML, levelMarksHTML, whoHTML } from '../src/community.ts';
import { communityMemberHTML, communityRankHTML } from '../src/community-pages.ts';
import { communityPostHTML } from '../src/community-post.ts';
import { communityIconPanelHTML } from '../src/community-icon-display.ts';
import { communityProfileFramesHTML } from '../src/community-profile.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const person = { name: '测试昵称', uid: '10001', role: 'reader', level: 3, vip: true,
  staffRole: 'general', growth: { level: 10, points: 72000, configured: true }, vipGrowth: { active: true, level: 8 } };
const topic = { id: 'topic', board: 'qa', author: person, title: '单枚图标回归', body: '正文', createdAt: '2026-10-09T00:00:00Z', lastActivityAt: '2026-10-09T00:00:00Z', likes: 1, replies: 0 };
const me = { ...person, owner: false, mod: true, agreed: true, unread: { all: 0 }, balance: 0, inventory: {} };
const ready = data => ({ state: 'ready', data });
const member = { person, self: true, canMute: false, canAppoint: false, counts: { topics: 0, replies: 0, bookmarks: 0 },
  stats: { topics: 0, replies: 0, likes: 0, accepted: 0, featured: 0 }, follows: { followers: 0, following: 0 }, bio: '', streak: 0,
  joinedAt: null, topics: [], replies: [], bookmarks: [], badges: [], muted: null, quick: null, tab: 'topics' };
const inspect = (html, run) => { const dom = new JSDOM(html); try { run(dom.window.document); } finally { dom.window.close(); } };

test('nickname displays use at most one icon with safe management/VIP defaults and explicit take-off', () => {
  for (const [input, expected] of [[person, 'staff:general'], [{ ...person, staffRole: null }, 'vip:8'],
    [{ ...person, staffRole: null, vip: false }, null], [{ ...person, icon: null }, null],
    [{ ...person, icon: 'growth:4' }, 'growth:4'], [{ ...person, icon: 'badge:attendance:gold' }, 'badge:attendance:gold'],
    [{ ...person, icon: '<script>alert(1)</script>' }, null]]) {
    inspect(nameHTML(input, common) + whoHTML(input, common), doc => {
      for (const name of doc.querySelectorAll('.community-name, .community-who')) {
        assert.ok(name.querySelectorAll('.community-level-badge').length <= 1);
      }
      assert.deepEqual([...doc.querySelectorAll('[data-name-icon]')].map(icon => icon.dataset.nameIcon), expected ? [expected, expected] : []);
      assert.equal(doc.querySelector('.community-role, .community-lv.is-steward, script'), null, 'the removed text role chip must not reappear');
    });
  }
  inspect(levelMarksHTML(person, common), doc => assert.equal(doc.querySelectorAll('.community-level-badge').length, 4, 'the underlying level display remains available separately'));
});

test('rankings, post authors, account menu and profile card all share the same single selection after the nickname', () => {
  const rank = { contributions: [{ person, score: 1 }], streaks: [{ person, streak: 1 }], early: [{ person, at: topic.createdAt }] };
  for (const html of [communityRankHTML({ ...common, rank: ready(rank) }), communityAccountHTML({ ...common, me }),
    communityPostHTML({ ...common, thread: ready({ topic, replies: [], author: { ...person, topics: 1, replies: 0 }, related: [] }) }),
    communityMemberHTML({ ...common, me, member: ready(member) })]) inspect(html, doc => {
      assert.equal(doc.querySelector('.community-role, .community-lv.is-steward'), null);
      for (const name of doc.querySelectorAll('.community-name')) {
        assert.equal(name.querySelectorAll('.community-level-badge').length, 1);
        assert.equal(name.firstElementChild?.classList.contains('community-uname'), true);
        assert.equal(name.querySelector('[data-name-icon]')?.dataset.nameIcon, 'staff:general');
      }
      assert.equal(doc.querySelector('.community-m-name > .community-level-marks'), null, 'profile icons cannot occupy a separate line above the name');
      if (doc.querySelector('.community-m-name')) assert.ok(doc.querySelector('.community-m-name h1 .community-uname + .community-level-marks'));
    });
});

test('icon panel keeps unavailable and expired choices grey, has one selected item, and offers take-off/default actions', () => {
  const state = { selected: 'staff:general', equipped: null, available: ['growth:1', 'trust:0', 'badge:attendance:gold'] };
  inspect(communityIconPanelHTML(person, state, true, common), doc => {
    const expired = doc.querySelector('[data-icon-ref="staff:general"]');
    assert.equal(expired.disabled, true);
    assert.equal(expired.dataset.iconLocked, 'true');
    assert.ok(doc.body.textContent.includes('资格已失效'));
    assert.equal(doc.querySelectorAll('[data-icon-ref][aria-pressed="true"]').length, 1);
    assert.equal(doc.querySelector('[data-icon-ref="growth:1"]'), null, 'other categories do not render into the current collection');
    assert.ok(doc.querySelector('[data-action="community-icon-equip"][data-icon-mode="default"]'));
    assert.ok(doc.querySelector('[data-action="community-icon-equip"][data-icon-mode="none"]'));
    assert.equal(doc.querySelector('[data-level-icon], [data-staff-art]'), null, 'the choice grid uses static artwork to avoid many simultaneous SVG animations');
    assert.ok(doc.querySelector('img[loading="lazy"]'));
  });
  inspect(communityIconPanelHTML(person, state, false, common), doc => {
    assert.ok([...doc.querySelectorAll('[data-action="community-icon-equip"]')].every(button => button.disabled), 'a read-only preview cannot equip a choice');
  });
});

test('icon categories and six-item pages keep the collection compact and every approved icon reachable', () => {
  const state = { selected: '', equipped: null, available: ['growth:1'] };
  for (const [kind, count] of [['staff', 3], ['vip', 8], ['growth', 10], ['trust', 4], ['badge', 18]]) {
    const seen = new Set();
    for (let page = 1; page <= Math.ceil(count / 6); page++) inspect(communityIconPanelHTML(person, state, true, common, { kind, page }), doc => {
      const choices = [...doc.querySelectorAll('[data-icon-ref]')];
      assert.equal(doc.querySelectorAll('[data-icon-category]').length, 5);
      assert.equal(doc.querySelectorAll('.community-icon-group').length, 1);
      assert.ok(choices.length > 0 && choices.length <= 6);
      assert.ok(choices.every(button => button.dataset.iconRef.startsWith(`${kind}:`)));
      choices.forEach(button => { assert.equal(seen.has(button.dataset.iconRef), false); seen.add(button.dataset.iconRef); });
      assert.equal(doc.querySelector('[data-icon-page="previous"]').disabled, page === 1);
      assert.equal(doc.querySelector('[data-icon-page="next"]').disabled, page === Math.ceil(count / 6));
    });
    assert.equal(seen.size, count);
  }
});

test('the icon tab belongs to the current member and does not expose another account’s choices', () => {
  const iconState = { selected: '', equipped: null, available: ['trust:0'] };
  inspect(communityMemberHTML({ ...common, me, member: ready({ ...member, tab: 'icons', iconState }) }), doc => {
    assert.ok(doc.querySelector('a[href="#/community/u/10001/icons"]'));
    assert.ok(doc.querySelector('[data-community-icons]'));
  });
  inspect(communityMemberHTML({ ...common, me, member: ready({ ...member, self: false, tab: 'topics', person: { ...person, uid: 'other' } }) }), doc => {
    assert.equal(doc.querySelector('a[href$="/icons"], [data-community-icons]'), null);
  });
});

test('owned avatar frames follow the icon tab and remain usable without reader profile editing', () => {
  const profile = { person, canEditProfile: false, frames: [{ id: 'owned', name: '已下架但已拥有', ref: 'gold', image: null }] };
  inspect(communityMemberHTML({ ...common, me, member: ready({ ...member, tab: 'frames' }), frames: ready(profile) }), doc => {
    const links = [...doc.querySelectorAll('.community-tabs a')].map(a => a.getAttribute('href'));
    assert.equal(links.indexOf('#/community/u/10001/frames'), links.indexOf('#/community/u/10001/icons') + 1);
    assert.deepEqual([...doc.querySelectorAll('[data-frame-ref]')].map(b => b.dataset.frameRef), ['', 'gold']);
    const candidate = doc.querySelector('[data-frame-ref="gold"]');
    assert.equal(candidate.disabled, false);
    assert.equal(candidate.querySelector('[data-staff-frame]'), null, 'owned-frame previews cannot be replaced by an automatic staff frame');
    assert.ok(doc.body.textContent.includes('当前职务头像框会优先自动显示'));
  });
  inspect(communityProfileFramesHTML(ready({ ...profile, frames: [] }), me, common), doc => {
    assert.equal(doc.querySelectorAll('[data-frame-ref]').length, 1);
    assert.ok(doc.body.textContent.includes('还没有拥有商城头像框'));
  });
  inspect(communityProfileFramesHTML(ready(profile), { ...me, management: { role: 'general', browsingAsReader: true } }, common), doc => {
    assert.ok([...doc.querySelectorAll('[data-frame-ref]')].every(button => button.disabled));
  });
  inspect(communityMemberHTML({ ...common, me, member: ready({ ...member, self: false, tab: 'frames', person: { ...person, uid: 'other' } }), frames: ready(profile) }), doc => {
    assert.equal(doc.querySelector('a[href$="/frames"], [data-community-frames]'), null);
  });
});
