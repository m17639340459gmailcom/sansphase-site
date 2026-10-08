import A11yDialog from 'a11y-dialog';
import { communityShopDetailHTML } from './community-pages.mjs';
import type { CommunityShopDetail } from './community-pages.ts';

type Options = {
  data: (id: string) => CommunityShopDetail | null;
  click: (event: Event) => void;
  returnFocus: (id: string, artwork: boolean) => HTMLElement | null;
};

const holoProperties = ['--holo-rx', '--holo-ry', '--holo-x', '--holo-y'];
const cardStage = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('.community-sitem-art, .community-shop-detail-art') : null;

export function communityShopCardMaterials(root: ParentNode) {
  for (const art of root.querySelectorAll<HTMLElement>('.community-holo.is-uploaded[data-community-card-art]')) {
    const image = art.querySelector<HTMLImageElement>('img.community-product-image');
    if (!image) continue;
    // Relative URLs substituted into CDN CSS resolve against that stylesheet.
    // Use the image's existing absolute document URL for the matching mask.
    const url = new URL(image.src, art.ownerDocument.baseURI);
    if (url.origin !== art.ownerDocument.location?.origin || !/^\/api\/community\/images\/[0-9a-f-]{36}\.webp$/.test(url.pathname)) continue;
    const value = `url("${url.href}")`;
    if (art.style.getPropertyValue('--card-image') !== value) art.style.setProperty('--card-image', value);
  }
}

// Update only card artwork while a pointer actually moves over it. No frame
// loop, persistent promoted layer or work on the document's scroll path.
export function communityShopCardPointer(event: PointerEvent) {
  const stage = cardStage(event.target);
  const art = stage?.querySelector<HTMLElement>('[data-community-card-art]');
  if (!stage || !art || event.pointerType === 'touch' || stage.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  art.style.setProperty('--holo-rx', `${((.5 - y) * 6).toFixed(1)}deg`);
  art.style.setProperty('--holo-ry', `${((x - .5) * 8).toFixed(1)}deg`);
  art.style.setProperty('--holo-x', `${Math.round(x * 100)}%`);
  art.style.setProperty('--holo-y', `${Math.round(y * 100)}%`);
}

export function communityShopCardExit(event: PointerEvent) {
  const stage = cardStage(event.target);
  if (!stage || event.type !== 'pointercancel' && event.relatedTarget instanceof Node && stage.contains(event.relatedTarget)) return;
  const art = stage.querySelector<HTMLElement>('[data-community-card-art]');
  if (art) for (const property of holoProperties) art.style.removeProperty(property);
}

// Match the profile editor's existing modal lifecycle: mounted under body,
// A11yDialog owns Escape/Tab, and closing restores each background inert state.
export function createCommunityShopDialog(options: Options) {
  let layer: HTMLElement | null = null;
  let dialog: A11yDialog | null = null;
  let selected = '';
  let markup = '';
  let opener: HTMLElement | null = null;
  let openedFromArt = false;
  let closing = false;
  let overflow = '';
  const background = new Map<HTMLElement, boolean>();

  function restoreBackground() {
    for (const [node, wasInert] of background) node.inert = wasInert;
    background.clear();
    if (layer) layer.ownerDocument.body.style.overflow = overflow;
  }
  function close() {
    if (!layer || closing) return;
    closing = true;
    dialog?.hide();
    restoreBackground();
    // Detach before destroy, which otherwise clones an attached container.
    layer.remove(); dialog?.destroy(); dialog = null;
    (opener?.isConnected ? opener : options.returnFocus(selected, openedFromArt))?.focus({ preventScroll: true });
    layer = null; selected = ''; markup = ''; opener = null; closing = false;
  }
  function sync() {
    if (!layer) return;
    const data = options.data(selected);
    if (!data) { close(); return; }
    const next = communityShopDetailHTML(data);
    if (next === markup) return;
    const host = layer.ownerDocument;
    const active = host.activeElement;
    const focusedAction = active instanceof HTMLElement && layer.contains(active) ? active.dataset.action : null;
    const scroll = layer.querySelector('.community-shop-detail-content')?.scrollTop || 0;
    const art = layer.querySelector('.community-shop-detail-art');
    const image = layer.querySelector<HTMLImageElement>('.community-shop-detail-art img');
    const template = host.createElement('template'); template.innerHTML = next;
    const nextArt = template.content.querySelector('.community-shop-detail-art');
    const nextImage = template.content.querySelector<HTMLImageElement>('.community-shop-detail-art img');
    const previous = host.createElement('template'); previous.innerHTML = markup;
    // Pointer variables are transient DOM state. Compare the original art
    // snapshots so stock/text refreshes preserve the live sheen and tilt.
    if (art && nextArt && previous.content.querySelector('.community-shop-detail-art')?.outerHTML === nextArt.outerHTML) nextArt.replaceWith(art);
    else if (image && nextImage && image.getAttribute('src') === nextImage.getAttribute('src')) { image.alt = nextImage.alt; nextImage.replaceWith(image); }
    // Keep the close/backdrop nodes, whose listeners belong to A11yDialog.
    const nextContent = template.content.querySelector('.community-shop-detail-content');
    if (!nextContent) return;
    layer.querySelector('.community-shop-detail-content')?.replaceWith(nextContent);
    communityShopCardMaterials(layer);
    const title = layer.querySelector('#community-shop-detail-title'); if (title) title.textContent = data.item.name;
    markup = next;
    const content = layer.querySelector('.community-shop-detail-content'); if (content) content.scrollTop = scroll;
    if (active instanceof HTMLElement && layer.contains(active)) {
      active.focus({ preventScroll: true });
    } else if (active && active !== host.body) {
      const control = [...layer.querySelectorAll<HTMLElement>('[data-action]')].find(node => node.dataset.action === focusedAction);
      (control || layer.querySelector<HTMLElement>('[data-shop-detail-close]'))?.focus({ preventScroll: true });
    }
  }
  function open(host: Document, id: string, trigger: HTMLElement) {
    const data = options.data(id);
    if (!data) return;
    close(); selected = id; opener = trigger; openedFromArt = trigger.classList.contains('community-sitem-art');
    layer = host.createElement('div'); layer.id = 'community-shop-dialog'; layer.className = 'community-shop-dialog';
    layer.setAttribute('aria-labelledby', 'community-shop-detail-title');
    markup = communityShopDetailHTML(data); layer.innerHTML = markup;
    communityShopCardMaterials(layer);
    layer.addEventListener('click', options.click);
    layer.addEventListener('pointermove', communityShopCardPointer, { passive: true });
    layer.addEventListener('pointerout', communityShopCardExit, { passive: true });
    layer.addEventListener('pointercancel', communityShopCardExit, { passive: true });
    host.body.append(layer); dialog = new A11yDialog(layer);
    dialog.on('hide', () => { restoreBackground(); if (!closing) queueMicrotask(close); });
    overflow = host.body.style.overflow;
    for (const node of host.body.children) {
      if (node === layer || !(node instanceof HTMLElement) || node.matches('script, style, link')) continue;
      background.set(node, Boolean(node.inert)); node.inert = true;
    }
    host.body.style.overflow = 'hidden'; dialog.show();
  }
  return { open, sync, close };
}
