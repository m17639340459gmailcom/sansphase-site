import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { communityHomeHTML, communityBoardsHTML, boardHref, communityRoute } from '../src/community.mjs';
import { readCategories } from '../src/community-layout/board-links.ts';

const common = { t: zh => zh, esc: value => String(value ?? ''), members: true };
const summary = { state: 'ready', data: { total: 0, repliesToday: 0, checkinsToday: 0, boards: {}, tags: {}, hot: [] } };
const list = { state: 'ready', data: { items: [], total: 0, page: 1, pageSize: 20 } };

test('enabled tea-room replaces navigation only; legacy VIP posts keep their original route', () => {
  for (const enabled of [false, true]) {
    const home = new JSDOM(communityHomeHTML({ ...common, summary, list, sort: 'active', teahouseEnabled: enabled }));
    const destination = enabled ? '/teahouse' : '#/community/boards/vip';
    assert.equal(home.window.document.querySelector('[data-board-id="vip"]').getAttribute('href'), destination);
    assert.equal(readCategories(home.window.document.querySelector('.community-boards')).find(item => item.id === 'vip').href, destination);
    const directory = new JSDOM(communityBoardsHTML({ ...common, summary, teahouseEnabled: enabled }));
    assert.ok(directory.window.document.querySelector(`.community-board-card[href="${destination}"]`));
    assert.equal(home.window.document.querySelector('[data-board-id="qa"]').getAttribute('href'), '#/community/boards/qa');
    home.window.close(); directory.window.close();
  }
  assert.equal(boardHref('vip'), '#/community/boards/vip');
  assert.equal(communityRoute('#/community/boards/vip').view, 'board');
});

test('board sidebar does not accept an arbitrary path disguised as a chat entry', () => {
  const dom = new JSDOM(communityHomeHTML({ ...common, summary, list, sort: 'active', teahouseEnabled: true }));
  const source = dom.window.document.querySelector('.community-boards');
  source.querySelector('[data-board-id="vip"]').setAttribute('href', '/teahouse/unsafe');
  assert.equal(readCategories(source).some(item => item.id === 'vip'), false);
  const unrelated = source.querySelector('[data-board-id="qa"]');
  unrelated.setAttribute('href', '/teahouse');
  assert.equal(readCategories(source).some(item => item.id === 'qa'), false);
  dom.window.close();
});
