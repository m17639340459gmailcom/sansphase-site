import { Box, CircleHelp, Coffee, Feather, Image, Megaphone, type IconNode } from 'lucide';
import { communityBoard } from '../community.ts';
import { readCategories } from './board-links.ts';
import { navigationIcon } from './feed-shell.ts';

// Match the board icons already defined in community.ts and library-ui.tsx.
const boardIcons = new Map<string, IconNode>([
  ['help', CircleHelp], ['image', Image], ['box', Box],
  ['feather', Feather], ['megaphone', Megaphone], ['coffee', Coffee],
]);

/** The same authorized board links as the homepage, with stable navigation nodes. */
export function createFrameBoards(document: Document) {
  const nav = document.createElement('nav');
  nav.dataset.frameBoards = '';
  nav.className = 'community-frame-boards';
  const title = document.createElement('h2');
  const allBoards = document.createElement('a');
  allBoards.href = '#/community/boards';
  title.append(allBoards);
  nav.append(title);
  let key = '';
  return {
    element: nav,
    sync(source: ParentNode, hash: string, english: boolean) {
      const boards = source.querySelector<HTMLElement>('.community-boards');
      const items = boards ? readCategories(boards) : [];
      const label = english ? 'Boards' : '社区板块';
      const hint = english ? 'View all boards' : '查看所有板块';
      if (allBoards.textContent !== label) allBoards.textContent = label;
      if (allBoards.title !== hint) allBoards.title = hint;
      if (nav.getAttribute('aria-label') !== label) nav.setAttribute('aria-label', label);
      const nextKey = JSON.stringify([items, english]);
      if (key !== nextKey) {
        key = nextKey;
        for (const link of nav.querySelectorAll(':scope > a')) link.remove();
        nav.append(...items.map(item => {
          const link = document.createElement('a');
          link.href = item.href;
          link.textContent = item.label;
          const id = item.href.split('/').at(-1)!;
          const board = communityBoard(id);
          link.style.setProperty('--board', board?.color || '#aeb3bd');
          link.style.setProperty('--board-light', board?.lightColor || '#52637b');
          const drawing = board && boardIcons.get(board.icon);
          if (drawing) {
            const icon = navigationIcon(document, drawing);
            icon.classList.add('community-frame-board-icon');
            link.prepend(icon);
          }
          if (item.lock) {
            const lock = document.createElement('span');
            lock.className = 'community-feed-category-lock';
            lock.textContent = 'VIP';
            lock.setAttribute('aria-label', item.lock);
            link.append(lock);
          }
          return link;
        }));
      }
      const selected = hash.split('?')[0].replace('#/community/new/', '#/community/boards/');
      for (const link of nav.querySelectorAll('a')) {
        if (link.getAttribute('href') === selected) {
          if (link.getAttribute('aria-current') !== 'page') link.setAttribute('aria-current', 'page');
        } else if (link.hasAttribute('aria-current')) link.removeAttribute('aria-current');
      }
    },
  };
}
