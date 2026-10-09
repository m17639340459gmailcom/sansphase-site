import { communityRoute, defaultCommunityBoards, inCommunityArea } from '../community.ts';
import { createFeedShell } from './feed-shell.ts';
import { enhanceTrending } from './trending.ts';
import { createFrameBoards } from './frame-boards.ts';
import { createSharedFeedShowcase } from './feed-showcase.ts';
import { createFrameThreadSidebar } from './frame-thread-sidebar.ts';
import { readCategories } from './board-links.ts';
import { createCommunityLevelMotion, levelMotionMarkup } from './level-motion.ts';

type FrameWindow = Pick<Window, 'location' | 'matchMedia'> & Partial<Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame' | 'history'>>;
/** Persistent community shell; the controller owns routes, identity and writes. */
export function createStableCommunityFrame(document: Document, window: FrameWindow, request?: typeof fetch) {
  let root: HTMLElement | null = null;
  let center: HTMLElement | null = null;
  let routeSlot: HTMLElement | null = null;
  let showcaseSlot: HTMLElement | null = null;
  let showcase: ReturnType<typeof createSharedFeedShowcase> | null = null;
  const boards = createFrameBoards(document);
  let right: HTMLElement | null = null;
  let checkinDock: HTMLElement | null = null;
  let navigation: ReturnType<typeof createFeedShell> | null = null;
  let releaseTrending: (() => void) | null = null;
  let threadSidebar: ReturnType<typeof createFrameThreadSidebar> | null = null;
  let currentHash = '';
  let navigationHash: string | null = null;
  let pendingHandoff: { hash: string; reset: boolean; top: number } | null = null;
  let sideKey = '';
  let hotKey = '';
  let restoreTop: number | null = null;
  let scrollFrame: number | null = null;
  let scrollRevision = 0;
  let historyRestoration: ScrollRestoration | null = null;
  let readingFloor: { slot: HTMLElement; minHeight: string; height: number } | null = null;
  // Match the stable-frame.css breakpoints so controls follow visible columns.
  const compact = window.matchMedia?.('(max-width: 1240px)');
  const mobile = window.matchMedia?.('(max-width: 700px)');
  let mobileLayout = Boolean(mobile?.matches);
  let lastScrollTop = 0;
  let scrollbarTimer: ReturnType<typeof setTimeout> | null = null;
  let decorationTimer: ReturnType<typeof setTimeout> | null = null;
  let levelMotion: ReturnType<typeof createCommunityLevelMotion> | null = null;
  const resumeDecoration = () => {
    if (decorationTimer !== null) clearTimeout(decorationTimer);
    decorationTimer = null;
    document.body.style.removeProperty('--community-decoration-play-state');
    levelMotion?.resume();
  };
  const pauseDecoration = () => {
    // The header and reading frame inherit one decorative pause. Preserve all
    // content and never rewrite styles on every scroll event or promote icons.
    if (decorationTimer === null) document.body.style.setProperty('--community-decoration-play-state', 'paused');
    else clearTimeout(decorationTimer);
    levelMotion?.pause();
    decorationTimer = setTimeout(resumeDecoration, 600);
  };
  const hideScrollbar = () => {
    if (scrollbarTimer !== null) clearTimeout(scrollbarTimer);
    scrollbarTimer = null;
    center?.removeAttribute('data-frame-scrolling');
    document.documentElement.removeAttribute('data-frame-scrolling');
  };
  const showScrollbar = () => {
    if (scrollbarTimer !== null) clearTimeout(scrollbarTimer);
    const target = mobileLayout ? document.documentElement : center;
    if (target && !target.hasAttribute('data-frame-scrolling')) target.setAttribute('data-frame-scrolling', 'true');
    scrollbarTimer = setTimeout(hideScrollbar, 5000);
  };
  // Desktop scrolls the center column; narrow layouts use the document viewport.
  const scrollHost = () => mobileLayout
    ? document.scrollingElement || document.documentElement : center;
  const readTop = () => scrollHost()?.scrollTop || 0;
  const writeTop = (top: number) => {
    const host = scrollHost();
    if (host) { host.scrollTop = top; lastScrollTop = host.scrollTop; }
  };
  const rememberScroll = (event: Event) => {
    // A resize can clamp the old scroll container before matchMedia dispatches.
    // Keep its last user position until the new scroll host takes over.
    if (mobileLayout !== Boolean(mobile?.matches)) return;
    if (event.target === scrollHost() || (mobileLayout && event.target === document)) {
      const top = readTop();
      // writeTop records programmatic restoration before its scroll event fires.
      if (top !== lastScrollTop) { showScrollbar(); pauseDecoration(); }
      lastScrollTop = top;
    } else if (event.target instanceof document.defaultView!.Element && root?.contains(event.target)) {
      // Independent reading sidebars share the same motion pause, while the
      // main scroll position and scrollbar activity keep their own owner.
      pauseDecoration();
    }
  };
  const scrollInputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  const enabled = () => { const view = communityRoute(window.location.hash).view; return view !== 'manage' && inCommunityArea(view); };
  const fragment = (html: string) => {
    const template = document.createElement('template'); template.innerHTML = html;
    return template.content;
  };
  const cancelScrollRestore = () => {
    scrollRevision++;
    if (scrollFrame !== null) window.cancelAnimationFrame?.(scrollFrame);
    scrollFrame = null;
    restoreTop = null;
  };
  const loading = () => Boolean(routeSlot?.querySelector('[aria-busy="true"]'));
  const releaseReadingHeight = () => {
    if (readingFloor) readingFloor.slot.style.minHeight = readingFloor.minHeight;
    readingFloor = null;
  };
  const preserveReadingHeight = () => {
    if (!routeSlot || (!readingFloor && readTop() <= 0)) return;
    const height = routeSlot.getBoundingClientRect().height;
    if (height <= 0) return;
    readingFloor ??= { slot: routeSlot, minHeight: routeSlot.style.minHeight, height };
    readingFloor.height = Math.max(readingFloor.height, height);
    routeSlot.style.minHeight = `${Math.ceil(readingFloor.height)}px`;
  };
  const onScrollInput = () => {
    cancelScrollRestore();
    if (!loading()) releaseReadingHeight();
  };
  const restoreAfterLayout = (top: number) => {
    cancelScrollRestore();
    const revision = scrollRevision;
    restoreTop = top;
    writeTop(top);
    const finish = () => {
      if (revision !== scrollRevision) return;
      scrollFrame = null;
      writeTop(top);
      // Keep enough space throughout loading, then allow final short content
      // to settle at its valid limit without leaving empty page padding.
      if (!loading()) { releaseReadingHeight(); writeTop(top); restoreTop = null; }
    };
    if (window.requestAnimationFrame) scrollFrame = window.requestAnimationFrame(finish);
    else finish();
  };
  const preserveReadingPosition = () => {
    const hash = currentHash, revision = scrollRevision, top = restoreTop ?? readTop();
    if (pendingHandoff) pendingHandoff.top = top;
    preserveReadingHeight();
    const restoreFocus = threadSidebar?.preserveFocus();
    return () => { if (center && currentHash === hash && revision === scrollRevision) { restoreAfterLayout(top); restoreFocus?.(); } };
  };
  const resetToTop = () => {
    if (!center) return;
    resumeDecoration();
    hideScrollbar();
    releaseReadingHeight();
    restoreAfterLayout(0);
  };
  const onCurrentRouteClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest?.<HTMLAnchorElement>('a[href^="#/"]');
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    if (!link.closest('.community-feed-rail .nav, .community-feed-rail > .community-nav-guidelines, .community-frame-boards, #site-header .community-nav')) return;
    const href = link.getAttribute('href');
    if (href !== currentHash) { navigationHash = href; return; }
    // A repeated route click has no hashchange. Do not remount or refetch it.
    event.preventDefault();
    if (pendingHandoff) { pendingHandoff.reset = true; return; }
    resetToTop();
  };
  const placeCheckin = () => {
    if (!right || !checkinDock) return;
    if (root?.dataset.frameView === 'post') { checkinDock.hidden = true; return; }
    const side = right.querySelector('.community-banner-side');
    const pill = checkinDock.querySelector('.community-ck-pill') || side?.querySelector('.community-ck-pill');
    const target = compact?.matches ? checkinDock : side;
    if (pill && target && pill.parentElement !== target) {
      const active = document.activeElement;
      const restoreFocus = active && pill.contains(active);
      target.append(pill);
      checkinDock.hidden = !compact?.matches;
      if (restoreFocus) (active as HTMLElement).focus({ preventScroll: true });
    }
    checkinDock.hidden = !compact?.matches || !pill;
  };
  const onBreakpoint = () => {
    if (!root) return;
    const changed = mobileLayout !== Boolean(mobile?.matches);
    const top = restoreTop ?? (changed ? lastScrollTop : readTop());
    if (changed) hideScrollbar();
    mobileLayout = Boolean(mobile?.matches);
    placeCheckin();
    threadSidebar?.sync(root.dataset.frameView === 'post', Boolean(compact?.matches));
    // Crossing into document scrolling must not reset the page or remount a draft.
    if (changed) restoreAfterLayout(top);
  };
  const dispose = () => {
    levelMotion?.release(); levelMotion = null;
    resumeDecoration();
    hideScrollbar();
    cancelScrollRestore();
    releaseReadingHeight();
    compact?.removeEventListener('change', onBreakpoint);
    mobile?.removeEventListener('change', onBreakpoint);
    document.removeEventListener('scroll', rememberScroll, true);
    document.removeEventListener('click', onCurrentRouteClick);
    for (const event of scrollInputs) document.removeEventListener(event, onScrollInput, true);
    if (historyRestoration !== null && window.history) window.history.scrollRestoration = historyRestoration;
    historyRestoration = null;
    threadSidebar?.release(); threadSidebar = null;
    showcase?.release(); showcase = null; showcaseSlot = routeSlot = null;
    navigation?.release(); navigation = null;
    releaseTrending?.(); releaseTrending = null;
    root?.remove(); root = center = right = checkinDock = null;
    currentHash = sideKey = hotKey = '';
    navigationHash = null;
    pendingHandoff = null;
    lastScrollTop = 0;
    document.body.classList.remove('community-frame-open');
    document.documentElement.classList.remove('community-frame-document');
  };
  const sync = (homeHTML: string) => {
    if (!root || !right) return;
    // The controller owns the authority/core gate. Keep the actual old route
    // and its supporting DOM together while waiting, without disabling rail
    // navigation. New scope data is installed only at the real handoff.
    if (routeSlot?.querySelector('[data-community-pending-route="true"]')) { navigation?.sync(); return; }
    if (pendingHandoff?.hash === currentHash) {
      const handoff = pendingHandoff; pendingHandoff = null;
      if (handoff.reset) resetToTop(); else restoreAfterLayout(handoff.top);
    }
    const data = fragment(homeHTML);
    const english = document.documentElement.lang.startsWith('en');
    const current = communityRoute(window.location.hash), view = current.view;
    const activityBoard = data.querySelector<HTMLElement>('[data-frame-board]')?.dataset.frameBoard || '';
    const boardNavigation = data.querySelector<HTMLElement>('.community-boards');
    const board = defaultCommunityBoards.find(item => item.id === activityBoard);
    const boardLabel = (boardNavigation ? readCategories(boardNavigation).find(item => item.id === activityBoard)?.label : null)
      || (board ? english ? board.en : board.zh : '');
    root.dataset.frameView = view;
    root.dataset.frameBoard = activityBoard;
    boards.sync(data, window.location.hash, english);
    if (showcaseSlot) showcaseSlot.hidden = view !== 'home' && view !== 'board';
    showcase?.sync(data, english, view === 'board' ? current.board : '');
    const side = data.querySelector<HTMLElement>('.community-banner-side');
    const overview = right.querySelector<HTMLElement>('[data-frame-overview]');
    if (overview) overview.hidden = view === 'post';
    if (side && overview && side.innerHTML !== sideKey) {
      sideKey = side.innerHTML;
      const existing = overview.querySelector<HTMLElement>('.community-banner-side');
      if (!existing) overview.append(side);
      else {
        // Counters update without replacing the card or an unchanged check-in button.
        for (const selector of ['.community-stats', '.community-ck-pill']) {
          const old = existing.querySelector(selector) || (selector === '.community-ck-pill' ? checkinDock?.querySelector(selector) : null);
          const next = side.querySelector(selector);
          if (old?.outerHTML === next?.outerHTML) continue;
          if (old && next) old.replaceWith(next);
          else if (next) existing.append(next);
          else old?.remove();
        }
      }
    }
    const title = overview?.querySelector('h2');
    const label = boardLabel ? english ? `${boardLabel} activity` : `${boardLabel}动态` : english ? 'Community activity' : '社区动态';
    if (title && title.textContent !== label) title.textContent = label;
    const hot = data.querySelector<HTMLElement>('.community-aside > .community-card');
    const hotSlot = right.querySelector<HTMLElement>('[data-frame-hot]');
    if (hotSlot) hotSlot.hidden = view === 'post';
    const nextHotKey = `${activityBoard}|${hot?.innerHTML || ''}`;
    if (hot && hotSlot && nextHotKey !== hotKey) {
      hotKey = nextHotKey;
      releaseTrending?.(); releaseTrending = null;
      hotSlot.replaceChildren(...hot.childNodes);
      const list = hotSlot.querySelector<HTMLOListElement>('.community-hot');
      if (list && request) releaseTrending = enhanceTrending(list, request, activityBoard);
      const empty = hotSlot.querySelector('.community-muted');
      if (empty?.textContent?.includes('最热的五个') || empty?.textContent?.includes('five most active')) {
        empty.textContent = english ? 'No posts yet. Up to 10 trending discussions will appear here.' : '还没有帖子。有了讨论以后，这里最多显示 10 条热门讨论。';
      }
    }
    navigation?.sync();
    placeCheckin();
    threadSidebar?.sync(view === 'post', Boolean(compact?.matches));
  };
  const render = (main: HTMLElement, html: string, homeHTML: string) => {
    if (!enabled()) { if (root) dispose(); return false; }
    const top = restoreTop ?? readTop();
    if (!root || root.parentElement !== main) {
      dispose();
      root = document.createElement('section');
      root.className = 'page community-page';
      root.dataset.communityFrame = 'stable';
      root.innerHTML = '<div class="community-layout"><div class="community-main community-frame-center" data-frame-center tabindex="-1" role="region"><div class="community-frame-checkin" data-frame-checkin hidden></div><div data-frame-showcase></div><div class="community-frame-route" data-frame-route></div></div><aside class="community-aside" data-frame-right><section class="community-card community-feed-overview" data-frame-overview><header class="community-card-h"><h2>社区动态</h2></header></section><section class="community-card" data-frame-hot></section></aside></div>';
      center = root.querySelector('[data-frame-center]');
      routeSlot = root.querySelector('[data-frame-route]');
      showcaseSlot = root.querySelector('[data-frame-showcase]');
      showcase = createSharedFeedShowcase(showcaseSlot!);
      right = root.querySelector('[data-frame-right]');
      threadSidebar = createFrameThreadSidebar(routeSlot!, right!);
      checkinDock = root.querySelector('[data-frame-checkin]');
      // An intentional user scroll takes precedence over pending restoration.
      for (const event of scrollInputs) document.addEventListener(event, onScrollInput, { passive: true, capture: true });
      main.replaceChildren(root);
      navigation = createFeedShell(root, window, { boards: boards.element });
      mobileLayout = Boolean(mobile?.matches);
      compact?.addEventListener('change', onBreakpoint);
      mobile?.addEventListener('change', onBreakpoint);
      document.addEventListener('scroll', rememberScroll, { passive: true, capture: true });
      document.addEventListener('click', onCurrentRouteClick);
      // The frame owns both scroll hosts, including back/forward on mobile.
      if (window.history && 'scrollRestoration' in window.history) {
        historyRestoration = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';
      }
      document.body.classList.add('community-frame-open');
      document.documentElement.classList.add('community-frame-document');
      levelMotion = createCommunityLevelMotion(document, request);
    }
    const nextHash = window.location.hash;
    const previous = communityRoute(currentHash), next = communityRoute(nextHash);
    // Tabs/categories change their address but still belong to the same content
    // page. Only a different page or an explicit sidebar entry starts at zero.
    const samePage = Boolean(currentHash) && previous.view === next.view
      && previous.board === next.board && previous.id === next.id;
    const changed = currentHash !== nextHash;
    const navigationEntry = navigationHash === nextHash;
    const incoming = fragment(html);
    const holding = incoming.querySelector('[data-community-pending-route="true"]');
    const existing = routeSlot!.querySelector<HTMLElement>('[data-community]');
    if (holding && existing) {
      existing.setAttribute('data-community-pending-route', 'true');
      existing.setAttribute('aria-busy', 'true'); existing.setAttribute('inert', '');
      const active = document.activeElement;
      if (active && existing.contains(active)) (active as HTMLElement).blur();
      pendingHandoff = { hash: nextHash, reset: changed && (!samePage || navigationEntry), top };
      navigationHash = null; currentHash = nextHash;
      navigation?.sync();
      return true;
    }
    if (changed && (!samePage || navigationEntry)) releaseReadingHeight(); else preserveReadingHeight();
    navigationHash = null;
    currentHash = nextHash;
    center!.setAttribute('aria-label', document.documentElement.lang.startsWith('en') ? 'Community content' : '社区内容');
    pendingHandoff = null;
    routeSlot!.replaceChildren(incoming);
    if (changed && (!samePage || navigationEntry)) resetToTop(); else restoreAfterLayout(top);
    sync(homeHTML);
    return true;
  };
  const header = (html: string) => {
    if (!enabled()) return false;
    const bar = document.getElementById('site-header');
    const nav = document.getElementById('navigation');
    if (!bar?.querySelector('.community-brand-group') || !nav?.classList.contains('community-nav')) return false;
    const source = fragment(html);
    for (const selector of ['.community-brand-group', '.header-actions']) {
      const old = bar.querySelector(selector), next = source.querySelector(selector);
      if (old && next && levelMotionMarkup(old) !== next.outerHTML) old.replaceWith(next);
    }
    const links = source.querySelectorAll<HTMLAnchorElement>('#navigation a');
    const label = source.querySelector('#navigation')?.getAttribute('aria-label');
    if (label) nav.setAttribute('aria-label', label);
    for (const link of nav.querySelectorAll<HTMLAnchorElement>('a')) {
      const next = [...links].find(next => next.getAttribute('href') === link.getAttribute('href'));
      if (!next) continue;
      const selected = next.hasAttribute('aria-current');
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      // Added SVG icons have no text. Labels and unread dots can change without
      // replacing links or their navigation handlers, including the first load.
      if (link.textContent !== next.textContent) link.innerHTML = next.innerHTML;
    }
    navigation?.sync();
    return true;
  };
  return { enabled, render, sync, header, resetToTop, preserveReadingPosition, dispose, center: () => center };
}
