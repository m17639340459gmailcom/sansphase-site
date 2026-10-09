import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { levelChipHTML, levelMarksHTML, roleChipHTML, communityAccountHTML } from '../src/community.ts';
import { communityLevelExplorerHTML, createCommunityLevelExplorer } from '../src/community-level-explorer.ts';
import { communityStewardsHTML } from '../src/community-stewards.ts';
import { communityManageHTML } from '../src/community-pages.ts';
import { communityPostHTML, communityDeletePanelHTML } from '../src/community-post.ts';
import { communityStaffCapabilities } from '../src/community-staff.ts';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const person = { uid: '10001', name: '读者', role: 'reader', level: 2, steward: true, staffRole: 'assistant' };
const staff = { role: 'moderator', boards: ['qa'], permissions: ['staff.appoint', 'topic.approve', 'profile.avatar.advise'], delegable: ['topic.approve', 'profile.avatar.advise'], parent: { kind: 'reader', id: 'parent' } };
const dust = { owner: false, steward: true, staffRole: 'assistant', level: 3, vip: false };
const baseManage = { owner: false, actorStaff: staff, tab: 'stewards', counts: {}, kpis: {}, queue: { topics: [], replies: [] }, reports: [], orders: [], sanctions: [], items: [], data: null, stewards: [] };

const ownerStaff = { role: 'owner', boards: ['qa', 'tools'], permissions: communityStaffCapabilities.map(cap => cap.id), delegable: communityStaffCapabilities.map(cap => cap.id), parent: null };
test('owner role picker offers all three management roles, and editing preserves any lower current role', () => {
  for (const role of [null, 'general', 'moderator', 'assistant']) {
    const existing = role ? { ...person, staff: { ...staff, role, parent: { kind: 'reader', id: 'another-manager' } }, canAppoint: true } : null;
    const dom = new JSDOM(communityStewardsHTML(existing ? [existing] : [], existing ? null : { state: 'ready', data: { person: { ...person, steward: false }, steward: false, canAppoint: true, self: false, staff: null } }, common, existing?.uid, ownerStaff));
    const form = dom.window.document.querySelector('[data-community-form="steward-scope"]');
    assert.ok(form);
    const select = form.querySelector('select[name="role"]');
    assert.deepEqual([...select.options].map(option => option.value), ['general', 'moderator', 'assistant']);
    assert.equal(select.value, role || 'general');
    assert.ok(select.classList.contains('community-select'));
    assert.equal(form.querySelectorAll('[name="role"]').length, 1);
    if (existing) assert.match(form.querySelector('[data-steward-chain-warning]').textContent, /撤销.*下属/);
    dom.window.close();
  }
});

test('grouped capability rows keep complete accessible choices without duplicate descriptions', () => {
  for (const t of [zh => zh, (zh, en) => en]) {
    const dom = new JSDOM(communityStewardsHTML([], { state: 'ready', data: { person: { ...person, steward: false }, steward: false, canAppoint: true, self: false, staff: null } }, { ...common, t }, null, ownerStaff));
    const form = dom.window.document.querySelector('[data-community-form="steward-scope"]');
    const groups = form.querySelectorAll('[data-staff-permission-group]');
    assert.equal(groups.length, 6);
    const rows = [...form.querySelectorAll('[data-staff-permission]')];
    assert.equal(rows.length, communityStaffCapabilities.length);
    assert.deepEqual(new Set(rows.map(row => row.dataset.staffPermission)), new Set(ownerStaff.delegable));
    for (const row of rows) {
      const controls = [...row.querySelectorAll('input')];
      assert.deepEqual(controls.map(control => control.name), ['permissions', 'delegable']);
      controls.forEach(control => {
        assert.equal(control.value, row.dataset.staffPermission);
        assert.equal(control.type, 'checkbox');
        assert.ok(control.getAttribute('aria-labelledby').split(' ').every(id => dom.window.document.getElementById(id)));
        assert.equal(dom.window.document.querySelector(`label[for="${control.id}"]`).control, control);
      });
    }
    dom.window.close();
  }
});

