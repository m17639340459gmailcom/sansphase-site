import { MessagesSquare, CalendarDays, Gift, Trophy, Plus, type IconNode } from "lucide";

type FeedShellMedia = {
  readonly matches: boolean;
  addEventListener: (type: "change", listener: EventListener) => void;
  removeEventListener: (type: "change", listener: EventListener) => void;
};
export type FeedShellWindow = { matchMedia?: (query: string) => FeedShellMedia };

type NavigationMove = {
  header: HTMLElement;
  layout: HTMLElement;
  nav: HTMLElement;
  rail: HTMLElement;
  marker: Comment;
  originalHeaderFlag: string | null;
  icons: Map<HTMLAnchorElement, { href: string; node: SVGElement }>;
  omittedBoard: { link: HTMLAnchorElement; marker: Comment } | null;
  guidelines: { link: HTMLAnchorElement; marker: Comment } | null;
};

// The same Lucide drawings used by library-ui.tsx's message/calendar/gift/trophy.
const navigationIcons = new Map<string, IconNode>([
  ["#/community/home", MessagesSquare],
  ["#/community/checkin", CalendarDays],
  ["#/community/shop", Gift],
  ["#/community/rank", Trophy],
]);

/** Use the host document so this enhancement also works in isolated preview documents. */
export function navigationIcon(document: Document, drawing: IconNode): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const attributes = {
    class: "ui-icon community-feed-nav-icon", "aria-hidden": "true", focusable: "false",
    viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round",
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  for (const [tag, attributes] of drawing) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, String(value));
    svg.append(shape);
  }
  return svg;
}

function updateNavigationIcons(move: NavigationMove): void {
  for (const [link, { href, node }] of move.icons) {
    if (link.parentNode === move.nav && link.getAttribute("href") === href && node.parentNode === link) continue;
    node.remove();
    move.icons.delete(link);
  }
  for (const link of move.nav.querySelectorAll<HTMLAnchorElement>(":scope > a[href]")) {
    if (move.icons.has(link)) continue;
    const href = link.getAttribute("href")!;
    const drawing = navigationIcons.get(href);
    if (!drawing) continue;
    const node = navigationIcon(move.nav.ownerDocument, drawing);
    link.prepend(node);
    move.icons.set(link, { href, node });
  }
}

function focusedWithin(node: HTMLElement): HTMLElement | null {
  const active = node.ownerDocument.activeElement;
  return active && node.contains(active) ? active as HTMLElement : null;
}

/** The real board strip already supplies these destinations in the desktop feed. */
function omitDuplicateBoard(move: NavigationMove): void {
  if (move.omittedBoard && move.omittedBoard.marker.parentNode !== move.nav) {
    move.omittedBoard.marker.remove();
    move.omittedBoard = null;
  }
  const link = move.nav.querySelector<HTMLAnchorElement>(':scope > a[href="#/community/boards"]');
  if (!link) return;
  // If the app supplied a new link, it owns the new restore point.
  move.omittedBoard?.marker.remove();
  const active = focusedWithin(link);
  const marker = move.nav.ownerDocument.createComment("local feed boards position");
  link.replaceWith(marker);
  move.omittedBoard = { link, marker };
  if (active) move.nav.querySelector<HTMLElement>(':scope > a[aria-current="page"], :scope > a[href="#/community/home"]')?.focus({ preventScroll: true });
}

function restoreBoard(move: NavigationMove): void {
  const omitted = move.omittedBoard;
  if (!omitted) return;
  if (omitted.marker.parentNode === move.nav && !move.nav.querySelector(':scope > a[href="#/community/boards"]')) omitted.marker.replaceWith(omitted.link);
  else omitted.marker.remove();
  move.omittedBoard = null;
}

