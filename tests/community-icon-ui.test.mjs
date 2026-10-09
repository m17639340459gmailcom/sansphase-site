import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
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

test('icon categories show the full selected category without pagination', () => {
  const state = { selected: '', equipped: null, available: ['growth:1'] };
  for (const [kind, count] of [['staff', 3], ['vip', 8], ['growth', 10], ['trust', 4]]) {
    inspect(communityIconPanelHTML(person, state, true, common, { kind }), doc => {
      const choices = [...doc.querySelectorAll('[data-icon-ref]')];
      assert.equal(doc.querySelectorAll('[data-icon-category]').length, 5);
      assert.equal(doc.querySelectorAll('.community-icon-group').length, 1);
      assert.equal(choices.length, count);
      assert.ok(choices.every(button => button.dataset.iconRef.startsWith(`${kind}:`)));
      assert.equal(new Set(choices.map(button => button.dataset.iconRef)).size, count);
      assert.equal(doc.querySelector('.community-icon-pagination, [data-icon-page]'), null);
    });
  }
});

test('achievement choices show only the highest actually earned material in each family', () => {
  const state = { selected: '', equipped: null, available: ['badge:attendance:gold', 'badge:attendance:diamond', 'badge:writing:gold', 'badge:featured:aurora'] };
  inspect(communityIconPanelHTML(person, state, true, common, { kind: 'badge' }), doc => {
    assert.deepEqual([...doc.querySelectorAll('[data-icon-ref]')].map(button => button.dataset.iconRef),
      ['badge:attendance:diamond', 'badge:writing:gold', 'badge:featured:aurora']);
    assert.ok([...doc.querySelectorAll('[data-icon-ref]')].every(button => !button.disabled));
    assert.equal(doc.querySelector('[data-icon-ref="badge:early:gold"]'), null, 'unearned families are omitted');
  });
  inspect(communityIconPanelHTML(person, { selected: '', equipped: null, available: [] }, true, common, { kind: 'badge' }), doc => {
    assert.equal(doc.querySelector('[data-icon-ref]'), null, 'no earned honors means no unearned achievement artwork');
  });
  inspect(communityIconPanelHTML(person, { selected: 'badge:answers:diamond', equipped: null, available: ['badge:writing:gold'] }, true, common, { kind: 'badge' }), doc => {
    const revoked = doc.querySelector('[data-icon-ref="badge:answers:diamond"]');
    assert.equal(revoked.disabled, true);
    assert.equal(revoked.dataset.iconLocked, 'true');
    assert.equal(revoked.querySelector('.community-icon-choice-status').textContent, '资格已失效');
    assert.equal(doc.querySelectorAll('[data-icon-ref]').length, 2, 'a lost saved selection stays grey without exposing the whole locked catalogue');
  });
});