test('non-owner pickers retain adjacent roles and a direct assistant has no appointment form', () => {
  for (const [role, next] of [['general', 'moderator'], ['moderator', 'assistant'], ['assistant', null]]) {
    const dom = new JSDOM(communityStewardsHTML([], { state: 'ready', data: { person: { ...person, steward: false }, steward: false, canAppoint: true, self: false, staff: null } }, common, null, { ...staff, role }));
    const options = [...dom.window.document.querySelectorAll('select[name="role"] option')];
    assert.deepEqual(options.map(option => option.value), next ? [next] : []);
    if (!next) assert.equal(dom.window.document.querySelector('[data-community-form="steward-scope"]'), null);
    dom.window.close();
  }
});

test('posting guidance keeps real community levels without reintroducing management text chips', () => {
  for (const staffRole of ['general', 'moderator', 'assistant', undefined]) {
    const markup = levelChipHTML({ ...person, staffRole }, common);
    assert.match(markup, /title="L2"/);
    assert.doesNotMatch(markup, /总版主|版主|协管|community-role|is-steward/);
  }
  assert.equal(levelChipHTML({ ...person, role: 'owner' }, common), '');
  assert.match(levelMarksHTML(person, common), /is-trust/);
  assert.equal(roleChipHTML({ ...person, staffRole: null }, common), '');
  const doc = new JSDOM(communityAccountHTML({ ...common, me: { ...person, staffRole: null, owner: false, mod: false, unread: { all: 0 }, management: { role: 'owner', browsingAsReader: true, interactive: true }, balance: 0 } })).window.document;
  assert.doesNotMatch(doc.querySelector('.community-menu-head').textContent, /站长|协管/);
  assert.equal(doc.querySelector('a[href="#/community/manage"]'), null);
});

test('fourth role tab displays collaborator artwork in the existing carousel and preserves ordinary trust status', () => {
  const dom = new JSDOM(communityLevelExplorerHTML(dust, common));
  const root = dom.window.document.querySelector('[data-level-explorer]');
  const explorer = createCommunityLevelExplorer({ root: () => root, data: () => dust, common: () => common });
  const modes = [...root.querySelectorAll('[data-level-mode]')];
  assert.deepEqual(modes.map(item => item.dataset.levelMode), ['growth', 'trust', 'vip', 'staff']);
  explorer.action(modes[3]);
  assert.match(root.querySelector('[data-level-status]').textContent, /协管/);
  assert.ok(root.querySelector('[data-staff-art-slot]'));
  const image = root.querySelector('[data-level-preview] img');
  assert.equal(image.getAttribute('src'), '/assets/community/staff/compact/badge-assistant.webp?v=staff-20261009-r2');
  assert.equal(image.getAttribute('width'), '400');
  assert.equal(image.getAttribute('height'), '400');
  assert.equal(root.querySelector('[data-carousel-neighbour] img').getAttribute('src'), '/assets/community/staff/compact/badge-moderator.webp?v=staff-20261009-r2');
  assert.equal(root.querySelector('[data-level-preview] svg'), null, 'the static fallback remains outside the isolated idle animation');
  assert.match(root.querySelector('[data-level-detail]').textContent, /上级|删除|禁言|管理联系方式/);
  explorer.action(modes[1]);
  assert.match(root.querySelector('[data-level-status]').textContent, /守夜/);
  assert.doesNotMatch(root.querySelector('[data-level-status]').textContent, /版主|协管/);
  dom.window.close();
});

