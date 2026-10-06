import { parseRoute } from './core.mjs';

export type CommunityHostConfig = { communityDestination?: unknown; communityOnly?: unknown; mainSiteOrigin?: unknown };
export type CommunityEntryState = 'idle' | 'pending' | 'leaving' | 'error' | 'auth';
const destinationOrigin = 'https://community.sansphase.com';
const mainOrigin = 'https://www.sansphase.com';
function exactOrigin(value: unknown, allowed: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === allowed && url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? allowed : null;
  } catch { return null; }
}
export function communityEntryDestination(config: CommunityHostConfig | null | undefined) {
  return config?.communityOnly === true ? null : exactOrigin(config?.communityDestination, destinationOrigin);
}
export function communityEntryTarget(value: unknown, destination: string, now = Date.now()): string | null {
  if (!value || typeof value !== 'object' || !('url' in value) || !('expiresAt' in value) || typeof value.url !== 'string') return null;
  const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt : typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 65000 || exactOrigin(destination, destinationOrigin) === null) return null;
  try {
    const url = new URL(value.url);
    if (url.origin !== destination || url.username || url.password || url.pathname !== '/community-enter' || url.search || !/^#community-entry=[A-Za-z0-9_-]{32,256}$/.test(url.hash)) return null;
    return url.href;
  } catch { return null; }
}
type EntryResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
export function createCommunityEntry(options: {
  config: () => CommunityHostConfig | null; request: (url: string, init: RequestInit) => Promise<EntryResponse>;
  navigate: (url: string) => void; fadeOut: () => Promise<void>; restore?: () => void; changed: (state: CommunityEntryState) => void;
}) {
  let state: CommunityEntryState = 'idle', pending: Promise<boolean> | null = null, generation = 0;
  const set = (value: CommunityEntryState) => { state = value; options.changed(value); };
  function enter(authenticated: boolean): Promise<boolean> {
    if (pending) return pending;
    if (state === 'leaving') return Promise.resolve(true);
    const destination = communityEntryDestination(options.config());
    if (!destination) return Promise.resolve(false);
    if (!authenticated) { set('auth'); return Promise.resolve(false); }
    const token = ++generation;
    // Set the lock before publishing state: a render callback can itself call
    // enter again. Requests and fades therefore share one in-flight promise.
    pending = Promise.resolve().then(async () => {
      try {
        const response = await options.request('/api/community-entry', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Reader-Request': '1' }, body: '{}' });
        if (token !== generation) return false;
        if (response.status === 401) { options.restore?.(); set('auth'); return false; }
        if (!response.ok) throw new Error('Entry unavailable');
        const target = communityEntryTarget(await response.json(), destination);
        if (!target) throw new Error('Invalid entry destination');
        if (token !== generation) return false;
        set('leaving');
        await options.fadeOut();
        if (token !== generation) return false;
        options.navigate(target);
        return true;
      } catch {
        if (token !== generation) return false;
        options.restore?.(); set('error'); return false;
      } finally { if (token === generation) pending = null; }
    });
    set('pending');
    return pending;
  }
  return { enter, state: () => state, cancel() { generation++; pending = null; state = 'idle'; options.restore?.(); } };
}

export function communityHostRoute(config: CommunityHostConfig | null | undefined, hash: string, initial = false): { kind: 'local'; hash: string } | { kind: 'main'; url: string } {
  if (config?.communityOnly !== true) return { kind: 'local', hash };
  if (['', '#', '#/', '#/community', '#/community/'].includes(hash) || initial && hash === '#/home') return { kind: 'local', hash: '#/community/home' };
  const { page } = parseRoute(hash);
  if (page === 'community' || page === 'post') return { kind: 'local', hash };
  const origin = exactOrigin(config.mainSiteOrigin, mainOrigin) || mainOrigin;
  return { kind: 'main', url: `${origin}/${hash.startsWith('#/') ? hash : '#/home'}` };
}
export async function exitCommunity(config: CommunityHostConfig, request: (url: string, init: RequestInit) => Promise<EntryResponse>, navigate: (url: string) => void) {
  if (config.communityOnly !== true) return false;
  const response = await request('/api/reader/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Reader-Request': '1' }, body: '{}' });
  if (!response.ok) throw new Error('Community logout unavailable');
  navigate(`${exactOrigin(config.mainSiteOrigin, mainOrigin) || mainOrigin}/#/home`);
  return true;
}
export function rewriteCommunityMainSiteLinks(root: ParentNode, config: CommunityHostConfig | null | undefined) {
  if (config?.communityOnly !== true) return;
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#/"]')) {
    const route = communityHostRoute(config, link.getAttribute('href') || '');
    if (route.kind === 'main') {
      link.href = route.url;
      link.removeAttribute('data-reader-return');
    }
  }
}
