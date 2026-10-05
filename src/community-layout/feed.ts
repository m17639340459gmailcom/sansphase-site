import { imageSrc } from "../community.ts";
import { createFeedPublicationTime } from "./feed-publication-time.ts";

type ReversibleMove = { current: () => boolean; restore: () => void };

type BannerPlacement = { node: HTMLElement; main: HTMLElement; marker: Comment };
type OverviewPlacement = { side: HTMLElement; card: HTMLElement; title: HTMLElement; banner: HTMLElement; marker: Comment };

/** Keep the real banner and account controls, even when the controller replaces a column. */
function createFeedHeader(host: HTMLElement) {
  let banner: BannerPlacement | null = null;
  let overview: OverviewPlacement | null = null;
  const restoreOverview = () => {
    if (!overview) return;
    const { card, marker, banner: source } = overview;
    const side = card.querySelector<HTMLElement>(":scope > .community-banner-side");
    // A new summary in the source banner takes precedence over an older moved one.
    if (side && marker.parentNode === source && !source.querySelector(":scope > .community-banner-side")) marker.replaceWith(side);
    else marker.remove();
    card.remove();
    overview = null;
  };
  return {
    sync: () => {
      const layout = host.querySelector<HTMLElement>(":scope > .community-layout");
      const main = layout?.querySelector<HTMLElement>(":scope > .community-main");
      const aside = layout?.querySelector<HTMLElement>(":scope > .community-aside");
      if (!layout || !main || !aside) return;
      const outer = host.querySelector<HTMLElement>(":scope > .community-banner");
      const inner = main.querySelector<HTMLElement>(":scope > .community-banner");
      if (banner && banner.marker.parentNode !== host) {
        restoreOverview();
        banner.marker.remove();
        banner = null;
      }
      if (banner) {
        // The banner originally lived outside main: retain it when only the list
        // column changes, while always preferring a new banner supplied by the app.
        const next = outer || inner || (main !== banner.main && banner.node.parentElement === banner.main ? banner.node : null);
        if (next !== banner.node) restoreOverview();
        if (next) banner.node = next;
        else { banner.marker.remove(); banner = null; }
      }
      if (!banner) {
        const node = outer || inner;
        if (!node) return;
        const marker = host.ownerDocument.createComment("local feed banner position");
        if (node.parentElement === host) node.before(marker);
        else layout.before(marker);
        banner = { node, main, marker };
      }
      banner.main = main;
      if (main.firstElementChild !== banner.node) main.prepend(banner.node);

      const source = banner.node;
      const sideAtSource = source.querySelector<HTMLElement>(":scope > .community-banner-side");
      if (overview && (overview.banner !== source || sideAtSource || overview.marker.parentNode !== source)) restoreOverview();
      if (overview) {
        const currentSide = overview.card.querySelector<HTMLElement>(":scope > .community-banner-side");
        if (currentSide) overview.side = currentSide;
        else restoreOverview();
      }
      if (!overview) {
        const side = source.querySelector<HTMLElement>(":scope > .community-banner-side");
        if (!side) return;
        const document = host.ownerDocument;
        const marker = document.createComment("local feed summary position");
        side.before(marker);
        const card = document.createElement("section");
        card.className = "community-feed-overview community-card";
        const heading = document.createElement("header");
        heading.className = "community-card-h";
        const title = document.createElement("h2");
        heading.append(title);
        card.append(heading, side);
        overview = { side, card, title, banner: source, marker };
      }
      if (aside.firstElementChild !== overview.card) aside.prepend(overview.card);
      const title = source.querySelector("h1")?.textContent?.trim() === "Community" ? "Community activity" : "社区动态";
      if (overview.title.textContent !== title) overview.title.textContent = title;
    },
    release: () => {
      restoreOverview();
      if (!banner) return;
      const outer = host.querySelector<HTMLElement>(":scope > .community-banner");
      const main = host.querySelector<HTMLElement>(":scope > .community-layout > .community-main");
      const current = main?.querySelector<HTMLElement>(":scope > .community-banner")
        || (banner.node.parentElement === banner.main ? banner.node : null);
      if (!outer && current && banner.marker.parentNode === host) banner.marker.replaceWith(current);
      else banner.marker.remove();
      banner = null;
    },
  };
}