test('staff carousel navigation keeps artwork paired with role descriptions without changing appointments', () => {
  const dom = new JSDOM(communityLevelExplorerHTML(dust, common));
  const root = dom.window.document.querySelector('[data-level-explorer]');
  const explorer = createCommunityLevelExplorer({ root: () => root, data: () => dust, common: () => common });
  const before = structuredClone(dust);
  explorer.action(root.querySelector('[data-level-mode="staff"]'));
  for (const [level, role, title] of [[0, 'assistant', '协管'], [1, 'moderator', '版主'], [2, 'general', '总版主']]) {
    if (level) explorer.action(root.querySelector('[data-level-step="1"]'));
    assert.equal(root.querySelector('[data-level-preview] [data-staff-role]').dataset.staffRole, role);
    assert.equal(root.querySelector('[data-level-detail] h3').textContent, title);
    const image = root.querySelector('[data-level-preview] img');
    assert.equal(image.getAttribute('src'), `/assets/community/staff/compact/badge-${role}.webp?v=staff-20261009-r2`);
    assert.match(root.querySelector('[data-level-status]').textContent, /当前管理身份：协管/);
  }
  assert.equal(root.querySelector('[data-level-step="1"]').disabled, true);
  assert.equal(root.querySelector('[data-staff-role="owner"]'), null);
  assert.doesNotMatch(root.querySelector('[data-level-track]').textContent, /站长/);
  const preview = root.querySelector('[data-level-preview]');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  try {
    explorer.keydown({ target: preview, key: 'Home', preventDefault() {} });
    assert.equal(root.querySelector('[data-level-preview] img').getAttribute('src'), '/assets/community/staff/compact/badge-assistant.webp?v=staff-20261009-r2');
    explorer.keydown({ target: root.querySelector('[data-level-preview]'), key: 'End', preventDefault() {} });
    assert.equal(root.querySelector('[data-level-preview] img').getAttribute('src'), '/assets/community/staff/compact/badge-general.webp?v=staff-20261009-r2');
    assert.equal(root.querySelector('[data-level-step="1"]').disabled, true);
    explorer.keydown({ target: root.querySelector('[data-level-preview]'), key: 'Home', preventDefault() {} });
  }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'Element', descriptor);
    else delete globalThis.Element;
  }
  assert.equal(root.querySelector('[data-level-preview] img').getAttribute('src'), '/assets/community/staff/compact/badge-assistant.webp?v=staff-20261009-r2');
  assert.equal(dom.window.document.activeElement, root.querySelector('[data-level-preview]'));
  assert.deepEqual(dust, before, 'browsing role artwork grants no role or capability');
  dom.window.close();
});

test('retired fourth staff selection clamps to the last supplied emblem and owner status stays truthful', () => {
  const owner = { ...dust, owner: true, staffRole: 'owner' };
  const before = structuredClone(owner);
  for (const staff of [null, 3, 999]) {
    const dom = new JSDOM(communityLevelExplorerHTML(owner, common, { mode: 'staff', growth: null, trust: null, staff }));
    try {
      const root = dom.window.document.querySelector('[data-level-explorer]');
      assert.equal(root.querySelector('[data-level-preview] img').getAttribute('src'), `/assets/community/staff/compact/badge-${staff === null ? 'assistant' : 'general'}.webp?v=staff-20261009-r2`);
      assert.equal(root.querySelector('[data-staff-role="owner"]'), null);
      assert.doesNotMatch(root.querySelector('[data-level-track]').textContent, /站长/);
      assert.match(root.querySelector('[data-level-status]').textContent, /当前管理身份：站长/);
      if (staff !== null) assert.equal(root.querySelector('[data-level-step="1"]').disabled, true);
    } finally { dom.window.close(); }
  }
  assert.deepEqual(owner, before);
});

test('a moderator can configure only an adjacent assistant with the server supplied delegable scope', () => {
  const candidate = { state: 'ready', data: { person: { ...person, uid: '10002', steward: false, staffRole: null }, steward: false, canAppoint: true, self: false, staff: null } };
  const dom = new JSDOM(communityStewardsHTML([], candidate, common, null, staff));
  const form = dom.window.document.querySelector('[data-community-form="steward-scope"]');
  assert.equal(form.querySelector('[name="role"]').value, 'assistant');
  assert.deepEqual([...form.querySelectorAll('[name="boards"]')].map(item => item.value), ['qa']);
  assert.deepEqual([...form.querySelectorAll('[name="permissions"]')].map(item => item.value), staff.delegable);
  assert.deepEqual([...form.querySelectorAll('[name="delegable"]')].map(item => item.value), staff.delegable);
  assert.equal(form.querySelector('[value="topic.delete"], [value="member.mute"]'), null);
  assert.match(form.textContent, /全账号|不会自动/);
  dom.window.close();
});

