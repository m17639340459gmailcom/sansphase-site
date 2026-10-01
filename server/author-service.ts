import sanitizeHtml from "sanitize-html";
import { MAX_BODY_LENGTH } from './content-limits.ts';
import {normalizeBodyLinks} from '../src/body-links.mjs';
import { normalizeSocialLink } from "../src/social-links.mjs";
import { richTextAttributes, richTextStyles } from "./rich-text-policy.ts";
import { cleanMusic, cleanAppearance } from "./profile-settings.ts";
import { backgroundLibrary, changeBackground } from "./background-library.ts";
import {applyContentOrder,validateContentOrder,orderedContentKinds} from './content-order.ts';
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { uuidPattern, safeLink } from "./content-service.ts";
import { clientAddress } from './client-ip.ts';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { createPayloadStore } from './payload/store.ts';

type ContentKind = 'articles' | 'works' | 'resources' | 'software' | 'resource-center' | 'announcements';
type ContentRow = {
  id: string; kind?: string; status?: string; updatedAt?: string; date_updated?: string;
  published_at?: string | null; body?: string; pending_content?: Record<string, unknown> | null;
  attachments?: Array<{ id: string; directus_files_id: string | { id?: string } | null }>;
  [key: string]: unknown;
};
type AuthorInput = Record<string, unknown>;
type ValidatedContent = { title: string; summary: string; body?: string; attachments?: string[]; [key: string]: unknown };
type LoginLedger = { record: (entry: { actorType: 'owner'; actorId: string; email: string; address: ReturnType<typeof clientAddress>; userAgent: string | undefined }) => unknown };
type AuthorOptions = { url: string; authorId: string; siteOrigin?: string; store: ReturnType<typeof createPayloadStore>; loginLedger?: LoginLedger };
const errorStatus = (error: unknown): number | undefined => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const cookieName = "sansphase_author_session";
const kinds: Record<string, { collection: string; kind?: string }> = {
  articles: { collection: "articles" },
  works: { collection: "library_entries", kind: "works" },
  resources: { collection: "library_entries", kind: "resources" },
  software: { collection: "library_entries", kind: "software" },
  "resource-center": {collection:"library_entries",kind:"resource-center"},
  announcements: { collection: "announcements" },
};
const fail = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });
export function assertAuthorOrigin(headers: IncomingHttpHeaders, origin: string) {
  if (headers.origin !== origin || headers["x-author-request"] !== "1")
    throw fail("请求来源验证失败，请从本站操作。", 403);
}
const text = (value: unknown, max = 200) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const file = (value: unknown): string | null =>
  value === null || value === ""
    ? null
    : typeof value === 'string' && uuidPattern.test(value)
      ? value
      : (() => {
          throw fail("文件编号无效。");
      })();
