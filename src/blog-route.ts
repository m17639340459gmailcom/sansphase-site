import { parseRoute } from './core.mjs';

export const validBlogSlug = (value: string): boolean => value.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export function blogSlug(pathname: string): string | null {
  if (!pathname.startsWith('/blog/')) return null;
  try {
    const slug = decodeURIComponent(pathname.slice(6));
    return validBlogSlug(slug) ? slug : null;
  } catch { return null; }
}
export function blogPath(slug: string): string {
  if (!validBlogSlug(slug)) throw new Error('Invalid public blog slug');
  return `/blog/${encodeURIComponent(slug)}`;
}
export function parseSiteRoute(hash = '', pathname = '/') {
  const slug = blogSlug(pathname);
  return slug && !hash.startsWith('#/') ? { page: 'note', id: slug } : parseRoute(hash);
}

type RouteChange = { oldURL: string; newURL: string };
// This adapter keeps the established hash router. Ordinary article links can
// now be crawled and opened without JS, and still navigate in-place with JS.
export function mountBlogRouting(win: Window, change: (event: RouteChange) => void): () => void {
  // The explicitly retained original document keeps its own hash router on
  // both production and loopback. Links must survive refresh without opening V2.
  const retainedEntry = win.location.pathname === '/original' && (win.location.hostname === '127.0.0.1' || win.document.documentElement.dataset.frontendEntry === 'original');
  const retainedLinks = new Map<HTMLAnchorElement, { original: string; retained: string }>();
  const retainLink = (link: HTMLAnchorElement) => {
    if (link.hasAttribute('download') || !win.document.contains(link)) return;
    const original = link.getAttribute('href');
    if (original === null || original === retainedLinks.get(link)?.retained) return;
    retainedLinks.delete(link);
    let url: URL;
    try { url = new URL(link.href, win.location.href); } catch { return; }
    if (url.origin !== win.location.origin) return;
    const slug = !url.hash.startsWith('#/') ? blogSlug(url.pathname) : null;
    const rootRoute = ['/', '/index.html'].includes(url.pathname) && url.hash.startsWith('#/');
    if (!slug && !rootRoute) return;
    const retained = `/original${url.search}${slug ? `#/note/${encodeURIComponent(slug)}` : url.hash}`;
    retainedLinks.set(link, { original, retained });
    link.setAttribute('href', retained);
  };
  const restoreLink = (link: HTMLAnchorElement) => {
    const owned = retainedLinks.get(link);
    retainedLinks.delete(link);
    if (owned && link.getAttribute('href') === owned.retained) link.setAttribute('href', owned.original);
  };
  const visitLinks = (node: Node, visit: (link: HTMLAnchorElement) => void) => {
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches('a[href]')) visit(element as HTMLAnchorElement);
    element.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(visit);
  };
  let linkObserver: MutationObserver | null = null;
  if (retainedEntry) {
    visitLinks(win.document.documentElement, retainLink);
    linkObserver = new (win as Window & typeof globalThis).MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const target = record.target as Element;
          if (target.matches('a[href]')) retainLink(target as HTMLAnchorElement);
        }
        else {
          record.removedNodes.forEach(node => visitLinks(node, link => { if (!win.document.contains(link)) restoreLink(link); }));
          record.addedNodes.forEach(node => visitLinks(node, retainLink));
        }
      }
    });
    linkObserver.observe(win.document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }
  const normalize = () => {
    if (blogSlug(win.location.pathname) && win.location.hash.startsWith('#/')) {
      win.history.replaceState(win.history.state, '', '/' + win.location.search + win.location.hash);
    }
  };
  normalize();
  let previous = win.location.href;
  const notify = () => {
    normalize();
    const next = win.location.href;
    if (next === previous) return;
    const oldURL = previous;
    previous = next;
    const from = new URL(oldURL), to = new URL(next);
    // Skip-to-body and native in-article anchors keep the mounted reading DOM.
    if (blogSlug(to.pathname) && from.pathname === to.pathname && from.search === to.search
      && !from.hash.startsWith('#/') && !to.hash.startsWith('#/')) return;
    change({oldURL, newURL: next});
  };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
    if (link && retainedEntry) retainLink(link);
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    const url = new URL(link.href, win.location.href);
    if (url.origin !== win.location.origin) return;
    const articleLink = blogSlug(url.pathname) && !url.hash.startsWith('#/');
    const rootLink = blogSlug(win.location.pathname) && ['/', '/index.html'].includes(url.pathname) && url.hash.startsWith('#/');
    const retainedLink = retainedEntry && url.pathname === '/original' && url.hash.startsWith('#/');
    if (!articleLink && !rootLink && !retainedLink) return;
    // Same-article fragments belong to native scrolling, not SPA routing.
    if (articleLink && url.pathname === win.location.pathname && url.search === win.location.search && url.hash) return;
    event.preventDefault();
    if (url.href === win.location.href) return;
    win.history.pushState(win.history.state, '', url);
    notify();
  };
  win.document.addEventListener('click', click);
  win.addEventListener('hashchange', notify);
  win.addEventListener('popstate', notify);
  return () => {
    linkObserver?.disconnect();
    retainedLinks.forEach((_value, link) => restoreLink(link));
    win.document.removeEventListener('click', click);
    win.removeEventListener('hashchange', notify);
    win.removeEventListener('popstate', notify);
  };
}