test('icon rows fit five wide, three narrow and two on a phone without changing the owned-frame layout', async () => {
  const css = postcss.parse(await readFile(new URL('../src/community.css', import.meta.url), 'utf8'));
  const columns = [];
  css.walkRules(rule => {
    if (!['.community-icon-grid', '.community-icon-group .community-icon-grid', '.community-frame-grid'].includes(rule.selector)) return;
    const value = rule.nodes.find(node => node.type === 'decl' && node.prop === 'grid-template-columns')?.value;
    columns.push([rule.selector, rule.parent.type === 'atrule' ? rule.parent.params : '', value]);
  });
  assert.ok(columns.some(([selector, media, value]) => selector === '.community-icon-grid' && !media && value === 'repeat(5, minmax(0, 1fr))'));
  assert.ok(columns.some(([selector, media, value]) => selector === '.community-icon-group .community-icon-grid' && media === '(max-width: 960px)' && value === 'repeat(3, minmax(0, 1fr))'));
  assert.ok(columns.some(([selector, media, value]) => selector === '.community-icon-group .community-icon-grid' && media === '(max-width: 640px)' && value === 'repeat(2, minmax(0, 1fr))'));
  assert.ok(columns.some(([selector, , value]) => selector === '.community-frame-grid' && value === 'repeat(auto-fill, minmax(148px, 1fr))'));
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
    assert.deepEqual([...doc.querySelectorAll('[data-frame-ref]')].map(b => b.dataset.frameRef), ['gold']);
    const candidate = doc.querySelector('[data-frame-ref="gold"]');
    assert.equal(candidate.disabled, false);
    assert.equal(candidate.querySelector('[data-staff-frame]'), null, 'owned-frame previews cannot be replaced by an automatic staff frame');
    const panel = doc.querySelector('[data-community-frames]');
    assert.equal(panel.querySelector('header, h2, p, a'), null, 'the owned frame collection contains no explanatory panel or shop links');
    assert.equal(candidate.querySelector('.community-av > span, .community-av > img:not(.community-frame-image)'), null, 'only the frame is previewed');
  });
  assert.equal(communityProfileFramesHTML(ready({ ...profile, frames: [] }), me, common), '', 'no owned frames means no empty card, text or controls');
  inspect(communityProfileFramesHTML(ready(profile), { ...me, management: { role: 'general', browsingAsReader: true } }, common), doc => {
    assert.ok([...doc.querySelectorAll('[data-frame-ref]')].every(button => button.disabled));
  });
  inspect(communityMemberHTML({ ...common, me, member: ready({ ...member, self: false, tab: 'frames', person: { ...person, uid: 'other' } }), frames: ready(profile) }), doc => {
    assert.equal(doc.querySelector('a[href$="/frames"], [data-community-frames]'), null);
  });
});

test('the icon collection omits duplicate titles, instructions and the member name', () => {
  inspect(communityIconPanelHTML(person, { selected: '', equipped: null, available: ['trust:0'] }, true, common, { kind: 'trust' }), doc => {
    const panel = doc.querySelector('[data-community-icons]');
    assert.equal(panel.querySelector('h2, h3, p, .community-icon-current'), null);
    assert.equal(panel.textContent.includes(person.name), false);
    assert.equal(panel.querySelectorAll('[data-icon-category]').length, 5);
    assert.equal(panel.querySelectorAll('[data-icon-ref]').length, 4);
  });
});

test('owned frame previews contain only the ring or full custom frame while public avatars remain intact', async () => {
  const image = '11111111-1111-4111-8111-111111111111';
  const frames = ['gold', 'nebula', 'orbit', `image:${image}`].map((ref, i) => ({ id: String(i), name: `框 ${i}`, ref, image: ref.startsWith('image:') ? image : null }));
  inspect(communityProfileFramesHTML(ready({ person, frames }), me, common), doc => {
    assert.equal(doc.querySelectorAll('.is-frame-preview').length, 4);
    assert.equal(doc.querySelector('.community-av > span, .community-av > img:not(.community-frame-image), [data-staff-frame]'), null);
    const custom = doc.querySelector('.community-frame-image');
    assert.equal(custom.getAttribute('src'), `/api/community/images/${image}.webp`);
    assert.equal(custom.getAttribute('loading'), 'lazy');
  });
  inspect(communityAccountHTML({ ...common, me }), doc => {
    assert.equal(doc.querySelector('.is-frame-preview'), null, 'normal account avatars keep their existing rendering');
    assert.ok(doc.querySelector('.community-av > span, .community-av > img:not(.community-frame-image)'));
  });
  const css = await readFile(new URL('../src/community.css', import.meta.url), 'utf8');
  assert.match(css, /\.community-av\.is-frame-preview\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.community-av\.is-frame-preview::before\s*\{[^}]*mask-image:\s*radial-gradient/);
  assert.match(css, /\.community-frame-grid \.community-av\.is-frame-orbit::after\s*\{[^}]*animation:\s*none/);
});