/** Only the exact existing community thumbnail route is eligible; unknown URLs stay untouched. */
function useFullImage(image: HTMLImageElement): ReversibleMove | null {
  const original = image.getAttribute("src");
  if (!original || image.hasAttribute("srcset")) return null;
  let url: URL;
  try { url = new URL(original, image.ownerDocument.baseURI); } catch { return null; }
  if (url.origin !== new URL(image.ownerDocument.baseURI).origin || url.search || url.hash) return null;
  const id = /^\/api\/community\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.thumb\.webp$/.exec(url.pathname)?.[1];
  if (!id) return null;
  const full = imageSrc(id, false);
  image.setAttribute("src", full);
  return {
    current: () => image.getAttribute("src") === full && !image.hasAttribute("srcset"),
    restore: () => {
      // Do not overwrite a new source provided by the application's renderer.
      if (image.getAttribute("src") === full) image.setAttribute("src", original);
    },
  };
}

/** Keep the existing avatar with its author/time; markers retain their exact original positions. */
export function moveByline(topic: HTMLElement): ReversibleMove | null {
  const main = topic.querySelector<HTMLElement>(":scope > .community-topic-main");
  const meta = main?.querySelector<HTMLElement>(":scope > .community-topic-meta");
  const who = meta?.querySelector<HTMLElement>(":scope > .community-who");
  const time = meta?.querySelector<HTMLTimeElement>(":scope > time");
  if (!main || !meta || !who || !time) return null;
  const document = topic.ownerDocument;
  const avatar = topic.querySelector<HTMLElement>(":scope > .community-av");
  const byline = document.createElement("div");
  byline.className = "community-feed-byline";
  const moved = [...(avatar ? [avatar] : []), who, time].map(node => {
    const parent = node.parentNode;
    const marker = document.createComment("local feed byline");
    node.before(marker);
    byline.append(node);
    return { node, marker, parent };
  });
  main.prepend(byline);
  return {
    current: () => main.parentElement === topic && meta.parentElement === main
      && byline.parentElement === main
      && moved.every(({ node, marker, parent }) => node.parentElement === byline && marker.parentNode === parent),
    restore: () => {
      for (const { node, marker } of moved) {
        // A replaced subtree can be detached; it still deserves its original DOM back.
        if (marker.parentNode) marker.replaceWith(node);
      }
      byline.remove();
    },
  };
}

/** DOM reading order follows the feed's left main column and right sidebar. */
function moveMainBeforeAside(host: HTMLElement): ReversibleMove | null {
  const layout = host.querySelector<HTMLElement>(":scope > .community-layout");
  const main = layout?.querySelector<HTMLElement>(":scope > .community-main");
  const aside = layout?.querySelector<HTMLElement>(":scope > .community-aside");
  if (!layout || !main || !aside) return null;
  const children = Array.from(layout.children);
  if (children.indexOf(main) < children.indexOf(aside)) return null;
  const marker = host.ownerDocument.createComment("local feed column order");
  main.before(marker);
  aside.before(main);
  const currentMain = () => layout.querySelector<HTMLElement>(":scope > .community-main");
  return {
    current: () => layout.parentElement === host && currentMain() !== null
      && aside.parentElement === layout && marker.parentNode === layout,
    restore: () => {
      // Keep a replacement main, restoring its position without reviving old content.
      const nextMain = currentMain();
      if (nextMain && marker.parentNode === layout) marker.replaceWith(nextMain);
      else marker.remove();
    },
  };
}

/** Reuses the community runtime's observer; a stable sync performs no DOM mutations. */
export function createFeedLayout(host: HTMLElement): { sync: () => void; release: () => void } {
  const bylines = new Map<HTMLElement, ReversibleMove>();
  const images = new Map<HTMLImageElement, ReversibleMove>();
  const header = createFeedHeader(host);

  const publicationTime = createFeedPublicationTime(host);
  let columns: ReversibleMove | null = null;
  return {
    sync: () => {
      if (columns && !columns.current()) {
        columns.restore();
        columns = null;
      }
      columns ??= moveMainBeforeAside(host);
      if (host.dataset.community !== 'board') header.sync();
      for (const [topic, byline] of bylines) {
        if (host.contains(topic) && byline.current()) continue;
        byline.restore();
        bylines.delete(topic);
      }
      for (const topic of host.querySelectorAll<HTMLElement>(".community-topic")) {
        if (bylines.has(topic)) continue;
        const byline = moveByline(topic);
        if (byline) bylines.set(topic, byline);
      }
      for (const [image, source] of images) {
        if (host.contains(image) && source.current()) continue;
        source.restore();
        images.delete(image);
      }
      for (const image of host.querySelectorAll<HTMLImageElement>(".community-topic-thumbs img")) {
        if (images.has(image)) continue;
        const source = useFullImage(image);
        if (source) images.set(image, source);
      }

      publicationTime.sync();
    },
    release: () => {

      publicationTime.release();
      for (const byline of bylines.values()) byline.restore();
      bylines.clear();
      for (const source of images.values()) source.restore();
      images.clear();
      header.release();
      columns?.restore();
      columns = null;
    },
  };
}
