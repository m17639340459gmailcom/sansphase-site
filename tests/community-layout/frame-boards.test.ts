import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test, type TestContext } from 'node:test';
import { Box, CircleHelp, Coffee, Feather, Image, Megaphone, type IconNode } from 'lucide';
import { communityBoards } from '../../src/community.ts';
import { createFrameBoards } from '../../src/community-layout/frame-boards.ts';

interface TestWindow extends Window { close(): void }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string }) => { window: TestWindow };
};
const drawings = new Map<string, IconNode>([
  ['qa', CircleHelp], ['showcase', Image], ['tools', Box],
  ['moments', Feather], ['meta', Megaphone], ['vip', Coffee],
]);

function fixture(t: TestContext) {
  const markup = communityBoards.map(board => `<a class="community-board-link" href="#/community/boards/${board.id}"><span>${board.zh}</span><span class="community-board-count">3</span>${board.id === 'vip' ? '<span class="community-board-lock" aria-label="会员专属">VIP</span>' : ''}</a>`).join('');
  const { window } = new JSDOM(`<section><div class="community-boards">${markup}</div></section>`, { url: 'http://localhost:4213/#/community/home' });
  t.after(() => window.close());
  const document = window.document;
  const source = document.querySelector('section')!;
  const boards = createFrameBoards(document);
  document.body.append(boards.element);
  return { document, source, boards };
}

test('board links display the existing Lucide drawings without changing labels or VIP access hints', t => {
  const { source, boards } = fixture(t);
  boards.sync(source, '#/community/home', false);
  const links = [...boards.element.querySelectorAll('a')];
  assert.equal(links.length, communityBoards.length);
  for (const [index, link] of links.entries()) {
    const board = communityBoards[index];
    assert.equal(link.getAttribute('href'), `#/community/boards/${board.id}`);
    assert.equal(link.textContent, board.zh + (board.id === 'vip' ? 'VIP' : ''));
    const icons = link.querySelectorAll('svg.community-frame-board-icon');
    assert.equal(icons.length, 1, `${board.id} has one library icon`);
    const icon = icons[0];
    assert.equal(icon, link.firstElementChild);
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
    assert.equal(icon.getAttribute('focusable'), 'false');
    assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
    const shapes = [...icon.children];
    const drawing = drawings.get(board.id)!;
    assert.equal(shapes.length, drawing.length);
    drawing.forEach(([tag, attributes], shapeIndex) => {
      assert.equal(shapes[shapeIndex].localName, tag);
      for (const [name, value] of Object.entries(attributes)) assert.equal(shapes[shapeIndex].getAttribute(name), String(value));
    });
  }
  assert.equal(links.at(-1)!.querySelector('.community-feed-category-lock')!.getAttribute('aria-label'), '会员专属');
});

test('switching boards and opening the composer retains the same icons, links, focus and handlers', t => {
  const { document, source, boards } = fixture(t);
  boards.sync(source, '#/community/boards/qa', false);
  const link = boards.element.querySelector<HTMLAnchorElement>('a[href="#/community/boards/qa"]')!;
  const icon = link.querySelector('svg');
  let clicks = 0;
  link.addEventListener('click', event => { event.preventDefault(); clicks++; });
  link.focus();
  for (const hash of ['#/community/boards/tools', '#/community/new/qa?draft=1', '#/community/boards/qa']) boards.sync(source, hash, false);
  assert.equal(boards.element.querySelector('a[href="#/community/boards/qa"]'), link);
  assert.ok(icon);
  assert.equal(link.querySelector('svg'), icon);
  assert.equal(document.activeElement, link);
  assert.equal(link.getAttribute('aria-current'), 'page');
  assert.equal(boards.element.querySelectorAll('[aria-current="page"]').length, 1);
  assert.equal(boards.element.querySelectorAll('svg').length, communityBoards.length);
  link.click();
  assert.equal(clicks, 1);
});

test('icons do not add hidden, disabled, duplicate or unknown board destinations', t => {
  const { source, boards } = fixture(t);
  source.querySelector<HTMLElement>('a[href$="/vip"]')!.hidden = true;
  source.querySelector('a[href$="/meta"]')!.setAttribute('aria-disabled', 'true');
  const container = source.querySelector('.community-boards')!;
  container.append(source.querySelector('a[href$="/qa"]')!.cloneNode(true));
  container.insertAdjacentHTML('beforeend', '<a class="community-board-link" href="#/community/boards/unknown"><span>未知板块</span></a>');
  boards.sync(source, '#/community/home', true);
  assert.deepEqual([...boards.element.querySelectorAll('a')].map(link => link.getAttribute('href')), communityBoards.slice(0, 4).map(board => `#/community/boards/${board.id}`));
  assert.equal(boards.element.getAttribute('aria-label'), 'Boards');
});
