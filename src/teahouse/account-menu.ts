import { memberHref, stardustHref, inboxHref, tabHref } from '../community-routing.ts';
import type { TeahouseActor } from '../teahouse-types.ts';

/** The standalone room navigates to the existing community pages at the site root. */
export function createAccountMenu(root: HTMLElement, button: HTMLButtonElement, menu: HTMLElement) {
  let identity = '';
  const items = () => [...menu.querySelectorAll<HTMLAnchorElement>('a')];
  function close(returnFocus = false) {
    const wasOpen = !menu.hidden;
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (wasOpen && returnFocus && !button.disabled) button.focus({ preventScroll: true });
  }
  function open(last = false) {
    if (button.disabled || !menu.childElementCount) return;
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    const links = items(); (last ? links.at(-1) : links[0])?.focus({ preventScroll: true });
  }
  button.addEventListener('click', () => { if (menu.hidden) open(); else close(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (menu.hidden) { open(event.key === 'ArrowUp' || event.key === 'End'); return; }
      const links = items(), current = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links[next]?.focus({ preventScroll: true });
    }
  });
  const closeOutside = (event: Event) => { if (event.target instanceof Node && !root.contains(event.target)) close(); };
  document.addEventListener('pointerdown', closeOutside, true);
  document.addEventListener('click', closeOutside, true);
  document.addEventListener('focusin', closeOutside);
  menu.addEventListener('click', event => { if ((event.target as Element).closest('a')) close(); });
  return {
    update(actor?: TeahouseActor) {
      const next = actor ? JSON.stringify([actor.kind, actor.id, actor.uid]) : '';
      button.disabled = !actor;
      button.title = actor?.name ?? '';
      button.setAttribute('aria-label', actor ? `${actor.name}，打开个人菜单` : '打开个人菜单');
      if (next === identity) return;
      identity = next; close(); menu.replaceChildren();
      if (!actor) return;
      const entries = [
        // Only the authority's public UID can form a profile destination.
        ...(actor.uid && /^(?:owner|[0-9]+)$/.test(actor.uid) ? [[memberHref(actor.uid), 'user-round', '我的主页']] : []),
        [stardustHref(), 'star', '我的星尘'], [inboxHref(), 'bell', '通知'], [tabHref('bookmarks'), 'bookmark', '我的收藏'],
      ];
      for (const [href, iconName, label] of entries) {
        const link = document.createElement('a'), icon = document.createElement('i'), text = document.createElement('span');
        link.href = '/' + href; link.setAttribute('role', 'menuitem');
        icon.dataset.lucide = iconName; icon.setAttribute('aria-hidden', 'true'); text.textContent = label;
        link.append(icon, text); menu.append(link);
      }
    },
  };
}
