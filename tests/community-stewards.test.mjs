import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityStewardsHTML } from '../src/community-stewards.mjs';
import { communityBoards } from '../src/community.mjs';

const common = { t: zh => zh, esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]), icons: { shield: '<i-shield></i-shield>', search: '<i-search></i-search>' } };
const reader = (extra = {}) => ({ name: '星海读者', uid: 'u1', role: 'reader', avatar: '/avatar.webp', level: 1, steward: false, vip: false, frame: null, color: null, ...extra });
const candidate = (extra = {}) => ({ person: reader(), self: false, canAppoint: true, steward: false, ...extra });
const ready = data => ({ state: 'ready', data });

function render(stewards = [], member = null, options = common, editingUid = null) {
  const dom = new JSDOM(communityStewardsHTML(stewards, member, options, editingUid));
  return { dom, doc: dom.window.document };
}

test('moderator management has a compact empty list and one UID lookup form', () => {
  const { dom, doc } = render();
  try {
    assert.match(doc.querySelector('.community-steward-section').textContent, /还没有版主/);
    assert.equal(doc.querySelectorAll('[data-action="community-steward"]').length, 0);
    const form = doc.querySelector('form[data-community-form="steward-lookup"]');
    assert.ok(form.classList.contains('community-steward-lookup'));
    const field = form.elements.namedItem('uid');
    assert.equal(field.id, 'community-steward-uid');
    assert.equal(field.required, true);
    assert.equal(field.maxLength, 64);
    assert.equal(doc.querySelector(`label[for="${field.id}"]`).control, field);
    assert.ok(form.querySelector('button[type="submit"]'));
    assert.ok(form.querySelector('.community-form-status[role="status"]'));
  } finally { dom.window.close(); }
});

test('current moderators retain shared identity visuals, profile links and revoke controls', () => {
  const { dom, doc } = render([reader({ steward: true, nameEffect: { style: 'gradient', colors: ['#663399', '#267A8A'] } }), reader({ uid: 'member/2', name: '另一位版主', avatar: null, steward: true })]);
  try {
    const rows = [...doc.querySelectorAll('.community-steward-row')];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector('.community-av img').getAttribute('src'), '/avatar.webp');
    assert.equal(rows[0].querySelector('.community-uname').dataset.nameEffect, 'gradient');
    assert.match(rows[0].textContent, /UID u1/);
    assert.equal(rows[0].querySelector('a.community-uname').getAttribute('href'), '#/community/u/u1');
    assert.equal(rows[1].querySelector('a.community-uname').getAttribute('href'), '#/community/u/member%2F2');
    rows.forEach((row, index) => {
      const action = row.querySelector('[data-action="community-steward"]');
      assert.equal(action.dataset.uid, index ? 'member/2' : 'u1');
      assert.equal(action.dataset.on, 'false');
      assert.equal(action.type, 'button');
      assert.equal(row.querySelector('[data-action="community-steward-edit"]').dataset.uid, index ? 'member/2' : 'u1');
    });
  } finally { dom.window.close(); }
});

test('eligible reader candidates choose boards before appointment or adjusting an existing scope', () => {
  for (const steward of [false, true]) {
    const { dom, doc } = render([], ready(candidate({ steward })));
    try {
      const result = doc.querySelector('.community-steward-candidate');
      assert.ok(result.querySelector('.community-steward-person .community-av'));
      assert.match(result.textContent, /星海读者.*UID u1/s);
      const form = result.querySelector('form[data-community-form="steward-scope"]');
      if (steward) {
        assert.equal(form, null);
        assert.equal(result.querySelector('[data-action="community-steward-edit"]').dataset.uid, 'u1');
      } else {
        assert.equal(form.dataset.uid, 'u1');
        assert.equal(form.dataset.existing, 'false');
        assert.equal(form.querySelectorAll('input[name="boards"]').length, communityBoards.length);
        assert.equal(form.querySelectorAll('input[name="boards"]:checked').length, 0);
        assert.ok(form.querySelector('button[type="submit"]'));
      }
      assert.equal(Boolean(result.querySelector('[data-action="community-steward"][data-on="false"]')), steward);
    } finally { dom.window.close(); }
  }
});

test('permission, self, owner and missing UID each prevent candidate appointment', () => {
  const members = [candidate({ canAppoint: false }), candidate({ self: true }), candidate({ person: reader({ role: 'owner' }) }), candidate({ person: reader({ uid: null }) })];
  for (const member of members) {
    const { dom, doc } = render([], ready(member));
    try {
      assert.equal(doc.querySelector('.community-steward-candidate [data-action="community-steward"]'), null);
      assert.equal(doc.querySelector('.community-steward-candidate [data-community-form="steward-scope"]'), null);
      assert.match(doc.querySelector('.community-steward-candidate').textContent, /不能任命/);
    } finally { dom.window.close(); }
  }
});

test('candidate loading and failures stay inline without erasing the moderator list', () => {
  for (const load of [{ state: 'loading' }, { state: 'error', status: 404, message: '' }, { state: 'error', status: 500, message: '读取失败，请重试' }]) {
    const { dom, doc } = render([reader({ steward: true })], load);
    try {
      assert.equal(doc.querySelectorAll('.community-steward-row').length, 1);
      assert.equal(doc.querySelector('.community-steward-candidate [data-action="community-steward"]'), null);
      const status = doc.querySelector('.community-steward-candidate [role="status"]');
      assert.ok(status);
      assert.match(status.textContent, load.state === 'loading' ? /查找/ : load.status === 404 ? /没有找到/ : /读取失败/);
      assert.equal(doc.querySelector('.community-empty'), null, 'lookup errors must not replace the entire workspace with a full-page empty state');
    } finally { dom.window.close(); }
  }
});

