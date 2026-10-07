import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test, type TestContext } from 'node:test';
import { Box, CircleHelp, Coffee, Feather, Image, Megaphone, type IconNode } from 'lucide';
import { communityBoards, communityRoute } from '../../src/community.ts';
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
  const links = [...boards.element.querySelectorAll(':scope > a')];
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
  assert.deepEqual([...boards.element.querySelectorAll(':scope > a')].map(link => link.getAttribute('href')), communityBoards.slice(0, 4).map(board => `#/community/boards/${board.id}`));
  assert.equal(boards.element.getAttribute('aria-label'), 'Boards');
});

test('the board heading opens the existing all-boards route and retains focus across navigation updates', t => {
  const { document, source, boards } = fixture(t);
  boards.sync(source, '#/community/home', false);
  const heading = boards.element.querySelector<HTMLAnchorElement>('h2 > a')!;
  assert.ok(heading, 'the section heading is a keyboard-accessible link');
  assert.equal(heading.textContent, '社区板块');
  assert.equal(heading.getAttribute('title'), '查看所有板块');
  assert.equal(heading.getAttribute('href'), '#/community/boards');
  assert.equal(communityRoute(heading.getAttribute('href')!).view, 'boards');
  assert.equal(heading.hasAttribute('aria-current'), false);
  heading.focus();
  boards.sync(source, '#/community/boards?from=heading', false);
  assert.equal(boards.element.querySelector('h2 > a'), heading);
  assert.equal(document.activeElement, heading);
  assert.equal(heading.getAttribute('aria-current'), 'page');
  assert.equal(boards.element.querySelectorAll('[aria-current="page"]').length, 1);
  boards.sync(source, '#/community/boards/qa', false);
  assert.equal(heading.hasAttribute('aria-current'), false);
  assert.equal(boards.element.querySelector('a[aria-current="page"]')?.getAttribute('href'), '#/community/boards/qa');
  boards.sync(source, '#/community/boards', true);
  const english = boards.element.querySelector<HTMLAnchorElement>('h2 > a')!;
  assert.equal(english.textContent, 'Boards');
  assert.equal(english.getAttribute('title'), 'View all boards');
  assert.equal(english.getAttribute('href'), '#/community/boards');
});

test('membership and language updates retain the all-boards heading and its keyboard focus', t => {
  const { document, source, boards } = fixture(t);
  boards.sync(source, '#/community/boards', false);
  const heading = boards.element.querySelector<HTMLAnchorElement>('h2 > a')!;
  heading.focus();
  source.querySelector<HTMLElement>('.community-board-lock')!.hidden = true;
  boards.sync(source, '#/community/boards', false);
  assert.equal(boards.element.querySelector('h2 > a'), heading);
  assert.equal(document.activeElement, heading);
  assert.equal(heading.getAttribute('aria-current'), 'page');
  assert.equal(boards.element.querySelector('.community-feed-category-lock'), null);
  boards.sync(source, '#/community/boards', true);
  assert.equal(boards.element.querySelector('h2 > a'), heading);
  assert.equal(document.activeElement, heading);
  assert.equal(heading.textContent, 'Boards');
  assert.equal(heading.title, 'View all boards');
});

test('an unchanged summary update does not mutate board navigation or the selected heading', t => {
  const { document, source, boards } = fixture(t);
  boards.sync(source, '#/community/boards', false);
  const observer = new document.defaultView!.MutationObserver(() => {});
  observer.observe(boards.element, { attributes: true, childList: true, subtree: true });
  source.querySelector<HTMLElement>('.community-board-count')!.textContent = '4';
  boards.sync(source, '#/community/boards', false);
  assert.deepEqual(observer.takeRecords(), [], 'a background count refresh does not touch stable sidebar nodes');
  observer.disconnect();
});