// Payload maintains updatedAt for every write, including imported records whose
// legacy date_updated is empty. Keep the editor's existing transport field.
const contentRevision = (row: ContentRow) => row.updatedAt || row.date_updated;
export function validateArticle(input: AuthorInput, kind: ContentKind): ValidatedContent {
  const title = text(input.title),
    slug = text(input.slug, 120);
  if (!title) throw fail("请填写标题。");
  if (kind !== "announcements" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw fail("网址名称请使用小写英文、数字和短横线。");
  if (typeof input.body === "string" && input.body.length > MAX_BODY_LENGTH)
    throw fail("正文超过当前长度限制。");
  const result: ValidatedContent = { title, summary: text(input.summary, 2000) };
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
    body: sanitizeHtml(normalizeBodyLinks(input.body), {
      allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
      allowedAttributes: {
        ...richTextAttributes,
        a: ["href", "title"],
        img: ["src", "alt", "width", "height", "data-book-block"],
        code: ["class"],
        td: ["colspan", "rowspan"],
        th: ["colspan", "rowspan"],
      },
      allowedSchemes: ["http", "https", "mailto"],
      allowedStyles: richTextStyles,
      allowProtocolRelative: false,
    }),
  });
  if (['works','resources'].includes(kind) && Object.hasOwn(input,'showcase_cover'))
    result.showcase_cover = file(input.showcase_cover || null);
  if (kind === 'resource-center' && Object.hasOwn(input,'vip_only'))
    result.vip_only = input.vip_only === true;
  if (kind === "articles")
    result.attachments = (
      Array.isArray(input.attachments) ? input.attachments : []
    )
      .slice(0, 20)
      .map((value) => file(value))
      .filter((value): value is string => Boolean(value));
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
  loginLedger,
}: AuthorOptions) {
  const cms = new URL(url).origin;
  const session = (req: IncomingMessage) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || "";
  const cookieHeader = (token: string) =>
    `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 86400 : 0}${siteOrigin.startsWith("https:") ? "; Secure" : ""}`;
  if (!store) throw new Error('Author storage must be explicitly configured.');
  let orderQueue: Promise<unknown> = Promise.resolve();
  async function orderedRows(kind: string,token: string): Promise<ContentRow[]> {
    const spec=kinds[kind];
    const rows=await store.list(spec.collection,{kind:spec.kind,sort:kind==='announcements'?'sort':['-published_at',kind==='articles'?'-date_created':'date_created']},token) as ContentRow[];
    if(!orderedContentKinds.includes(kind))return rows;
    return applyContentOrder(rows,(await store.profile(token)).content_order?.[kind]);
  }
  async function reorder(kind: string,input: unknown,token: string) {
    if(!orderedContentKinds.includes(kind))throw fail('不支持的内容类型。',404);
    // Serialize the single metadata write across kinds in this single-process site.
    const operation=orderQueue.then(async()=>{
      const ids=validateContentOrder(input,(await orderedRows(kind,token)).map(row=>row.id));
      const profile=await store.profile(token);
      await store.saveProfile({content_order:{...profile.content_order,[kind]:ids}},token);
      return {ids};
    });
    orderQueue=operation.catch(()=>{});
    return operation;
  }
  async function authorize(token: string) {
    if (!token || !authorId) throw fail("请先登录作者账号。", 401);
    const user = await store.identity(token);
    if (user.id !== authorId)
      throw fail("这个账号没有个人网站的作者权限。", 403);
    return { name: user.first_name || "作者" };
  }
  const readBody = async (req: IncomingMessage, max = 1024 * 1024) => {
    if (Number(req.headers["content-length"]) > max)
      throw fail("请求内容太大。", 413);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > max) throw fail("请求内容太大。", 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const json = async (req: IncomingMessage): Promise<AuthorInput> => {
    try {
      return JSON.parse((await readBody(req)).toString("utf8")) as AuthorInput;
    } catch (error) {
      if (errorStatus(error)) throw error;
      throw fail("请求格式无效。");
    }
  };
  const editorBody = (value: unknown) =>
    String(value || "")
      .replace(/\/api\/media\/([0-9a-f-]+)/g, "/api/author/media/$1")
      .replace(
        new RegExp(
          `${cms.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/assets/([0-9a-f-]+)`,
          "g",
        ),
        "/api/author/media/$1",
      );
  const persistedBody = (value: unknown) =>
    String(value || "").replace(
      /(?:https?:\/\/[^/"'\s]+)?\/api\/author\/media\/([0-9a-f-]+)/g,
      `${store.mediaPrefix || `${cms}/assets`}/$1`,
    );
  const rowForEditor = (row: ContentRow) => ({
    ...row,
    ...(row.pending_content || {}),
    date_updated: contentRevision(row),
    body: editorBody(row.pending_content?.body ?? row.body),
    attachments:
      row.pending_content?.attachments ??
      (row.attachments || []).map(
        (x) => {
          const linked = x.directus_files_id;
          return linked && typeof linked === 'object' ? linked.id || linked : linked;
        },
      ),
    pending_content: undefined,
  });
  async function getItem(kind: string, id: string, token: string): Promise<ContentRow> {
    const spec = kinds[kind];
    if (!spec || !uuidPattern.test(id)) throw fail("内容不存在。", 404);
    const row = await store.get(spec.collection, id, token) as ContentRow;
    if (spec.kind && row.kind !== spec.kind) throw fail("内容不存在。", 404);
    return row;
  }
  async function save(kind: string, id: string | undefined, body: AuthorInput, token: string) {
    const spec = kinds[kind];
    if (!spec) throw fail("不支持的内容类型。", 404);
    const action = body.action;
    if (typeof action !== 'string' || !["draft", "publish", "unpublish"].includes(action))
      throw fail("请选择保存草稿或发布。");
    const previous = id ? await getItem(kind, id, token) : null;
    if (action === "unpublish") {
      if (!id) throw fail("请先保存内容。");
      return store.save(spec.collection, id, { status: "draft" }, token);
    }
    if (
      previous &&
      body.expectedUpdated &&
      contentRevision(previous) !== body.expectedUpdated
    )
      throw fail("内容已在其他窗口修改，请重新打开后编辑。", 409);
    const values = validateArticle(body, kind as ContentKind);
    if (values.body !== undefined) values.body = persistedBody(values.body);
    if (action === "draft" && previous?.status === "published") {
      await store.save(spec.collection, id, { pending_content: values }, token);
      return rowForEditor(await getItem(kind, id!, token));
    }
    const payload: Record<string, unknown> = {
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
            delete: (previous!.attachments || []).map((x) => x.id),
            create: (values.attachments || []).map((id) => ({ directus_files_id: id })),
          }
        : (values.attachments || []).map((id) => ({ directus_files_id: id }));
    const saved = await store.save(spec.collection, id, payload, token);
    return rowForEditor(await getItem(kind, String(saved.id), token));
  }
  return {
    async loginCredentials(res: ServerResponse, { email, password }: { email?: unknown; password?: unknown }, req: IncomingMessage) {
      const token = await store.login({ email: text(email, 254), password: String(password || '') });
      const identity = await authorize(token);
      if (loginLedger) {
        try { loginLedger.record({ actorType: 'owner', actorId: authorId, email: email as string, address: clientAddress(req), userAgent: req.headers['user-agent'] }); }
        catch (error) { await store.logout(token); throw fail('登录记录暂时无法保存，请稍后再试。', 503); }
      }
      res.setHeader('Set-Cookie', cookieHeader(token));
      return identity;
    },
    async identity(req: IncomingMessage) {
      try {
        return await authorize(session(req));
      } catch (error) {
        if ([401, 403].includes(errorStatus(error) || 0)) return null;
        throw error;
      }
    },
    async handle(req: IncomingMessage, res: ServerResponse) {
      const parsed = new URL(req.url || '', siteOrigin),
        parts = parsed.pathname.slice("/api/author/".length).split("/");
      const send = (data: unknown, status = 200) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(data));
      };
      try {
        if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method || ''))
          throw fail("不支持的操作。", 405);
        if (req.method !== "GET") assertAuthorOrigin(req.headers, siteOrigin);
        let token = session(req);
        if (parts[0] === "login" && req.method === "POST") {
          const body = await json(req);
          send(await this.loginCredentials(res, body, req));
          return;
        }
        if (parts[0] === "session" && req.method === "GET") {
          send(await this.identity(req));
          return;
        }
        await authorize(token);
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
            if(!upload || typeof upload === 'string' || typeof upload.arrayBuffer!=='function') throw fail('请选择文件。');
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
            res.setHeader('Content-Length', upstream.headers.get('content-length')!);
          if (!upstream.body) throw fail('媒体暂不可用。', 503);
          await pipeline(Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream), res);
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
                ? { music_settings: cleanMusic(input.music_settings as Parameters<typeof cleanMusic>[0]) }
                : {}),
              ...(Object.hasOwn(input, "appearance")
                ? { appearance: cleanAppearance(input.appearance as Parameters<typeof cleanAppearance>[0]) }
                : {}),
              social_links: ((Array.isArray(input.social_links)
                ? input.social_links
                : []
              ) as Array<{ label?: unknown; url?: unknown }>)
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
          const patch = changeBackground(profile, input.action as string, input.id as string);
          send(await store.saveProfile(patch, token));
          return;
        }
        if (parts[0] === "content" && kinds[parts[1]]) {
          const kind = parts[1],
            spec = kinds[kind],
            id = parts[2];
          if (req.method === "GET" && !id) {
            send(
              (await orderedRows(kind,token)).map(({ pending_content, ...row }) => ({
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
          if(req.method==='POST'&&id==='reorder') {
            send(await reorder(kind,await json(req),token));return;
          }
          if(req.method==='DELETE' && id && parts.length===3) {
            const row=await getItem(kind,id,token),input=await json(req);
            if(input.confirmId!==id)throw fail('请确认要删除的内容。');
            if(!input.expectedUpdated || input.expectedUpdated!==contentRevision(row))
              throw fail('内容已在其他窗口修改，请重新打开后编辑。',409);
            await store.remove(spec.collection,id,input.expectedUpdated as string,token);
            send({deleted:true,id});return;
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
            error: errorStatus(error)
              ? errorMessage(error)
              : "服务暂时不可用，请稍后重试。",
          },
          errorStatus(error) || 503,
        );
      }
    },
  };
}
