// Optional document/static adapter. The existing HTTP server remains the sole
// owner of content publication, authentication, permissions, media and previews.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';
import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import { validBlogSlug } from '../src/blog-route.ts';

type Nodes = ReturnType<typeof parseDocument>['children'];
type Element = Extract<Nodes[number], { attribs: unknown }>;
type Options = { origin: string; generatedRoot: string; allowOriginal?: boolean };
type FrontendDocument = { read(): Promise<string>; articleMainId?: string };
const documents = new WeakMap<IncomingMessage, FrontendDocument>();
const originalDocuments = new WeakSet<IncomingMessage>();
const pages = new Set(['blog', 'work', 'learning', 'software', 'resources', 'community', 'contact', 'support', 'account', 'verify', 'reset']);
const details = new Set(['blog', 'work', 'learning', 'software', 'resources', 'verify', 'reset']);
const accountPages = new Set(['account', 'verify', 'reset']);
const staticArticleId = 'site-article-static';

function elements(nodes: Nodes): Element[] {
  return nodes.flatMap(node => 'attribs' in node ? [node, ...elements(node.children)] : 'children' in node ? elements(node.children) : []);
}
function pagePath(path: string) {
  if (path === '/') return true;
  const parts = path.replace(/\/$/, '').split('/').slice(1);
  return pages.has(parts[0]) && (parts.length === 1 || parts.length === 2 && details.has(parts[0]) && parts[1].length > 0 && parts[1].length <= 1000 && !/[\\\s\u0000-\u001f<>]/.test(parts[1]));
}

function rollbackPage(path: string): string | null {
  if (!path.startsWith('/') || path.includes('//')) return null;
  const parts = path.replace(/^\/en(?=\/|$)/, '').replace(/\/$/, '').slice(1).split('/');
  const [page, item, chapter] = parts;
  if (!page) return '/';
  if (page === 'about') return parts.length === 1 ? '/blog' : null;
  const entry = page === 'projects' ? 'work' : page;
  if (!pages.has(entry)) return null;
  if (parts.length === 1) return `/${entry}`;
  if (parts.length === 3 && entry === 'resources' && validBlogSlug(item) && /^[a-z0-9_-]{1,160}$/.test(chapter)) {
    // The V2 reader opens the same book and owns chapter selection.
    return `/resources/${item}`;
  }
  if (parts.length !== 2 || !details.has(entry)) return null;
  const validItem = accountPages.has(entry) ? /^[A-Za-z0-9._~-]{1,256}$/.test(item) : validBlogSlug(item);
  return validItem ? `/${entry}/${item}` : null;
}

