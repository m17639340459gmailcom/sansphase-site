import { createFeedLayout } from './feed.ts';
import { createFeedThread } from './feed-thread.ts';
import { communityRoute } from '../community.ts';

type LayoutWindow = Pick<Window, 'location' | 'addEventListener' | 'removeEventListener'> & { MutationObserver: typeof MutationObserver };

/** Enhance the controller's real rows without replacing forms or their event handlers. */
export function startCommunityLayout(document: Document, window: LayoutWindow): () => void {
  let host: HTMLElement | null = null;
  let feed: ReturnType<typeof createFeedLayout> | null = null;
  let threadHost: HTMLElement | null = null;
  let thread: ReturnType<typeof createFeedThread> | null = null;
  let suspended = false;
  const clearFeed = () => { feed?.release(); feed = null; host?.removeAttribute('data-home-design'); host = null; };
  const clearThread = () => { thread?.release(); thread = null; threadHost?.removeAttribute('data-thread-design'); threadHost = null; };
  const sync = () => {
    if (suspended) return;
    const { view } = communityRoute(window.location.hash);
    const nextThread = view === 'post' ? document.querySelector<HTMLElement>('#main [data-community="post"]') : null;
    if (nextThread !== threadHost) clearThread();
    threadHost = nextThread;
    if (threadHost) { threadHost.dataset.threadDesign = 'feed'; thread ??= createFeedThread(threadHost); thread.sync(); }
    const next = view === 'home' || view === 'board' ? document.querySelector<HTMLElement>(`#main [data-community="${view}"]`) : null;
    if (next !== host) clearFeed();
    host = next;
    if (host) { host.dataset.homeDesign = 'feed'; feed ??= createFeedLayout(host); feed.sync(); }
  };
  const observer = new window.MutationObserver(sync);
  const observe = () => observer.observe(document.getElementById('main') || document.body, { childList: true, subtree: true });
  const hide = () => { suspended = true; observer.disconnect(); clearFeed(); clearThread(); };
  const show = (event: PageTransitionEvent) => { if (event.persisted) { suspended = false; observe(); sync(); } };
  observe(); sync();
  window.addEventListener('hashchange', sync);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  return () => { hide(); window.removeEventListener('hashchange', sync); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
}
