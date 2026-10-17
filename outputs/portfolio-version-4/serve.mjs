// Local preview for the SANSPHASE portfolio, version 4. Not release source.
// esbuild rebuilds src/main.ts on each request. Two relays read the live site's
// public API so the demo uses real content: /media/<uuid> (images, kept in
// memory only) and /api/article/<slug> (public article detail, media rewritten).
import * as esbuild from 'esbuild';
import { createServer, request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4284);
const innerPort = port + 10;
const origin = 'https://www.sansphase.com';
const media = new Map();
const articles = new Map();

const context = await esbuild.context({
  entryPoints: [join(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: join(root, 'www/build'),
  publicPath: '/build',
  loader: { '.woff2': 'file', '.woff': 'file' },
  sourcemap: true,
  logLevel: 'info',
});
await context.serve({ servedir: join(root, 'www'), port: innerPort, host: '127.0.0.1' });

async function relayMedia(id, res) {
  if (!media.has(id)) {
    const upstream = await fetch(`${origin}/api/media/${id}?w=1600&view=content`);
    if (!upstream.ok) throw new Error(`media ${id}: ${upstream.status}`);
    media.set(id, { type: upstream.headers.get('content-type') || 'image/webp', body: Buffer.from(await upstream.arrayBuffer()) });
  }
  const item = media.get(id);
  res.writeHead(200, { 'content-type': item.type, 'cache-control': 'no-store' });
  res.end(item.body);
}

async function relayArticle(slug, res) {
  if (!articles.has(slug)) {
    const upstream = await fetch(`${origin}/api/content?public=1&view=detail&kind=notes&id=${encodeURIComponent(slug)}`);
    if (!upstream.ok) throw new Error(`article ${slug}: ${upstream.status}`);
    const data = await upstream.json();
    const item = data.item ?? data;
    // Point body images at the relay and drop responsive variants the relay does not serve.
    const bodyHTML = String(item.bodyHTML || '')
      .replace(/\ssrcset="[^"]*"/g, '')
      .replace(/\ssizes="[^"]*"/g, '')
      .replace(/\/api\/media\/([0-9a-f-]{36})[^"']*/g, '/media/$1');
    articles.set(slug, JSON.stringify({ slug, bodyHTML, attachments: item.attachments ?? [] }));
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(articles.get(slug));
}

createServer((req, res) => {
  const path = req.url.split('?')[0];
  const mediaMatch = /^\/media\/([0-9a-f-]{36})$/.exec(path);
  const articleMatch = /^\/api\/article\/([a-z0-9-]+)$/.exec(path);
  const fail = (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error));
  };
  if (mediaMatch) return void relayMedia(mediaMatch[1], res).catch(fail);
  if (articleMatch) return void relayArticle(articleMatch[1], res).catch(fail);
  // Page routes (/blog, /blog/<slug>, /work …) all load the single page.
  const isPage = req.method === 'GET' && !path.startsWith('/build/') && !/\.[a-z0-9]+$/i.test(path);
  const proxy = request({ host: '127.0.0.1', port: innerPort, path: isPage ? '/' : req.url, method: req.method, headers: req.headers }, (upstream) => {
    res.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', fail);
  req.pipe(proxy);
}).listen(port, '127.0.0.1', () => console.log(`portfolio version 4: http://127.0.0.1:${port}/`));
