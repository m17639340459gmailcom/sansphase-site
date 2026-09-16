import sanitizeHtml from "sanitize-html";
import { normalizeSocialLink } from "../src/social-links.mjs";
import { richTextAttributes, richTextStyles } from "./rich-text-policy.mjs";
import { cleanMusic, cleanAppearance } from "./profile-settings.mjs";
import { backgroundLibrary, changeBackground } from "./background-library.mjs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { uuidPattern, safeLink } from "./content-service.mjs";
const cookieName = "sansphase_author_session";
const kinds = {
  articles: { collection: "articles" },
  works: { collection: "library_entries", kind: "works" },
  resources: { collection: "library_entries", kind: "resources" },
  software: { collection: "library_entries", kind: "software" },
  "resource-center": {collection:"library_entries",kind:"resource-center"},
  announcements: { collection: "announcements" },
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function assertAuthorOrigin(headers, origin) {
  if (headers.origin !== origin || headers["x-author-request"] !== "1")
    throw fail("请求来源验证失败，请从本站操作。", 403);
}
const text = (value, max = 200) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const file = (value) =>
  value === null || value === ""
    ? null
    : uuidPattern.test(value || "")
      ? value
      : (() => {
          throw fail("文件编号无效。");
        })();
export function validateArticle(input, kind) {
  const title = text(input.title),
    slug = text(input.slug, 120);
  if (!title) throw fail("请填写标题。");
  if (kind !== "announcements" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw fail("网址名称请使用小写英文、数字和短横线。");
  if (typeof input.body === "string" && input.body.length > 500000)
    throw fail("正文超过当前长度限制。");
  const result = { title, summary: text(input.summary, 2000) };
  if (kind === "announcements")
    return {
      ...result,
      image: file(input.image || null),
      link: safeLink(input.link),
      sort: Math.max(0, Math.min(9999, Number(input.sort) || 0)),
    };
  Object.assign(result, {
    slug,
    category: text(input.category || "随笔", 80),
    tags: [
      ...new Set(
        (Array.isArray(input.tags) ? input.tags : [])
          .filter((v) => typeof v === "string")
          .map((v) => text(v, 40)),
      ),
    ].slice(0, 30),
    cover: file(input.cover || null),
    body: sanitizeHtml(input.body || "", {
      allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
      allowedAttributes: {
        ...richTextAttributes,
        a: ["href", "title"],
        img: ["src", "alt", "width", "height"],
        code: ["class"],
        td: ["colspan", "rowspan"],
        th: ["colspan", "rowspan"],
      },
      allowedSchemes: ["http", "https", "mailto"],
      allowedStyles: richTextStyles,
      allowProtocolRelative: false,
    }),
  });
  if (kind === "articles")
    result.attachments = (
      Array.isArray(input.attachments) ? input.attachments : []
    )
      .slice(0, 20)
      .map((value) => file(value))
      .filter(Boolean);
  else
    Object.assign(result, {
      file: file(input.file || null),
      external_url: safeLink(input.external_url),
    });
  return result;
}
export function createAuthorService({
  url,
  authorId,
  siteOrigin = "http://127.0.0.1:4176",
  store,
}) {
  const cms = new URL(url).origin;
  const session = (req) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || "";
  const cookieHeader = (token) =>
    `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 86400 : 0}${siteOrigin.startsWith("https:") ? "; Secure" : ""}`;
  if (!store) throw new Error('Author storage must be explicitly configured.');
  async function authorize(token) {
    if (!token || !authorId) throw fail("请先登录作者账号。", 401);
    const user = await store.identity(token);
    if (user.id !== authorId)
      throw fail("这个账号没有个人网站的作者权限。", 403);
    return { name: user.first_name || "作者" };
  }
  const readBody = async (req, max = 1024 * 1024) => {
    if (Number(req.headers["content-length"]) > max)
      throw fail("请求内容太大。", 413);
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > max) throw fail("请求内容太大。", 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const json = async (req) => {
    try {
      return JSON.parse((await readBody(req)).toString("utf8"));
    } catch (error) {
      if (error.status) throw error;
      throw fail("请求格式无效。");
    }
  };
  const editorBody = (value) =>
    String(value || "")
      .replace(/\/api\/media\/([0-9a-f-]+)/g, "/api/author/media/$1")
      .replace(
        new RegExp(
          `${cms.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/assets/([0-9a-f-]+)`,
          "g",
        ),
        "/api/author/media/$1",
      );
  const persistedBody = (value) =>
    String(value || "").replace(
      /(?:https?:\/\/[^/"'\s]+)?\/api\/author\/media\/([0-9a-f-]+)/g,
      `${store.mediaPrefix || `${cms}/assets`}/$1`,
    );
  const rowForEditor = (row) => ({
    ...row,
    ...(row.pending_content || {}),
    body: editorBody(row.pending_content?.body ?? row.body),
    attachments:
      row.pending_content?.attachments ??
      (row.attachments || []).map(
        (x) => x.directus_files_id?.id || x.directus_files_id,
      ),
    pending_content: undefined,
  });
  async function getItem(kind, id, token) {
    const spec = kinds[kind];
    if (!spec || !uuidPattern.test(id)) throw fail("内容不存在。", 404);
    const row = await store.get(spec.collection, id, token);
    if (spec.kind && row.kind !== spec.kind) throw fail("内容不存在。", 404);
    return row;
  }
  async function save(kind, id, body, token) {
    const spec = kinds[kind];
    if (!spec) throw fail("不支持的内容类型。", 404);
    const action = body.action;
    if (!["draft", "publish", "unpublish"].includes(action))
      throw fail("请选择保存草稿或发布。");
    const previous = id ? await getItem(kind, id, token) : null;
    if (action === "unpublish") {
      if (!id) throw fail("请先保存内容。");
      return store.save(spec.collection, id, { status: "draft" }, token);
    }
    if (
      previous &&
      body.expectedUpdated &&
      previous.date_updated !== body.expectedUpdated
    )
      throw fail("内容已在其他窗口修改，请重新打开后编辑。", 409);
    const values = validateArticle(body, kind);
    if (values.body !== undefined) values.body = persistedBody(values.body);
    if (action === "draft" && previous?.status === "published") {
      await store.save(spec.collection, id, { pending_content: values }, token);
      return rowForEditor(await getItem(kind, id, token));
    }
    const payload = {
      ...values,
      ...(spec.kind ? { kind: spec.kind } : {}),
      pending_content: null,
      status: action === "publish" ? "published" : "draft",
    };
    if (kind !== "announcements")
      Object.assign(payload, {
        pending_content: null,
        published_at:
          previous?.published_at ||
          (action === "publish" ? new Date().toISOString() : null),
      });
    if (kind === "articles")
      payload.attachments = id
        ? {
            delete: (previous.attachments || []).map((x) => x.id),
            create: values.attachments.map((id) => ({ directus_files_id: id })),
          }
        : values.attachments.map((id) => ({ directus_files_id: id }));
    const saved = await store.save(spec.collection, id, payload, token);
    return rowForEditor(await getItem(kind, saved.id, token));
  }
  return {
    async identity(req) {
      try {
        return await authorize(session(req));
      } catch (error) {
        if ([401, 403].includes(error.status)) return null;
        throw error;
      }
    },
    async handle(req, res) {
      const parsed = new URL(req.url, siteOrigin),
        parts = parsed.pathname.slice("/api/author/".length).split("/");
      const send = (data, status = 200) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(data));
      };
      try {
        if (!["GET", "POST", "PATCH"].includes(req.method))
          throw fail("不支持的操作。", 405);
        if (req.method !== "GET") assertAuthorOrigin(req.headers, siteOrigin);
        let token = session(req);
        if (parts[0] === "login" && req.method === "POST") {
          const body = await json(req);
          token = await store.login({
            email: text(body.email, 254),
            password: String(body.password || ""),
          });
          const identity = await authorize(token);
          res.setHeader("Set-Cookie", cookieHeader(token));
          send(identity);
          return;
        }
        if (parts[0] === "session" && req.method === "GET") {
          send(await this.identity(req));
          return;
        }
        const identity = await authorize(token);
        if (parts[0] === "logout" && req.method === "POST") {
          await store.logout(token);
          res.setHeader("Set-Cookie", cookieHeader(""));
          send({ ok: true });
          return;
        }
        if (parts[0] === 'upload' && req.method === 'GET') {
          send(store.uploadLimits || {maxFileBytes:25*1024**2,maxImageBytes:25*1024**2,maxAudioBytes:25*1024**2}); return;
        }
        if (parts[0] === "upload" && req.method === "POST") {
          let saved;
          if(store.uploadRequest) saved=await store.uploadRequest(req,token);
          else {
            const buffer=await readBody(req,25*1024*1024);
            const input=await new Request(siteOrigin,{method:'POST',headers:{'Content-Type':req.headers['content-type']||''},body:buffer}).formData();
            const upload=input.get('file');
            if(!upload || typeof upload.arrayBuffer!=='function') throw fail('请选择文件。');
            if(input.get('purpose')==='background' && !/^image\/(png|jpeg|webp|gif|avif)$/.test(upload.type)) throw fail('背景请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。');
            saved={...await store.upload(input,token),purpose:input.get('purpose')};
          }
          const isBackground=saved.purpose==='background';
          if (isBackground) {
            const profile = await store.profile(token);
            const library = backgroundLibrary(profile);
            library.unshift({
              id: saved.id,
              name: text(saved.filename_download),
              deletedAt: null,
            });
            await store.saveProfile({ background_library: library }, token);
          }
          send({
            id: saved.id,
            name: saved.filename_download,
            type: saved.type,
            url: `/api/author/media/${saved.id}`,
          });
          return;
        }
        if (
          parts[0] === "media" &&
          req.method === "GET" &&
          uuidPattern.test(parts[1] || "")
        ) {
          const upstream = await store.media(parts[1], token, parsed.searchParams.get('w'));
          const type =
            upstream.headers.get("content-type") || "application/octet-stream";
          res.setHeader("Content-Type", type);
          res.setHeader(
            "Content-Security-Policy",
            "sandbox; default-src 'none'",
          );
          if (/^image\/(png|jpeg|gif|webp|avif)(?:;|$)/i.test(type)) {
            // Only the owner's browser may retain previews. Reauthorize every
            // request, including validators, so logout cannot reuse a stale 304.
            const etag = upstream.headers.get('etag');
            if (etag) {
              res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
              res.setHeader('Vary', 'Cookie');
              res.setHeader('ETag', etag);
              if (req.headers['if-none-match'] === etag) {
                await upstream.body?.cancel();
                res.writeHead(304);
                res.end();
                return;
              }
            }
          } else
            res.setHeader("Content-Disposition", "attachment");
          if (upstream.headers.has('content-length'))
            res.setHeader('Content-Length', upstream.headers.get('content-length'));
          await pipeline(Readable.fromWeb(upstream.body), res);
          return;
        }
        if (parts[0] === "profile") {
          if (req.method === "GET") {
            send(await store.profile(token));
            return;
          }
          if (req.method === "PATCH") {
            const input = await json(req);
            const body = {
              name: text(input.name, 80),
              signature: text(input.signature),
              bio: text(input.bio, 1000),
              avatar: file(input.avatar || null),
              background: file(input.background || null),
              ...(Object.hasOwn(input, "music_settings")
                ? { music_settings: cleanMusic(input.music_settings) }
                : {}),
              ...(Object.hasOwn(input, "appearance")
                ? { appearance: cleanAppearance(input.appearance) }
                : {}),
              social_links: (Array.isArray(input.social_links)
                ? input.social_links
                : []
              )
                .slice(0, 12)
                .map((link) => ({
                  label: text(link.label, 40),
                  url: normalizeSocialLink(link.url),
                }))
                .filter((link) => link.url),
            };
            if (!body.name) throw fail("请填写作者名称。");
            send(await store.saveProfile(body, token));
            return;
          }
        }
        if (parts[0] === "backgrounds" && req.method === "POST") {
          const input = await json(req);
          const profile = await store.profile(token);
          const patch = changeBackground(profile, input.action, input.id);
          send(await store.saveProfile(patch, token));
          return;
        }
        if (parts[0] === "content" && kinds[parts[1]]) {
          const kind = parts[1],
            spec = kinds[kind],
            id = parts[2];
          if (req.method === "GET" && !id) {
            send(
              (
                await store.list(
                  spec.collection,
                  {
                    kind: spec.kind,
                    sort: kind === "announcements" ? "sort" : "-date_created",
                  },
                  token,
                )
              ).map(({ pending_content, ...row }) => ({
                ...row,
                hasDraft: !!pending_content,
              })),
            );
            return;
          }
          if (req.method === "GET" && id) {
            send(rowForEditor(await getItem(kind, id, token)));
            return;
          }
          if (
            (req.method === "POST" && !id) ||
            (req.method === "PATCH" && id)
          ) {
            send(await save(kind, id, await json(req), token));
            return;
          }
        }
        throw fail("内容不存在。", 404);
      } catch (error) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        send(
          {
            error: error.status
              ? error.message
              : "服务暂时不可用，请稍后重试。",
          },
          error.status || 503,
        );
      }
    },
  };
}