test('management navigation and report actions reflect concrete capabilities rather than the role title', () => {
  const manage = { ...baseManage, tab: 'reports', actorStaff: { ...staff, permissions: ['report.review'], delegable: [] }, reports: [{ id: 'report', reason: 'spam', note: '', createdAt: '2026-10-07T00:00:00Z', reporter: person, canUphold: false, canDismiss: true, canPenalty: false, target: { kind: 'topic', topicId: 'topic', board: 'qa', title: '标题', excerpt: '', author: person, gone: false, hidden: false } }] };
  const dom = new JSDOM(communityManageHTML({ ...common, tab: 'reports', manage: { state: 'ready', data: manage } }));
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-action="community-uphold"]'), null);
  assert.ok(doc.querySelector('[data-action="community-dismiss"]'));
  assert.equal(doc.querySelector('[data-community-management-switch="stewards"], [data-community-management-switch="banners"]'), null);
  const appointed = new JSDOM(communityManageHTML({ ...common, tab: 'stewards', manage: { state: 'ready', data: baseManage } })).window.document;
  assert.ok(appointed.querySelector('[data-community-form="steward-lookup"]'));
  dom.window.close();
});

test('topic controls honor individual server proofs, with recommendation separate from final feature approval', () => {
  const topic = { id: 'topic', board: 'qa', title: '待推荐的帖子', body: '正文', author: person, createdAt: '2026-10-07T00:00:00Z', canModerate: true, canPin: false, canLock: false, canMove: false, canApprove: false, canRestore: false, canRecommend: true, canFeature: false, canDelete: false, pending: true, hidden: true, replies: 0 };
  const dom = new JSDOM(communityPostHTML({ ...common, me: { ...person, owner: false, mod: true }, thread: { state: 'ready', data: { topic, replies: [], related: [], author: { ...person, topics: 0, replies: 0 } } } }));
  assert.ok(dom.window.document.querySelector('[data-action="community-feature-recommend"]'));
  assert.equal(dom.window.document.querySelector('[data-action="community-feature"], [data-action="community-pin"], [data-action="community-lock"], [data-action="community-move"], [data-action="community-approve"], [data-action="community-restore"]'), null);
  dom.window.close();
});

test('deletion can be configured without any penalty or mute and report penalty is independently optional', () => {
  for (const reportId of [undefined, 'report']) {
    const dom = new JSDOM(communityDeletePanelHTML({ kind: 'topic', id: 'topic', reportId, canPenalty: false, canMute: false }, common));
    assert.equal(dom.window.document.querySelector('[name="violation"], [name="mute"]'), null);
    assert.doesNotMatch(dom.window.document.body.textContent, /并按违规处理/);
    dom.window.close();
  }
  const dom = new JSDOM(communityDeletePanelHTML({ kind: 'topic', id: 'topic', reportId: 'report', canPenalty: true, canMute: false }, common));
  assert.ok(dom.window.document.querySelector('[name="violation"]'));
  assert.equal(dom.window.document.querySelector('[name="mute"]'), null);
  dom.window.close();
});

test('management content honors a protected target proof even when the actor holds board deletion capability', () => {
  const manage = { ...baseManage, tab: 'content', actorStaff: { ...staff, permissions: ['content.inspect', 'topic.delete'] },
    content: [{ id: 'protected', board: 'qa', title: '上级内容', createdAt: '2026-10-07T00:00:00Z', author: person, canDelete: false }] };
  const dom = new JSDOM(communityManageHTML({ ...common, tab: 'content', manage: { state: 'ready', data: manage } }));
  assert.ok(dom.window.document.querySelector('a[href="#/post/protected"]'));
  assert.equal(dom.window.document.querySelector('[data-action="community-queue-delete"]'), null);
  dom.window.close();
});
