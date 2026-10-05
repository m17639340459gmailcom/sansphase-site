import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { communityRoute } from '../src/community.mjs';
import { communityManageHTML } from '../src/community-pages.mjs';

const common = { t: zh => zh, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icons: {} };
const person = { name: '测试成员', uid: '10002', role: 'reader', level: 1 };
const topic = (id, board) => ({ id, board, title: `待审-${id}`, author: person, pending: true, body: '待审正文', createdAt: '2026-10-05T01:00:00Z', pendingReason: '待审' });
const report = (id, board) => ({ id, reason: `举报-${id}`, note: '', reporter: person, createdAt: '2026-10-05T01:00:00Z', target: { kind: 'topic', topicId: id, board, title: `被举报-${id}`, excerpt: '', author: person, gone: false, hidden: false } });
const data = owner => ({ owner, tab: 'queue', counts: { queue: 3, reports: 3, orders: 0, sanctions: 0 }, kpis: { topics24h: 8, replies24h: 16 }, queue: { topics: [topic('qa', 'qa'), topic('showcase', 'showcase')], replies: [{ id: 'reply-tools', board: 'tools', topicId: 'tools', topicTitle: '工具回复', body: '隐藏正文', author: person, createdAt: '2026-10-05T01:00:00Z' }] }, reports: [report('qa', 'qa'), report('showcase', 'showcase'), report('gone', null)], orders: [], items: [], sanctions: [], data: null, stewards: [person] });
const render = options => new JSDOM(communityManageHTML({ ...common, tab: 'queue', ...options }));

test('owners and moderators can select queue or reports directly and see only the chosen task type', () => {
  for (const owner of [true, false]) for (const tab of ['queue', 'reports']) {
    const dom = render({ tab, manage: { state: 'ready', data: data(owner) } }), doc = dom.window.document;
    const links = [...doc.querySelectorAll('.community-kpis [data-community-management-switch]')];
    assert.equal(links.length, 2);
    assert.deepEqual(links.map(link => link.getAttribute('href')), ['#/community/manage', '#/community/manage/reports']);
    assert.equal(links.filter(link => link.getAttribute('aria-current') === 'page').length, 1);
    assert.equal(links.find(link => link.getAttribute('aria-current') === 'page').dataset.communityManagementSwitch, tab);
    assert.equal(Boolean(doc.querySelector('[data-action="community-approve"]')), tab === 'queue');
    assert.equal(Boolean(doc.querySelector('[data-action="community-uphold"]')), tab === 'reports');
    dom.window.close();
  }
});

test('queue and reports share one selected content review entry in the management sidebar', () => {
  for (const owner of [true, false]) for (const tab of ['queue', 'reports']) {
    const dom = render({ tab, manage: { state: 'ready', data: data(owner) } });
    const links = [...dom.window.document.querySelectorAll('.community-management-nav nav a')];
    const review = links.filter(link => link.textContent.includes('内容审核'));
    assert.equal(review.length, 1);
    assert.equal(review[0].getAttribute('href'), '#/community/manage');
    assert.equal(review[0].getAttribute('aria-current'), 'page');
    assert.equal(review[0].querySelector('b').textContent, '6');
    assert.equal(links.some(link => link.getAttribute('href') === '#/community/manage/reports'), false);
    dom.window.close();
  }
});

test('board moderators only see their assigned board choices and an explicit empty scope stays empty', () => {
  for (const tab of ['queue', 'reports']) for (const moderationBoards of [['qa', 'tools'], []]) {
    const dom = render({ tab, managementBoard: 'showcase', manage: { state: 'ready', data: { ...data(false), moderationBoards } } });
    const buttons = [...dom.window.document.querySelectorAll('[data-action="community-management-board"]')];
    assert.deepEqual(buttons.map(button => button.dataset.board), ['', ...moderationBoards]);
    assert.equal(buttons[0].textContent, '我负责的板块');
    assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
    dom.window.close();
  }
});

test('scoped moderator data view explains its scope without an empty global stardust chart', () => {
  const dom = render({ tab: 'data', manage: { state: 'ready', data: { ...data(false), moderationBoards: ['qa'], data: { flow: [], boards: [{ id: 'qa', topics: 2 }] } } } });
  assert.equal(dom.window.document.querySelector('.community-bars'), null);
  assert.match(dom.window.document.querySelector('.community-management-body').textContent, /仅显示你负责板块的数据/);
  dom.window.close();
});

test('board filters isolate review topics, hidden replies and reports without hiding unknown targets from All', () => {
  for (const owner of [true, false]) for (const tab of ['queue', 'reports']) for (const managementBoard of ['', 'qa', 'tools']) {
    const dom = render({ tab, managementBoard, manage: { state: 'ready', data: data(owner) } }), doc = dom.window.document;
    const active = doc.querySelector('[data-action="community-management-board"][aria-pressed="true"]');
    assert.ok(active);
    assert.equal(active.dataset.board, managementBoard);
    const rows = [...doc.querySelectorAll('.community-queue-item')];
    assert.equal(rows.length, !managementBoard ? 3 : tab === 'reports' && managementBoard === 'tools' ? 0 : 1);
    if (managementBoard) assert.equal(rows.some(row => row.textContent.includes('showcase')), false);
    if (!managementBoard && tab === 'reports') assert.ok(doc.querySelector('.community-management-body').textContent.includes('举报-gone'));
    dom.window.close();
  }
});

test('moderator management is an owner-only section, accepted by the route parser', () => {
  assert.deepEqual(communityRoute('#/community/manage/stewards'), { view: 'manage', board: '', id: '', tab: 'stewards' });
  for (const owner of [true, false]) {
    const dom = render({ tab: 'stewards', manage: { state: 'ready', data: data(owner) } });
    assert.equal(Boolean(dom.window.document.querySelector('nav a[href="#/community/manage/stewards"]')), owner);
    assert.equal(Boolean(dom.window.document.querySelector('form[data-community-form="steward-lookup"]')), owner);
    dom.window.close();
  }
});

test('unverified identities have no management shortcuts and selected cards share theme colors with keyboard feedback', () => {
  const dom = render({ manage: { state: 'error', status: 403, message: '没有权限' }, me: { ...person, owner: false, mod: false } });
  assert.equal(dom.window.document.querySelector('.community-kpis a'), null); dom.window.close();
  const css = readFileSync(new URL('../src/community-management.css', import.meta.url), 'utf8');
  assert.match(css, /\.community-management-kpi\.is-selected\s*\{[^}]*var\(--community-selected-fill\)/);
  assert.match(css, /\.community-management-kpi:focus-within/);
});
