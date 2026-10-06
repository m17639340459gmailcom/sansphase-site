import { createFeedCarousel } from "./feed-carousel.ts";
import { communityBoard, imageSrc } from "../community.ts";
export { communityFrameBannersHTML } from '../community-frame-banners.mjs';

type Highlight = {
  href: string | null;
  title: string;
  board: string;
  image: string | null;
};
type Showcase = {
  section: HTMLElement;
  track: HTMLElement;
  items: Highlight[];
  english: boolean;
  carousel: ReturnType<typeof createFeedCarousel>;
};

const imageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function postLink(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href");
  const id = href && /^#\/post\/([^/?#\s]+)$/.exec(href)?.[1];
  if (!id) return null;
  try {
    if (/[/\\?#\s\u0000-\u001f]/.test(decodeURIComponent(id))) return null;
  } catch { return null; }
  return href;
}

function recommendations(config: HTMLElement | undefined, scope: string, english: boolean): Highlight[] {
  const items: Highlight[] = [];
  const selected = new Set<string>();
  if (config?.dataset.frameBannersState !== 'ready') return items;
  for (const source of config.querySelectorAll<HTMLElement>(':scope > [data-frame-banner-item]')) {
    const title = source.querySelector('[data-frame-banner-title]')?.textContent?.trim() || '';
    const boardId = source.dataset.frameBannerBoard || '';
    const image = source.dataset.frameBannerImage || '';
    if (source.dataset.frameBannerKind === 'image') {
      if (!imageId.test(image) || (scope === 'home' ? boardId !== '' : boardId !== scope)) continue;
      items.push({ href: null, title, board: '', image: imageSrc(image, false) });
      if (items.length === 5) break;
      continue;
    }
    if (source.tagName !== 'A') continue;
    const href = postLink(source as HTMLAnchorElement);
    const board = communityBoard(boardId);
    if (!href || !title || !board || (scope !== 'home' && scope !== boardId) || selected.has(href)) continue;
    items.push({ href, title, board: english ? board.en : board.zh, image: imageId.test(image) ? imageSrc(image, false) : null });
    selected.add(href);
    if (items.length === 5) break;
  }
  return items;
}

function renderShowcase(document: Document, items: Highlight[], english: boolean, title = english ? "Community recommendations" : "社区推荐"): Showcase {
  const section = document.createElement("section");
  section.className = "community-feed-showcase";
  section.setAttribute("aria-label", title);
  section.setAttribute("aria-roledescription", english ? "carousel" : "轮播");
  const heading = document.createElement("div");
  heading.className = "community-feed-showcase-heading";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  heading.append(h2);
  const track = document.createElement("div");
  track.className = "community-feed-showcase-track";
  track.tabIndex = 0;
  track.setAttribute("aria-label", title);
  for (const item of items) {
    const kind = english ? "Recommended" : "推荐";
    const card = document.createElement(item.href ? "a" : "div");
    card.className = `community-feed-showcase-card${item.href ? '' : ' is-image'}`;
    if (item.href) card.setAttribute("href", item.href);
    else { card.setAttribute('role', 'img'); card.setAttribute('aria-label', item.title || (english ? 'Community image banner' : '社区图片横幅')); }
    const art = document.createElement("div");
    art.className = "community-feed-showcase-art";
    art.setAttribute("aria-hidden", "true");
    if (item.image) {
      const image = document.createElement("img");
      image.className = "community-feed-showcase-image";
      image.setAttribute("src", item.image);
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      art.append(image);
    } else art.textContent = kind;
    const copy = document.createElement("div");
    copy.className = "community-feed-showcase-copy";
    for (const [name, text] of [["kind", kind], ["title", item.title], ["meta", item.board]] as const) {
      const label = document.createElement("span");
      label.className = `community-feed-showcase-${name}`;
      label.textContent = text;
      copy.append(label);
    }
    card.append(art);
    if (item.href) card.append(copy);
    track.append(card);
  }
  section.append(track, heading);
  const carousel = createFeedCarousel({ section, track });
  return { section, track, items, english, carousel };
}

/** One consistent banner layout with content scoped to the current home or board. */
export function createSharedFeedShowcase(host: HTMLElement) {
  let showcase: Showcase | null = null;
  let key = '';
  const release = () => { showcase?.carousel.release(); showcase = null; host.replaceChildren(); key = ''; };
  return {
    sync(source: ParentNode, english: boolean, board = '') {
      const frame = host.closest<HTMLElement>('[data-community-frame]');
      if (frame?.dataset.frameView && frame.dataset.frameView !== 'home' && frame.dataset.frameView !== 'board') {
        // The shared shell keeps this slot mounted on other pages. Release its
        // carousel immediately instead of waiting for visibility observers.
        host.hidden = true;
        release();
        return;
      }
      const scope = board || 'home';
      const config = [...source.querySelectorAll<HTMLElement>('[data-frame-banners-state]')].find(node => node.dataset.frameBannersScope === scope);
      const items = recommendations(config, scope, english);
      const loading = config?.dataset.frameBannersState === 'loading';
      const failed = config?.dataset.frameBannersState === 'error';
      const empty = config?.dataset.frameBannersState === 'ready' && items.length === 0;
      // An intentionally empty saved scope has no promotional panel or reserved gap.
      // Leave the frame's other-route visibility alone while restoring a changed scope.
      if (!frame || frame.dataset.frameView === 'home' || frame.dataset.frameView === 'board') host.hidden = empty;
      const nextKey = JSON.stringify([scope, english, loading, failed, empty, items]);
      if (nextKey !== key) {
        release(); key = nextKey;
        if (items.length) {
          showcase = renderShowcase(host.ownerDocument, items, english, board ? english ? 'Board recommendations' : '板块推荐' : undefined);
          host.append(showcase.section);
        } else if (!empty) {
          const placeholder = host.ownerDocument.createElement('div');
          placeholder.className = 'community-frame-showcase-empty';
          placeholder.setAttribute('role', 'status');
          placeholder.textContent = failed ? english ? 'Recommendations are temporarily unavailable' : '暂时无法读取推荐内容'
            : loading ? english ? 'Loading recommendations…' : '正在读取推荐内容…'
            : board ? english ? 'No recommendations in this board yet' : '本板块暂无推荐内容'
            : english ? 'No community recommendations yet' : '暂无社区推荐内容';
          host.append(placeholder);
        }
      }
      showcase?.carousel.refresh();
    },
    release,
  };
}
