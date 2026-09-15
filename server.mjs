import {byteRange} from './server/http-range.mjs';
import {imageSources} from './src/image-sources.mjs';
import {uploadTimeoutMs} from './src/upload-policy.mjs';
import http from "node:http";
import { open, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { serializeContent } from "./server/content-service.mjs";
import { pipeline } from "node:stream/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const defaultRoot = fileURLToPath(new URL("./dist/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function createPreviewServer({
  root = defaultRoot,
  contentService,
  authorService,
  healthCheck = async () => {},
  release = 'development',
  requestLogger,
} = {}) {
  const rootPath = resolve(root);
  const rootPrefix = rootPath.endsWith(sep) ? rootPath : rootPath + sep;
  return http.createServer({requestTimeout:uploadTimeoutMs}, async (req, res) => {
    let fileHandle;
    const started=performance.now();
    res.once('finish',()=>requestLogger?.({event:'http',method:req.method,path:(req.url||'/').split('?')[0],status:res.statusCode,durationMs:Math.round(performance.now()-started)}));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Preview-App", "sansphase-local");
    const respond = (status, body = "") => {
      res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    try {
      if(req.url.split('?')[0]==='/healthz' && ['GET','HEAD'].includes(req.method)) {
        let healthy=true;
        try {await healthCheck();} catch {healthy=false;}
        res.writeHead(healthy?200:503,{'Content-Type':'application/json; charset=utf-8'});
        res.end(req.method==='HEAD'?undefined:JSON.stringify({status:healthy?'ok':'unavailable',release}));
        return;
      }
      if (req.url.startsWith("/api/author/") && authorService) {
        await authorService.handle(req, res);
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.setHeader("Allow", "GET, HEAD");
        respond(405);
        return;
      }
      const requestURL = new URL(req.url, "http://localhost");
      const path = decodeURIComponent(requestURL.pathname).replaceAll(
        "\\",
        "/",
      );
      if (
        contentService &&
        (path.startsWith("/api/") || path === "/" || path === "/index.html")
      ) {
        try {
          if (path.startsWith("/api/media/")) {
            const upstream = await contentService.media(
              path.slice("/api/media/".length),
              {
                previewId: requestURL.searchParams.get("preview"),
                cookie: req.headers.cookie,
                download: requestURL.searchParams.has("download"),
                range: req.headers.range,
                width: requestURL.searchParams.get('w'),
              },
            );
            const type =
              upstream.headers.get("content-type") ||
              "application/octet-stream";
            // Re-check publication/auth above before any cache response, so an
            // unpublished image cannot be retrieved with a cached validator.
            const etag = upstream.headers.get('etag');
            if (!requestURL.searchParams.has('preview') && etag) {
              res.setHeader('ETag', etag);
              res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
              if (!req.headers.range && req.headers['if-none-match'] === etag) {
                await upstream.body?.cancel();
                res.writeHead(304);
                res.end();
                return;
              }
            }
            res.statusCode=upstream.status;
            for(const header of ['Content-Length','Content-Range','Accept-Ranges']) if(upstream.headers.has(header)) res.setHeader(header,upstream.headers.get(header));
            res.setHeader("Content-Type", type);
            res.setHeader(
              "Content-Security-Policy",
              "sandbox; default-src 'none'",
            );
            if (
              requestURL.searchParams.has("download") ||
              !/^((image\/(png|jpeg|webp|gif|avif))|audio\/[a-z0-9.+-]+)(?:;|$)/i.test(type)
            )
              res.setHeader(
                "Content-Disposition",
                upstream.headers
                  .get("content-disposition")
                  ?.replace(/^inline/, "attachment") || "attachment",
              );
            if (req.method === "HEAD" || !upstream.body) {
              await upstream.body?.cancel();
              res.end();
            } else await pipeline(Readable.fromWeb(upstream.body), res);
            return;
          }
          if (path.startsWith("/api/") && path !== "/api/content") {
            respond(404, "Not found");
            return;
          }
          const { data } = await contentService.snapshot();
          if (authorService) data.author = await authorService.identity(req);
          if (requestURL.searchParams.has("preview"))
            data.preview = (
              await contentService.preview(
                requestURL.searchParams.get("preview"),
                req.headers.cookie,
              )
            ).note;
          if (path === "/api/content") {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(req.method === "HEAD" ? undefined : serializeContent(data));
            return;
          }
          let html = await readFile(resolve(rootPath, "index.html"), "utf8");
          if (data.profile?.background) {
            html = html.replaceAll(
              "./assets/materials/blog-space.png",
              data.profile.background,
            );
            const responsive = imageSources(data.profile.background);
            html = html.replace(`<img src="${data.profile.background}"`, `<img ${responsive} src="${data.profile.background}"`);
            html = html.replace('<link rel="preload" as="image"', `<link ${responsive.replace('srcset=', 'imagesrcset=').replace('sizes=', 'imagesizes=')} rel="preload" as="image"`);
          }
          html = html.replace(
            "</head>",
            `<script id="site-content" type="application/json">${serializeContent(data)}</script></head>`,
          );
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Content-Length", Buffer.byteLength(html));
          res.end(req.method === "HEAD" ? undefined : html);
          return;
        } catch (error) {
          if (res.headersSent) {
            res.destroy();
            return;
          }
          respond(
            [401, 403, 404].includes(error.status) ? error.status : 503,
            error.status === 401 || error.status === 403
              ? "请先登录作者后台后再预览。"
              : "内容暂时无法读取，请稍后刷新。",
          );
          return;
        }
      }
      const file = resolve(
        rootPath,
        "." + (path === "/" ? "/index.html" : path),
      );
      if (!file.startsWith(rootPrefix)) {
        respond(403, "Forbidden");
        return;
      }
      fileHandle = await open(file, "r");
      const stats = await fileHandle.stat();
      if (!stats.isFile()) {
        await fileHandle.close();
        fileHandle = undefined;
        respond(404, "Not found");
        return;
      }
      // Stable file names revalidate, while esbuild's content-hashed chunks can
      // be cached across releases. Personalized HTML and API responses stay private.
      if(!['.html'].includes(extname(file))) {
        const etag=`W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
        res.setHeader('ETag',etag);
        res.setHeader('Cache-Control',/^\/chunks\/[^/]+-[A-Z0-9]+\.mjs$/.test(path)?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate');
        if(req.headers['if-none-match']?.split(',').map(x=>x.trim()).some(x=>x===etag||x==='*')) {
          await fileHandle.close();fileHandle=undefined;res.writeHead(304);res.end();return;
        }
      }
      // HEAD ignores Range. Weak ETags cannot satisfy If-Range, so that request
      // receives the complete representation instead of an unsafe partial one.
      const range =
        req.method === "GET" && !req.headers["if-range"]
          ? byteRange(req.headers.range, stats.size)
          : null;
      res.setHeader("Accept-Ranges", "bytes");
      if (range === false) {
        await fileHandle.close();
        fileHandle = undefined;
        res.setHeader("Content-Range", `bytes */${stats.size}`);
        respond(416);
        return;
      }
      const length = range ? range.end - range.start + 1 : stats.size;
      res.setHeader(
        "Content-Type",
        types[extname(file).toLowerCase()] || "application/octet-stream",
      );
      res.setHeader("Content-Length", length);
      if (range) {
        res.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${stats.size}`,
        );
      }
      if (req.method === "HEAD" || length === 0) {
        await fileHandle.close();
        fileHandle = undefined;
        res.writeHead(range ? 206 : 200);
        res.end();
        return;
      }
      const stream = fileHandle.createReadStream(range || {});
      fileHandle = undefined; // The stream owns and closes the open descriptor.
      res.writeHead(range ? 206 : 200);
      await pipeline(stream, res);
    } catch (error) {
      if (fileHandle) await fileHandle.close().catch(() => {});
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      respond(
        ["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 400,
        "Not found",
      );
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await import("./scripts/dev.mjs");
}