test('all identity fields and server error text are escaped while UID links remain encoded', () => {
  const unsafe = reader({ name: '<img src=x onerror=alert(1)>', uid: 'u" onclick="alert(1)<', avatar: '/avatar.webp" onerror="alert(1)' });
  const { dom, doc } = render([unsafe], ready(candidate({ person: unsafe })));
  try {
    assert.equal(doc.querySelectorAll('[onclick], [onerror]').length, 0);
    assert.equal(doc.querySelectorAll('.community-uname img').length, 0);
    assert.equal(doc.querySelector('.community-uname').textContent, unsafe.name);
    assert.equal(doc.querySelector('.community-av img').getAttribute('src'), unsafe.avatar);
    assert.equal(doc.querySelector('a.community-uname').getAttribute('href'), `#/community/u/${encodeURIComponent(unsafe.uid)}`);
    assert.equal(doc.querySelector('.community-steward-candidate [data-community-form="steward-scope"]').dataset.uid, unsafe.uid);
  } finally { dom.window.close(); }
  const failure = render([], { state: 'error', status: 500, message: '<script>alert(1)</script>' });
  try {
    assert.equal(failure.doc.querySelector('script'), null);
    assert.equal(failure.doc.querySelector('.community-steward-candidate [role="status"]').textContent, '<script>alert(1)</script>');
  } finally { failure.dom.window.close(); }
});

test('roster shows actual board labels and clearly marks inherited global scopes', () => {
  const { dom, doc } = render([reader({ steward: true, moderationBoards: ['qa', 'tools'] }), reader({ uid: 'legacy', steward: true }), reader({ uid: 'empty', steward: true, moderationBoards: [] })]);
  try {
    const rows = [...doc.querySelectorAll('.community-steward-row')];
    assert.deepEqual([...rows[0].querySelectorAll('[data-steward-board]')].map(node => node.textContent), ['学习问答', '工具资源']);
    assert.match(rows[1].querySelector('.community-steward-boards').textContent, /全部板块（原有权限）/);
    assert.match(rows[2].querySelector('.community-steward-boards').textContent, /未分配板块/);
    assert.equal(doc.querySelector('[data-community-form="steward-scope"]'), null);
  } finally { dom.window.close(); }
});

test('one roster editor preselects only its saved boards with accessible multi-select controls', () => {
  const { dom, doc } = render([reader({ steward: true, moderationBoards: ['qa', 'tools'] }), reader({ uid: 'other', steward: true, moderationBoards: ['showcase'] })], null, common, 'u1');
  try {
    const forms = doc.querySelectorAll('[data-community-form="steward-scope"]');
    assert.equal(forms.length, 1);
    const form = forms[0];
    assert.equal(form.dataset.uid, 'u1');
    assert.equal(form.dataset.existing, 'true');
    assert.deepEqual([...form.querySelectorAll('[name="boards"]:checked')].map(field => field.value), ['qa', 'tools']);
    const choices = [...form.querySelectorAll('[name="boards"]')];
    assert.deepEqual(choices.map(field => field.value), communityBoards.map(board => board.id));
    for (const field of choices) {
      assert.equal(field.type, 'checkbox');
      assert.ok(field.closest('.community-choice'));
      assert.ok(doc.querySelector(`label[for="${field.id}"]`));
      assert.equal(field.required, false, 'requiring every checkbox would incorrectly force all boards');
    }
    assert.equal(form.querySelector('[data-action="community-steward-edit-cancel"]').type, 'button');
    assert.ok(form.querySelector('.community-form-status[role="status"]'));
    assert.match(form.textContent, /至少选择一个板块，可多选/);
    assert.match(form.textContent, /全社区禁言/);
    assert.equal(form.querySelector('form'), null);
  } finally { dom.window.close(); }
});

test('legacy roster editors default to all boards while existing candidates display saved scope and link to editing', () => {
  const legacy = render([reader({ steward: true })], null, common, 'u1');
  try { assert.equal(legacy.doc.querySelectorAll('[data-community-form="steward-scope"] [name="boards"]:checked').length, communityBoards.length); }
  finally { legacy.dom.window.close(); }
  const current = render([], ready(candidate({ steward: true, person: reader({ steward: true, moderationBoards: ['showcase'] }) })));
  try {
    assert.equal(current.doc.querySelector('[data-community-form="steward-scope"]'), null);
    assert.deepEqual([...current.doc.querySelectorAll('.community-steward-candidate [data-steward-board]')].map(chip => chip.textContent), ['作品展廊']);
    assert.equal(current.doc.querySelector('.community-steward-candidate [data-action="community-steward-edit"]').dataset.uid, 'u1');
  }
  finally { current.dom.window.close(); }
});

test('looking up the moderator currently being edited does not duplicate board fields or control IDs', () => {
  const person = reader({ steward: true, moderationBoards: ['qa'] });
  const { dom, doc } = render([person], ready(candidate({ person, steward: true })), common, 'u1');
  try {
    assert.equal(doc.querySelectorAll('[data-community-form="steward-scope"]').length, 1);
    const ids = [...doc.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(doc.querySelector('.community-steward-candidate').textContent, /上方/);
  } finally { dom.window.close(); }
});
