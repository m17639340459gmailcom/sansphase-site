import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { validBlogSlug } from '../src/blog-route.ts';

type Render = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type Options = { origin: string; render: Render };

// These belong to the existing backend and keep its own session, publication,
// file authorization and share-card behavior when the document frontend changes.
const backendPath = /^\/(?:api|share|admin-console|manage|assets|chunks|build)(?:\/|$)/i;
const backendDocument = new Set(['/healthz', '/robots.txt', '/sitemap.xml']);
const previousEntry = /^\/(?:original|v1|v2|index\.html)\/?$/i;
const previousWork = /^\/(en\/)?work(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?\/?$/;
const privateDocumentPath = /^\/(?:_next\/server|frontend-v2|(?:en\/|zh\/)?(?:admin|resume))(?:\/|$)/i;

export function createFrontendV3Middleware({ origin, render }: Options) {
  const configured = new URL(origin);
  return async (req: IncomingMessage, res: ServerResponse, next: () => void | Promise<void>) => {
    const method = req.method ?? '';
    const read = method === 'GET' || method === 'HEAD';
    const raw = req.url ?? '/';
    const finish = (status: number, headers = {}) => {
      res.writeHead(status, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end();
    };
    const localHealth = raw === '/healthz' && read && /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(req.headers.host ?? '')
      && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    if (!localHealth && req.headers.host !== configured.host) { finish(403); return; }
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) { finish(400); return; }
    const url = URL.parse(raw, configured.origin);
    if (!url || url.origin !== configured.origin) { finish(400); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { finish(400); return; }
    if (/[\\\u0000-\u001f\u007f]/.test(pathname) || /%2f|%5c/i.test(url.pathname)) { finish(400); return; }

    if (backendPath.test(pathname) || backendDocument.has(pathname)) { await next(); return; }
    if (!read) { finish(405, { Allow: 'GET, HEAD' }); return; }
    if (privateDocumentPath.test(pathname)) { finish(404); return; }
    if (previousEntry.test(pathname)) { finish(308, { Location: '/' + url.search }); return; }
    const work = previousWork.exec(pathname);
    if (work && (!work[2] || validBlogSlug(work[2]))) {
      finish(308, { Location: '/' + (work[1] ?? '') + 'projects' + (work[2] ? '/' + work[2] : '') + url.search });
      return;
    }
    if (/^\/(?:en\/)?blog\//.test(pathname) && (url.searchParams.has('preview') || url.searchParams.has('previewKind'))) {
      finish(404); return;
    }
    await render(req, res);
  };
}

/** Load the independently locked Next app only when V3 is selected. */
export async function openFrontendV3({ appDirectory, origin, dev = false }: { appDirectory: string; origin: string; dev?: boolean }) {
  const dir = resolve(appDirectory);
  const load = createRequire(resolve(dir, 'package.json'));
  const next = load('next') as (options: { dir: string; dev: boolean }) => {
    prepare(): Promise<void>;
    getRequestHandler(): Render;
    close(): Promise<void>;
  };
  const application = next({ dir, dev });
  await application.prepare();
  return { middleware: createFrontendV3Middleware({ origin, render: application.getRequestHandler() }), close: () => application.close() };
}
