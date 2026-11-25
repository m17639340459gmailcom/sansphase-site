import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { isCommunityPassiveRead } from './community-passive-request.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientAddress } from './client-ip.ts';
import { verifyIdentityRequest } from './community-identity-protocol.ts';
import type { IdentityDTO, IdentityOperation } from './community-identity-protocol.ts';
import type { CommunityHostStore, HostSession } from './community-host-store.ts';
import { hostSessionMaximumMs } from './community-host-store.ts';

export const communitySessionCookie = 'sansphase_community_session';
const handoffCookie = 'sansphase_community_handoff';
const purgePath = '/api/community-identity/purge';
type BridgeClient = { request<T = unknown>(operation: IdentityOperation, input: unknown): Promise<T> };
type ModeBinding = { reader: boolean };
export type CommunityHostContext = { req: IncomingMessage; session: HostSession; identity: IdentityDTO; token: string; modeBinding?: ModeBinding };
export type CommunityRequestMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => Promise<void>;
type Options = { store: CommunityHostStore; client: BridgeClient; siteOrigin: string; mainSiteOrigin: string; secret: string; purge: (readerId: string) => Promise<unknown>; decorations?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>; teahouseEnabled?: boolean; onModeChange?: (matches: (req: IncomingMessage) => boolean) => void };
const sessionCookie = (token: string, maxAge = 0) => `${communitySessionCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const sessionRemainingSeconds = (expiresAt: number) => Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
const clearHandoffCookie = `${handoffCookie}=; Domain=sansphase.com; Path=/api/community-entry; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
const statusOf = (error: unknown) => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 503;
const escapes = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function cookie(req: IncomingMessage, name: string) {
  const values = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage, limit = 8192) {
  if (Number(req.headers['content-length']) > limit) throw Object.assign(Error('请求内容过大。'), { status: 413 });
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(Error('请求内容过大。'), { status: 413 });
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
const entryScript = `const status=document.querySelector('[data-entry-status]');
const params=new URLSearchParams(location.hash.slice(1));
const postPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parts=location.hash.split('/');
const routePost=parts.length===3&&parts[0]==='#'&&parts[1]==='post'?parts[2]:'';
const candidates=params.getAll('post');
const candidate=routePost||(candidates.length===1?candidates[0]:'');
const post=candidate&&postPattern.test(candidate)?candidate:'';
const back=document.querySelector('[data-entry-main]');
if(post&&back){const destination=new URL(back.href);destination.searchParams.set('post',post);back.href=destination.href;}
const tickets=params.getAll('community-entry');
const ticket=tickets.length===1&&/^[A-Za-z0-9_-]{32,256}$/.test(tickets[0])?tickets[0]:'';
if(params.has('community-entry')){
  history.replaceState(null,'',location.pathname);
  status.textContent='正在验证主站进入凭证…';
  try{
    if(!ticket)throw new Error('进入凭证已失效，请从主站重新进入。');
    const response=await fetch('/api/community-entry',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Reader-Request':'1'},body:JSON.stringify({ticket})});
    if(!response.ok)throw new Error(response.status===503?'身份服务暂时不可用，请稍后从主站重新进入。':'进入凭证已失效，请从主站重新进入。');
    location.replace(post?'/#/post/'+post:'/#/community/home');
  }catch(error){status.textContent=error instanceof Error?error.message:'暂时无法进入社区，请返回主站。';}
}`;
const entryStyle = 'html{color-scheme:light}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#e8e2d6;color:#384355;font:16px system-ui,sans-serif}main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.5rem}p{line-height:1.8;color:#556171}a{display:inline-block;padding:.75rem 1.4rem;border:1px solid #937149;border-radius:999px;color:#785f3e;text-decoration:none}a:focus-visible{outline:2px solid #785f3e;outline-offset:4px}';
const styleHash = createHash('sha256').update(entryStyle).digest('base64');
const publicAsset = (path: string) => /\.(?:mjs|js|css|png|webp|jpe?g|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|ogg|glb|gltf|bin)$/i.test(path)
  && (/^\/(?:assets|chunks)\//.test(path) || /^\/[a-z0-9][a-z0-9._-]*$/i.test(path));
const privatePath = (path: string) => path.split('/').some(part => part.startsWith('.')) || /^\/(?:src|server|scripts|tests|docs|archive|outputs|uploads|logs|node_modules)(?:\/|$)/i.test(path) || /\.(?:db|db-wal|db-shm|sqlite|env|map|ts|tsx|pem|key|bak)$/i.test(path);

export function createCommunityHostAccess({ store, client, siteOrigin, mainSiteOrigin, secret, purge, decorations, teahouseEnabled = false, onModeChange }: Options) {
  if (siteOrigin !== 'https://community.sansphase.com' || mainSiteOrigin !== 'https://www.sansphase.com') throw Error('Community host origins must be fixed HTTPS production origins.');
  if (secret.length < 32) throw Error('Community bridge secret is required.');
  const context = new AsyncLocalStorage<CommunityHostContext>();
  const modes = new LRUCache<string, ModeBinding>({ max: 2000 });
  const requestModes = new WeakMap<IncomingMessage, ModeBinding>();
  const activeChecks = new Map<string, number>();
  let totalChecks = 0;
  const current = (req?: IncomingMessage) => {
    const value = context.getStore();
    if (!value || req && value.req !== req) return null;
    if (value.modeBinding && modes.get(value.session.tokenHash) !== value.modeBinding) return null;
    const alive = store.session(value.token);
    return alive && alive.tokenHash === value.session.tokenHash && alive.sessionRef === value.session.sessionRef
      && alive.createdAt === value.session.createdAt ? value : null;
  };
  const ownRequest = (req: IncomingMessage) => req.headers.origin === siteOrigin && req.headers['x-reader-request'] === '1';
  // A socket reuses its handshake request for its entire lifetime. Each event
  // needs a new authority check and its own async context, never a login snapshot.
  const authenticated = async <T>(req: IncomingMessage, token: string, session: HostSession, action: () => Promise<T>): Promise<T> => {
    let modeBinding = modes.get(session.tokenHash);
    if (!modeBinding) {
      modeBinding = { reader: cookie(req, 'community_browse') === 'reader' };
      modes.set(session.tokenHash, modeBinding);
    }
    const previous = requestModes.get(req);
    if (previous && previous !== modeBinding || modeBinding.reader !== (cookie(req, 'community_browse') === 'reader'))
      // The websocket notice can reach a browser before the HTTP Set-Cookie
      // response. A stale mode is retryable; it must not terminate this login.
      throw Object.assign(Error('登录身份正在切换，请稍后重试。'), { status: 409 });
    requestModes.set(req, modeBinding);
    let identity: IdentityDTO;
    try {
      identity = await client.request<IdentityDTO>('session', { sessionRef: session.sessionRef });
      const alive = store.session(token);
      if (!alive || alive.tokenHash !== session.tokenHash || alive.sessionRef !== session.sessionRef || alive.createdAt !== session.createdAt
        || identity.viewer.kind !== session.kind || identity.viewer.id !== session.id) throw Object.assign(Error('Identity changed or revoked.'), { status: 401 });
    } catch (error) {
      if ([401, 403].includes(statusOf(error))) store.revokeSession(token);
      throw error;
    }
    if (modes.get(session.tokenHash) !== modeBinding) throw Object.assign(Error('登录身份正在切换，请稍后重试。'), { status: 409 });
    return context.run({ req, session, identity, token, modeBinding }, async () => {
      try {
        const result = await action();
        if (!current(req)) throw Object.assign(Error('Identity changed or revoked.'), { status: 401 });
        return result;
      } catch (error) {
        // Profile helpers also call current() after awaited bridge operations.
        // Their generic stale-context error must not turn a successful mode
        // change into a permanent logout on a late HTTP response.
        if (modes.get(session.tokenHash) !== modeBinding && store.session(token))
          throw Object.assign(Error('登录身份正在切换，请稍后重试。'), { status: 409 });
        throw error;
      }
    });
  };
  const runWithSession = async <T>(req: IncomingMessage, action: () => Promise<T>): Promise<T> => {
    const token = cookie(req, communitySessionCookie), session = store.session(token);
    if (!session) throw Object.assign(Error('Identity changed or revoked.'), { status: 401 });
    const count = activeChecks.get(session.tokenHash) ?? 0;
    // Fanout is separately bounded by the chat service. Also cap independent
    // handshakes/HTTP requests from multiple tabs without caching permissions.
    if (count >= 8 || totalChecks >= 32) throw Object.assign(Error('茶室连接操作过多，请稍后重试。'), { status: 429 });
    activeChecks.set(session.tokenHash, count + 1); totalChecks++;
    try { return await authenticated(req, token, session, action); }
    finally {
      const remaining = (activeChecks.get(session.tokenHash) ?? 1) - 1;
      if (remaining) activeChecks.set(session.tokenHash, remaining); else activeChecks.delete(session.tokenHash);
      totalChecks--;
    }
  };
  const touchSession = (req: IncomingMessage) => {
    const token = cookie(req, communitySessionCookie);
    const session = store.session(token), binding = requestModes.get(req);
    if (!session || binding && modes.get(session.tokenHash) !== binding) throw Object.assign(Error('Identity changed or revoked.'), { status: 401 });
    store.touchSession(token);
  };
  const entryPage = (req: IncomingMessage, res: ServerResponse) => {
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>从主站进入社区 · 無相</title><style>${entryStyle}</style><script type="module" src="/community-entry-exchange.mjs"></script></head><body><main><h1>请从主站进入社区</h1><p data-entry-status>本次进入会话尚未建立。请返回主站，点击社区入口。</p><a data-entry-main href="${escapes(mainSiteOrigin)}/#/community">返回主站</a></main></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'sha256-${styleHash}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` });
    res.end(req.method === 'HEAD' ? undefined : html);
  };
  const requestMiddleware: CommunityRequestMiddleware = async (req, res, next) => {
    let path: string;
    try { path = decodeURIComponent(new URL(req.url || '/', siteOrigin).pathname).replaceAll('\\', '/'); }
    catch { json(res, { error: '请求地址无效。' }, 400); return; }
    if (privatePath(path)) { json(res, { error: 'Not found' }, 404); return; }
    // Only the dedicated metadata handler may resolve these public links. It
    // rechecks publication/VIP visibility and never establishes a member session.
    if (path.startsWith('/share/') && ['GET', 'HEAD'].includes(req.method || '')) { await next(); return; }
    if (decorations && await decorations(req, res)) return;
    if (path === purgePath) {
      if (req.method !== 'POST') { json(res, { error: 'Not found' }, 404); return; }
      try {
        const raw = await body(req);
        try { verifyIdentityRequest({ secret, method: 'POST', path, body: raw, headers: req.headers, consumeNonce: (nonce, expiresAt) => store.consumeNonce(nonce, expiresAt) }); }
        catch (error) { if (statusOf(error) >= 500) throw error; json(res, { error: '身份通知验证失败。' }, 403); return; }
        const input: unknown = JSON.parse(raw);
        if (!input || typeof input !== 'object' || !('operation' in input) || input.operation !== 'purge' || !('input' in input) || !input.input || typeof input.input !== 'object' || !('readerId' in input.input) || typeof input.input.readerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.input.readerId)) {
          json(res, { error: '清理通知格式无效。' }, 400); return;
        }
        json(res, { ok: true, result: await purge(input.input.readerId) });
      } catch (error) { json(res, { error: '社区账号清理暂时不可用，请重试。' }, statusOf(error) === 413 ? 413 : 503); }
      return;
    }
    if (path === '/community-entry-exchange.mjs' && ['GET', 'HEAD'].includes(req.method || '')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : entryScript); return;
    }
    // A fragment is not sent to the server. The dedicated handoff path must
    // always exchange, including when an older community cookie still exists.
    if (path === '/community-enter' && ['GET', 'HEAD'].includes(req.method || '')) { entryPage(req, res); return; }
    if (path === '/api/community-entry') {
      // Clear the shared handoff cookie on every attempt. A failed or consumed
      // handoff must be acquired again through the main site.
      res.setHeader('Set-Cookie', clearHandoffCookie);
      if (req.method !== 'POST' || !ownRequest(req)) { json(res, { error: '请从主站进入社区。' }, 403); return; }
      const binding = cookie(req, handoffCookie);
      if (!binding || binding.length > 256) { json(res, { error: '进入凭证验证失败，请从主站重新进入。' }, 403); return; }
      if (!store.consumeEntry(clientAddress(req).ip || 'unknown')) { json(res, { error: '进入尝试过于频繁，请稍后再试。' }, 429); return; }
      try {
        const data: unknown = JSON.parse(await body(req));
        if (!data || typeof data !== 'object' || !('ticket' in data) || typeof data.ticket !== 'string' || !data.ticket || data.ticket.length > 256) { json(res, { error: '进入凭证格式无效。' }, 400); return; }
        const result = await client.request<{ sessionRef: string; identity: IdentityDTO }>('exchange', { ticket: data.ticket, binding });
        const createdAt = Date.now(), token = store.createSession(result.sessionRef, result.identity.viewer, createdAt);
        const old = cookie(req, communitySessionCookie);
        if (old) store.revokeSession(old);
        res.setHeader('Set-Cookie', [sessionCookie(token, sessionRemainingSeconds(createdAt + hostSessionMaximumMs)), clearHandoffCookie]);
        json(res, { ok: true });
      } catch (error) { const status = statusOf(error); json(res, { error: status === 401 || status === 403 ? '进入凭证已失效，请从主站重新进入。' : '身份服务暂时不可用，请稍后从主站重新进入。' }, [400, 401, 403, 413].includes(status) ? status : 503); }
      return;
    }
    if ((path === '/healthz' || publicAsset(path)) && ['GET', 'HEAD'].includes(req.method || '')) { await next(); return; }
    // Only the community and bootstrap/session surface belongs to this host.
    // Payload content, registration, reader management and author CRUD stay at main.
    const view = new URL(req.url || '/', siteOrigin).searchParams.get('view');
    const teahousePath = teahouseEnabled && (path === '/teahouse' || path === '/teahouse.html' || path.startsWith('/api/teahouse/'));
    const allowed = teahousePath || path === '/' || path === '/index.html' || path === '/api/content' && (!view || view === 'bootstrap') || path.startsWith('/api/community/') || ['/api/reader/session', '/api/reader/logout', '/api/author/session', '/api/author/logout'].includes(path);
    if (!allowed) { json(res, { error: 'Not found' }, 404); return; }
    const token = cookie(req, communitySessionCookie);
    if (path.endsWith('/logout') && req.method === 'POST') {
      if (!ownRequest(req)) { json(res, { error: '请求来源验证失败。' }, 403); return; }
      store.revokeSession(token); res.setHeader('Set-Cookie', sessionCookie('')); json(res, { ok: true }); return;
    }
    const session = store.session(token);
    if (!session) {
      if ((path === '/' || path === '/index.html' || teahousePath && !path.startsWith('/api/')) && ['GET', 'HEAD'].includes(req.method || '')) entryPage(req, res);
      else json(res, { error: '请从主站重新进入社区。', code: 'COMMUNITY_ENTRY_REQUIRED', mainSiteOrigin }, 401);
      return;
    }
    // The attached tea-room handler performs its own bounded runWithSession
    // checks for every read/write and again after asynchronous work. Do not add
    // an unbounded duplicate bridge call before that handler's private API.
    if (teahouseEnabled && path.startsWith('/api/teahouse/')) { await next(); return; }
    try {
      const identity = await client.request<IdentityDTO>('session', { sessionRef: session.sessionRef });
      const alive = store.session(token);
      if (!alive || alive.tokenHash !== session.tokenHash || alive.sessionRef !== session.sessionRef || alive.createdAt !== session.createdAt
        || identity.viewer.kind !== session.kind || identity.viewer.id !== session.id) throw Object.assign(Error('Identity changed or revoked.'), { status: 401 });
      // Persist old browser-session cookies too, but never push the original
      // deadline forward when the user returns or a passive poll completes.
      res.setHeader('Set-Cookie', sessionCookie(token, sessionRemainingSeconds(session.expiresAt)));
      if (!path.startsWith('/api/teahouse/') && !isCommunityPassiveRead(req)) store.touchSession(token);
      if (teahouseEnabled && path === '/api/community/browse-mode' && req.method === 'POST') res.once('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        const header = res.getHeader('Set-Cookie');
        const selected = (Array.isArray(header) ? header : [header]).find(value => typeof value === 'string' && value.startsWith('community_browse='));
        if (typeof selected !== 'string') return;
        const reader = selected.startsWith('community_browse=reader;');
        const old = modes.get(session.tokenHash);
        if (old?.reader === reader) return;
        modes.set(session.tokenHash, { reader });
        onModeChange?.(candidate => cookie(candidate, communitySessionCookie) === token);
      });
      await context.run({ req, session, identity, token }, next);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = statusOf(error);
      if (status === 401 || status === 403) { store.revokeSession(token); res.setHeader('Set-Cookie', sessionCookie('')); }
      json(res, { error: status === 401 || status === 403 ? '进入会话已失效，请从主站重新进入。' : '身份服务暂时不可用，请稍后再试。', ...(status === 401 || status === 403 ? { code: 'COMMUNITY_ENTRY_REQUIRED', mainSiteOrigin } : {}) }, status === 401 || status === 403 ? 401 : 503);
    }
  };
  return { requestMiddleware, current, runWithSession, touchSession, async revalidate(req: IncomingMessage) {
    const value = current(req);
    if (!value) throw Object.assign(Error('Identity changed or revoked.'), { status: 401 });
    const identity = await client.request<IdentityDTO>('session', { sessionRef: value.session.sessionRef });
    // A final remote confirmation can itself outlive logout or a changed
    // principal. Replace only this request's snapshot after both checks.
    if (current(req) !== value || identity.viewer.kind !== value.session.kind || identity.viewer.id !== value.session.id)
      throw Object.assign(Error('Identity changed or revoked.'), { status: 401 });
    value.identity = identity;
    return value;
  } };
}
export type CommunityHostAccess = ReturnType<typeof createCommunityHostAccess>;
