import { communityBoardDrawings } from '../community-board-drawings.ts';
import type { IconNode } from 'lucide';
import { readCategories } from './board-links.ts';
import { navigationIcon } from './feed-shell.ts';
import { sidebarCommunityBoards } from './sidebar-boards.ts';

const boardIcons = new Map<string, IconNode>(Object.entries(communityBoardDrawings));

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
  const iconNames = new WeakMap<HTMLAnchorElement, string>();
  return {
    element: nav,
    sync(source: ParentNode, hash: string, english: boolean) {
      const boards = source.querySelector<HTMLElement>('.community-boards');
      const items = boards ? sidebarCommunityBoards(readCategories(boards)) : [];
      const label = english ? 'Boards' : '社区板块';
      const hint = english ? 'View all boards' : '查看所有板块';
      if (allBoards.textContent !== label) allBoards.textContent = label;
      if (allBoards.title !== hint) allBoards.title = hint;
      if (nav.getAttribute('aria-label') !== label) nav.setAttribute('aria-label', label);
      const nextKey = JSON.stringify([items, english]);
      if (key !== nextKey) {
        key = nextKey;
        const focused = document.activeElement;
        const wasFocused = Boolean(focused && nav.contains(focused));
        const existing = new Map([...nav.querySelectorAll<HTMLAnchorElement>(':scope > a')].map(link => [link.getAttribute('href'), link]));
        const retained = new Set<HTMLAnchorElement>();
        items.forEach((item, index) => {
          const link = existing.get(item.href) || document.createElement('a');
          if (link.getAttribute('href') !== item.href) link.setAttribute('href', item.href);
          let text = [...link.childNodes].find(node => node.nodeType === 3) as Text | undefined;
          if (!text) { text = document.createTextNode(item.label); link.append(text); }
          else if (text.data !== item.label) text.data = item.label;
          const color = item.color, lightColor = item.lightColor;
          if (link.style.getPropertyValue('--board') !== color) link.style.setProperty('--board', color);
          if (link.style.getPropertyValue('--board-light') !== lightColor) link.style.setProperty('--board-light', lightColor);
          const iconName = item.icon;
          if (iconNames.get(link) !== iconName) {
            link.querySelector('.community-frame-board-icon')?.remove();
            const drawing = boardIcons.get(iconName);
            if (drawing) {
              const icon = navigationIcon(document, drawing);
              icon.classList.add('community-frame-board-icon');
              link.prepend(icon);
            }
            iconNames.set(link, iconName);
          }
          let lock = link.querySelector<HTMLElement>(':scope > .community-feed-category-lock');
          if (item.lock) {
            if (!lock) { lock = document.createElement('span'); lock.className = 'community-feed-category-lock'; lock.textContent = 'VIP'; link.append(lock); }
            if (lock.getAttribute('aria-label') !== item.lock) lock.setAttribute('aria-label', item.lock);
          } else lock?.remove();
          retained.add(link);
          if (nav.children[index + 1] !== link) nav.insertBefore(link, nav.children[index + 1] || null);
        });
        for (const link of existing.values()) if (!retained.has(link)) link.remove();
        // Moving a focused anchor can blur it in some browsers. Restore only
        // that existing node, without scrolling or replacing its listeners.
        if (wasFocused && document.activeElement !== focused) {
          if (focused?.isConnected) (focused as HTMLElement).focus({ preventScroll: true });
          else allBoards.focus({ preventScroll: true });
        }
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
