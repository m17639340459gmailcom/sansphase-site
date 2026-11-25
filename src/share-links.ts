// URL owns parsing and encoding; only the site's public route mapping lives here.
// A share URL is not proof of publication: its server handler still checks visibility.
import {blogSlug} from './blog-route.mjs';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const readingRoutes = new Set(['work', 'software', 'resources', 'resource-center']);
const validSlug = (value: string) => value.length <= 120 && slugPattern.test(value);

export function publicShareURL(address: string): string | null {
  try {
    if (/[\u0000-\u001f\u007f]/.test(address)) return null;
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Draft previews must never be advertised as the published article with the same slug.
    if (url.searchParams.has('preview') || url.searchParams.has('previewKind')) return null;
    const share = (path: string) => new URL(`/share/${path}`, url.origin).href;
    const article = blogSlug(url.pathname);
    if (article && !url.hash.startsWith('#/')) return share(`blog/${encodeURIComponent(article)}`);
    if (!url.hash && url.pathname.startsWith('/share/')) {
      const [kind, id = '', ...rest] = decodeURIComponent(url.pathname.slice('/share/'.length)).split('/');
      if (rest.length) return null;
      if (['site', 'community'].includes(kind) && !id) return share(kind);
      if (kind === 'blog' && validSlug(id)) return share(`blog/${encodeURIComponent(id)}`);
      if (kind === 'post' && uuidPattern.test(id)) return share(`post/${encodeURIComponent(id)}`);
      return null;
    }
    if (url.pathname !== '/' && url.pathname !== '/index.html') return null;
    const route = decodeURIComponent(url.hash.replace(/^#\/?/, ''));
    if (!route || route === 'home') return share('site');
    if (route === 'community' || route === 'community/home') return share('community');
    const [kind, id = '', ...rest] = route.split('/');
    if (kind === 'note' && !rest.length && validSlug(id)) return share(`blog/${encodeURIComponent(id)}`);
    if (kind === 'post' && uuidPattern.test(id)
      && (!rest.length || rest.length === 2 && rest[0] === 'reply' && uuidPattern.test(rest[1]))) {
      return share(`post/${encodeURIComponent(id)}`);
    }
    // These existing reading pages have no per-content card endpoint yet. Preserve
    // their established destination without forwarding preview tokens or UI state.
    if (readingRoutes.has(kind) && !rest.length && validSlug(id)) {
      const fallback = new URL('/', url.origin);
      fallback.hash = `/${kind}/${encodeURIComponent(id)}`;
      return fallback.href;
    }
    return null;
  } catch { return null; }
}