function rollbackAccountSearch(url: URL): string {
  const params = url.searchParams;
  const existing = params.getAll('return'), v3 = params.getAll('returnTo');
  if (existing.length + v3.length !== 1 || params.has('preview') || params.has('previewKind')) return url.search;
  const value = existing[0] ?? v3[0];
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(value) || value.length > 2048) return url.search;
  const target = new URL(value, url.origin);
  if (target.origin !== url.origin || value.split(/[?#]/, 1)[0] !== target.pathname || target.hash.startsWith('#/') || target.searchParams.has('preview') || target.searchParams.has('previewKind')) return url.search;
  const page = rollbackPage(target.pathname);
  if (!page || accountPages.has(page.split('/')[1])) return url.search;
  const destination = page + target.search + target.hash;
  if (existing.length && destination === value) return url.search;
  const key = existing.length ? 'return' : 'returnTo';
  // Keep every other query pair byte-for-byte, including duplicate filters.
  return '?' + url.search.slice(1).split('&').map(pair => new URLSearchParams(pair).has(key) ? `return=${encodeURIComponent(destination)}` : pair).join('&');
}

const articleStyle = `body[data-static-article]{overflow:auto}body[data-static-article]>:is(#main,.footer,.app-loading-status){display:none}#site-article-static{max-width:960px;margin:132px auto 80px;padding:0 24px;color:var(--fg);font-size:17px;line-height:1.9;overflow-wrap:anywhere}#site-article-static .reading-sidebar{display:none}#site-article-static h1{font-size:clamp(32px,5vw,64px);line-height:1.2;margin:24px 0}#site-article-static :is(h2,h3){margin:2em 0 .6em}#site-article-static .post-tags{display:flex;flex-wrap:wrap;gap:16px;font-size:13px;color:var(--muted)}#site-article-static .article-intro{color:var(--muted);margin:28px 0}#site-article-static .article-body{margin-top:36px}#site-article-static .article-body :is(p,ul,ol,pre,blockquote){margin:0 0 1.2em}#site-article-static .article-body :is(ul,ol){padding-left:1.5em;list-style:revert}#site-article-static pre{overflow:auto;padding:16px;background:var(--bg-2)}#site-article-static img{max-width:100%;height:auto}#site-article-static a{color:var(--accent);text-decoration:underline;text-underline-offset:4px}#site-article-static .ui-icon{display:inline-block;width:18px;height:18px;vertical-align:middle}#site-article-static .article-bottom{margin-top:48px}`;

function documentShell(html: string, origin: string, article: boolean): string {
  const document = parseDocument(html), tags = elements(document.children);
  const head = tags.find(node => node.name === 'head'), body = tags.find(node => node.name === 'body');
  const main = tags.find(node => node.attribs.id === 'main');
  if (!head || !body || !main) throw new Error('Invalid V2 document shell');
  for (const tag of tags) {
    if (tag.name === 'link' && tag.attribs.href === '/style.css') tag.attribs.href = '/frontend-v2/style.css';
    if (tag.name === 'a' && tag.attribs.href === '/third-party-notices.txt') tag.attribs.href = '/frontend-v2/third-party-notices.txt';
    if (tag.name === 'title') for (const node of tag.children) if ('data' in node) node.data = node.data.replace(' · 成相交互演示', '');
    if (tag.name === 'meta' && tag.attribs.name === 'description') tag.attribs.content = tag.attribs.content.replace('，本地交互演示。', '。');
  }
  // Production identity is explicit; never impersonate the local test marker.
  const marker = parseDocument(`<script type="application/json" id="site-integration">${JSON.stringify({ mode: 'production', origin, frontendVersion: 2, originalVersion: 1 }).replaceAll('<', '\\u003c')}</script>`).children[0];
  head.children.push(marker); marker.parent = head;
  if (article) {
    const slot = parseDocument(`<main id="${staticArticleId}"></main>`).children[0];
    body.children.splice(body.children.indexOf(main), 0, slot); slot.parent = body;
    body.attribs['data-static-article'] = '';
    const style = parseDocument(`<style id="site-article-static-style">${articleStyle}</style>`).children[0];
    head.children.push(style); style.parent = head;
  }
  return render(document, { encodeEntities: 'utf8' });
}

/** A request-local shell choice, consumed only after original access checks. */
export function frontendV2Document(req: IncomingMessage): FrontendDocument | undefined { return documents.get(req); }
export function originalFrontendDocument(req: IncomingMessage): boolean { return originalDocuments.has(req); }

export function createFrontendV2Middleware({ origin, generatedRoot, allowOriginal = false }: Options) {
  const configured = new URL(origin);
  if (!['https:', 'http:'].includes(configured.protocol) || configured.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(configured.hostname) || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) throw new TypeError('V2 requires an explicit secure site origin');
  const root = resolve(generatedRoot);
  const fileAt = async (name: string) => {
    const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(resolve(root, name))]);
    if (!actualFile.startsWith(actualRoot + sep)) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    return actualFile;
  };
  const respond = (req: IncomingMessage, res: ServerResponse, status: number, text: string) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : text);
  };
  return async (req: IncomingMessage, res: ServerResponse, next: () => void | Promise<void>) => {
    // Existing service/backup probes reach the original health endpoint directly
    // over loopback. Keep that one read-only route, without accepting a local
    // Host for documents, APIs, or requests received from another machine.
    const loopbackProbe = ['GET', 'HEAD'].includes(req.method ?? '') && req.url?.split('?')[0] === '/healthz'
      && /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(req.headers.host ?? '')
      && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (loopbackProbe) { await next(); return; }
    if (req.headers.host !== configured.host) { respond(req, res, 403, 'Unrecognized site origin.'); return; }
    let url: URL;
    try { url = new URL(req.url ?? '/', configured.origin); }
    catch { respond(req, res, 400, 'Invalid URL.'); return; }
    let path: string;
    try { path = decodeURIComponent(url.pathname); }
    catch { if (url.pathname.startsWith('/blog/')) await next(); else respond(req, res, 400, 'Invalid URL.'); return; }
    const rawPath = req.url?.split('?', 1)[0];
    if (url.origin === configured.origin && rawPath === url.pathname) {
      const rollback = rollbackPage(rawPath);
      if (rollback) {
        const accountRedirect = accountPages.has(rollback.split('/')[1]);
        const search = accountPages.has(rollback.slice(1)) ? rollbackAccountSearch(url) : url.search;
        if (search !== url.search || rollback !== (rawPath.replace(/\/$/, '') || '/')) {
          if (req.method !== 'GET' && req.method !== 'HEAD') { respond(req, res, 405, 'Use GET or HEAD.'); return; }
          // No fragment lets the browser carry its original #blog/reading anchor.
          res.writeHead(302, { Location: rollback + search, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
            ...(accountRedirect ? { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } : {}) });
          res.end(); return;
        }
      }
    }
    if (path === '/index.html') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { respond(req, res, 405, 'Use GET or HEAD.'); return; }
      res.writeHead(308, { Location: '/' + url.search, 'Cache-Control': 'private, no-store' }); res.end(); return;
    }
    if (path === '/original' || path === '/original/' || /^\/v[12]\/?$/.test(path)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { respond(req, res, 405, 'Use the existing application API.'); return; }
      if (path.startsWith('/original') || path.startsWith('/v1')) {
        if (!allowOriginal) { respond(req, res, 404, 'Not found.'); return; }
        if (path.startsWith('/original')) {
          // V1 keeps relative stylesheet/module URLs and a /original-only
          // history adapter. Canonicalize every accepted alias before sending
          // that document; omit the fragment so browser hash state survives.
          if (url.pathname !== '/original') {
            res.writeHead(308, { Location: '/original' + url.search, 'Cache-Control': 'private, no-store' }); res.end(); return;
          }
          req.url = '/' + url.search; res.setHeader('X-Robots-Tag', 'noindex, nofollow'); originalDocuments.add(req);
          try { await next(); } finally { originalDocuments.delete(req); }
          return;
        }
      }
      res.writeHead(302, { Location: (path.startsWith('/v1') ? '/original' : '/') + url.search, 'Cache-Control': 'private, no-store' }); res.end(); return;
    }
    const staticFile = path === '/frontend-v2/style.css' ? 'style.css' : path === '/frontend-v2/third-party-notices.txt' ? 'third-party-notices.txt'
      : /^\/build\/[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Z0-9]{8}\.(?:js|css|woff2?|ttf)$/.test(path) ? path.slice(1) : null;
    if (staticFile) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { respond(req, res, 405, 'Use GET or HEAD.'); return; }
      try {
        const bytes = await readFile(await fileAt(staticFile));
        const etag = `W/"${createHash('sha256').update(bytes).digest('base64url')}"`;
        const mime: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
        res.setHeader('Content-Type', mime[extname(staticFile)] || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', /-[A-Z0-9]{8}\./.test(staticFile) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
        if (req.headers['if-none-match']?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))) { res.writeHead(304); res.end(); return; }
        res.setHeader('Content-Length', bytes.byteLength); res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch (error: unknown) { respond(req, res, error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? 404 : 503, 'Frontend asset unavailable.'); }
      return;
    }
    if (path.startsWith('/frontend-v2/') || path.startsWith('/build/')) { respond(req, res, 404, 'Not found.'); return; }
    // Preview links keep the original author renderer and all its permission
    // checks. Invalid article URLs also go through the original 404 policy.
    if (path.startsWith('/blog/') && !url.pathname.startsWith('/blog/')) { respond(req, res, 404, 'Not found.'); return; }
    if (!pagePath(path) || url.searchParams.has('preview') || url.searchParams.has('previewKind')) { await next(); return; }
    if (accountPages.has(path.split('/')[1])) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Referrer-Policy', 'no-referrer');
    }
    const article = path.startsWith('/blog/');
    documents.set(req, { read: async () => documentShell(await readFile(await fileAt('index.html'), 'utf8'), configured.origin, article), ...(article ? { articleMainId: staticArticleId } : {}) });
    try { await next(); } finally { documents.delete(req); }
  };
}
