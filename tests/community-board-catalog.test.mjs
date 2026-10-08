import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as community from '../src/community.ts';
import { communityComposeHTML } from '../src/community-post.ts';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const common = { t: zh => zh, esc, icons: {} };
const extra = () => ({ ...community.defaultCommunityBoards[4], id: 'board-ai-2026', zh: '<新板块>', en: '<New board>', description: '普通讨论', descriptionEn: 'Discussion' });

test('board deep links recognize safe slugs before the catalog arrives, with no speculative definition', () => {
  assert.equal(community.communityRoute('#/community/boards/board-ai-2026').view, 'board');
  assert.equal(community.communityRoute('#/community/new/board-ai-2026').board, 'board-ai-2026');
  for (const suffix of ['bad%2Fboard', 'UPPER', 'x', '<script>', 'a'.repeat(49)])
    assert.equal(community.communityRoute(`#/community/boards/${suffix}`).view, 'unknown');
  const markup = community.communityBoardHTML({ ...common, board: 'board-ai-2026', summary: { state: 'loading' }, list: { state: 'loading' }, sort: 'active', members: false });
  assert.match(markup, /正在读取/);
  const absent = community.communityBoardHTML({ ...common, board: 'board-ai-2026', summary: { state: 'ready', data: { boards: {} } }, list: { state: 'ready', data: { items: [] } }, sort: 'active', members: false });
  assert.match(absent, /不存在/);
});

test('confirmed catalogs update every consumer, keep the original seed intact and ignore late older reads', t => {
  assert.equal(typeof community.installCommunityBoardCatalog, 'function');
  t.after(() => community.resetCommunityBoardCatalog());
  const seeds = structuredClone(community.defaultCommunityBoards);
  const items = [...seeds].reverse().concat(extra());
  assert.equal(community.installCommunityBoardCatalog({ version: 2, items }), true);
  assert.deepEqual(community.communityBoards.map(board => board.id), items.map(board => board.id));
  assert.deepEqual(community.defaultCommunityBoards, seeds);
  assert.equal(community.installCommunityBoardCatalog({ version: 1, items: seeds }), false);
  assert.equal(community.installCommunityBoardCatalog({ version: 3, items: [...items, extra()] }), false);
  assert.equal(community.installCommunityBoardCatalog({ version: 3, items: items.map(board => board.id === extra().id ? { ...board, color: 'red;display:none' } : board) }), false);
  const summary = { state: 'ready', data: { total: 0, boards: {}, tags: {}, hot: [] } };
  const doc = new JSDOM(community.communityBoardsHTML({ ...common, summary, members: true })).window.document;
  assert.equal(doc.querySelectorAll('.community-board-card').length, 7);
  assert.equal(doc.querySelector('.community-board-card:last-child h2').textContent, '<新板块>');
  assert.equal(doc.querySelectorAll('script').length, 0);
  const compose = new JSDOM(communityComposeHTML({ ...common, board: '', members: true, me: null, uploads: [] })).window.document;
  assert.ok([...compose.querySelectorAll('[name="board"]')].some(field => field.value === extra().id));
  assert.equal(compose.querySelectorAll('新板块, script').length, 0);
  doc.defaultView.close(); compose.defaultView.close();
});