/** Restore only the original slot; a rebuilt header owns its replacement nav. */
function restore(move: NavigationMove): void {
  const { header, nav, rail, marker, originalHeaderFlag } = move;
  const active = focusedWithin(rail);
  if (move.guidelines) {
    const { link, marker } = move.guidelines;
    if (marker.parentNode === nav && !nav.querySelector('.community-nav-guidelines')) marker.replaceWith(link);
    else marker.remove();
    move.guidelines = null;
  }
  restoreBoard(move);
  for (const { node } of move.icons.values()) node.remove();
  move.icons.clear();
  const replacement = header.querySelector<HTMLElement>(":scope > #navigation");
  const activeHref = active?.closest<HTMLAnchorElement>("a[href]")?.getAttribute("href");
  const replacementFocus = activeHref && replacement
    ? Array.from(replacement.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .find(link => link.getAttribute("href") === activeHref)
    : undefined;
  if (marker.parentNode === header && !replacement) marker.replaceWith(nav);
  else marker.remove();
  rail.remove();
  if (header.getAttribute("data-feed-shell") === "true") {
    if (originalHeaderFlag === null) header.removeAttribute("data-feed-shell");
    else header.setAttribute("data-feed-shell", originalHeaderFlag);
  }
  if (active?.isConnected) active.focus({ preventScroll: true });
  else if (replacementFocus?.isConnected) replacementFocus.focus({ preventScroll: true });
}

function updateRailLinks(move: NavigationMove, main: HTMLElement, boardOnlyCompose: boolean): void {
  const active = focusedWithin(move.rail);
  const post = main.querySelector<HTMLAnchorElement>(boardOnlyCompose ? '[data-community="board"] a.community-post[href]' : 'a.community-post[href]');
  const english = post ? post.textContent?.trim() === "New post"
    : move.nav.querySelector("a")?.textContent?.trim() === "Home";
  let compose = move.rail.querySelector<HTMLAnchorElement>(":scope > .community-feed-rail-compose");
  if (!post) compose?.remove();
  else {
    if (!compose) {
      compose = move.rail.ownerDocument.createElement("a");
      compose.className = "community-feed-rail-compose";
      move.rail.append(compose);
    }
    const href = post.getAttribute("href")!;
    const label = english ? "Publish" : "发布讨论";
    if (compose.getAttribute("href") !== href) compose.setAttribute("href", href);
    let text = compose.querySelector<HTMLElement>('[data-compose-label]');
    if (!text) {
      const plus = navigationIcon(move.rail.ownerDocument, Plus);
      plus.classList.remove('community-feed-nav-icon');
      plus.classList.add('community-compose-icon');
      text = move.rail.ownerDocument.createElement('span');
      text.dataset.composeLabel = '';
      compose.replaceChildren(plus, text);
    }
    if (text.textContent !== label) text.textContent = label;
  }
  let back = move.rail.querySelector<HTMLAnchorElement>(":scope > .community-feed-return");
  if (!back) {
    back = move.rail.ownerDocument.createElement("a");
    back.className = "community-feed-return";
    back.setAttribute("href", "#/home");
    move.rail.append(back);
  }
  const backLabel = english ? "Back to main site" : "返回主站";
  if (back.textContent !== backLabel) back.textContent = backLabel;
  const source = move.nav.querySelector<HTMLAnchorElement>(':scope > .community-nav-guidelines');
  if (move.guidelines && (move.guidelines.marker.parentNode !== move.nav || source)) {
    move.guidelines.link.remove();
    move.guidelines.marker.remove();
    move.guidelines = null;
  }
  if (source) {
    const marker = move.rail.ownerDocument.createComment('community guidelines menu position');
    source.before(marker);
    move.guidelines = { link: source, marker };
  }
  if (move.guidelines) {
    const link = move.guidelines.link;
    if (link.nextElementSibling !== back) back.before(link);
    const label = english ? 'Guidelines' : '社区公约';
    if (link.textContent !== label) link.textContent = label;
    const selected = Boolean(main.querySelector('[data-community="rules"]'));
    if (selected && !link.hasAttribute('aria-current')) link.setAttribute('aria-current', 'page');
    else if (!selected) link.removeAttribute('aria-current');
  }
  const footerStart = move.guidelines?.link || back;
  if (compose?.isConnected && compose.nextElementSibling !== footerStart) footerStart.before(compose);
  if (active?.isConnected && move.rail.ownerDocument.activeElement !== active) active.focus({ preventScroll: true });
}

/** Desktop-only shell. The app keeps ownership of the original nav and every route. */
export function createFeedShell(host: HTMLElement, window: FeedShellWindow, { boards }: { boards?: HTMLElement } = {}): { sync: () => void; release: () => void } {
  const document = host.ownerDocument;
  const narrow = window.matchMedia?.(boards ? '(max-width: 700px)' : '(max-width: 1200px)');
  let move: NavigationMove | null = null;
  let released = false;
  const clear = () => { if (move) restore(move); move = null; };
  const sync = () => {
    if (released) return;
    const header = document.getElementById("site-header");
    const layout = host.querySelector<HTMLElement>(":scope > .community-layout");
    const main = layout?.querySelector<HTMLElement>(":scope > .community-main");
    const ready = Boolean(narrow && !narrow.matches && host.isConnected && header && layout && main);
    if (move && (!ready || header !== move.header || layout !== move.layout
      || move.marker.parentNode !== header || move.nav.parentNode !== move.rail
      || move.rail.parentNode !== layout || header?.querySelector(":scope > #navigation"))) clear();
    if (!ready || !header || !layout || !main) {
      if (boards && main && boards.parentElement !== main) main.prepend(boards);
      return;
    }
    if (!move) {
      const nav = header.querySelector<HTMLElement>(":scope > #navigation.community-nav");
      if (!nav) return;
      const active = focusedWithin(nav);
      const marker = document.createComment("local feed navigation");
      const rail = document.createElement("aside");
      rail.className = "community-feed-rail";
      move = { header, layout, nav, rail, marker, originalHeaderFlag: header.getAttribute("data-feed-shell"), icons: new Map(), omittedBoard: null, guidelines: null };
      nav.before(marker);
      rail.append(nav);
      main.before(rail);
      header.setAttribute("data-feed-shell", "true");
      if (active?.isConnected) active.focus({ preventScroll: true });
    }
    omitDuplicateBoard(move);
    updateNavigationIcons(move);
    if (boards && (boards.parentElement !== move.rail || boards.previousElementSibling !== move.nav)) move.nav.after(boards);
    updateRailLinks(move, main, Boolean(boards));
  };
  const onBreakpoint: EventListener = () => sync();
  narrow?.addEventListener("change", onBreakpoint);
  return {
    sync,
    release: () => {
      if (released) return;
      released = true;
      narrow?.removeEventListener("change", onBreakpoint);
      clear();
    },
  };
}
