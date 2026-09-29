import sanitizeHtml from "sanitize-html";
import {normalizeBodyLinks} from '../src/body-links.mjs';
import {applyContentOrder} from './content-order.ts';
import {imageSourceSet} from '../src/image-sources.mjs';
import { normalizeSocialLink } from "../src/social-links.mjs";
import { richTextAttributes, richTextStyles } from "./rich-text-policy.ts";
import { cleanMusic, cleanAppearance } from "./profile-settings.ts";
import {createPublicSnapshotCache} from './public-snapshot.ts';
import type { createPayloadStore } from './payload/store.ts';

type ImageSize = { width?: number; height?: number };
type MediaFile = { id: string; title?: string; filename_download?: string; filesize?: number };
type ContentRow = {
  id: string; slug: string; status: string; kind?: string; title?: string; summary?: string;
  category?: string; tags?: unknown[]; body?: string; cover?: string; showcase_cover?: string;
  image?: string; link?: string; published_at?: string | null; date_created?: string;
  vip_only?: boolean; imageDimensions?: Record<string, ImageSize>;
  attachments?: Array<{ directus_files_id: MediaFile | null }>;
  file?: MediaFile | null; external_url?: string;
};
type ProfileRow = { name?: string; signature?: string; bio?: string; avatar?: string; background?: string;
  music_settings?: Parameters<typeof cleanMusic>[0]; appearance?: Parameters<typeof cleanAppearance>[0];
  social_links?: Array<{ label?: string; url?: string }>;
  content_order?: Record<string, string[]> };
type PublicRows = [ContentRow[], ProfileRow | null, ContentRow[], ContentRow[], number?];
type ContentStore = Pick<ReturnType<typeof createPayloadStore>, 'publicData' | 'preview' | 'readMedia'>;
type ContentOptions = { url: string; token?: string; fetcher?: typeof fetch; store?: ContentStore; revision?: () => unknown };
type LibraryKind = 'works' | 'resources' | 'software' | 'resource-center';
type MediaOptions = { previewId?: string; cookie?: string; download?: boolean; range?: string; width?: number; presentation?: boolean; member?: boolean; vip?: boolean };
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const articleFields =
  "id,slug,status,title,summary,category,tags,body,cover,published_at,date_created,attachments.directus_files_id.id,attachments.directus_files_id.filename_download,attachments.directus_files_id.title";
const publishedFilter = {
  _and: [
    { status: { _eq: "published" } },
    {
      _or: [
        { published_at: { _null: true } },
        { published_at: { _lte: "$NOW" } },
      ],
    },
  ],
};
export const isPublished = (row: Pick<ContentRow, 'status' | 'published_at'>, now = Date.now()) =>
  row.status === "published" &&
  (!row.published_at || Date.parse(row.published_at) <= now);
export function safeLink(value: unknown) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
export function cleanBody(body: unknown, origin: string, media: Set<string>, preview = "", dimensions: Record<string, ImageSize> = {}) {
  return sanitizeHtml(normalizeBodyLinks(body), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: {
      ...richTextAttributes,
      a: ["href", "title", "rel", "target"],
      img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding", "data-book-block"],
      code: ["class"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedStyles: richTextStyles,
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: "a",
        attribs: {
          href: attrs.href || "",
          title: attrs.title || "",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      img: (_tag, attrs) => {
        let id;
        try {
          const url = new URL(attrs.src, origin);
          if (url.origin === new URL(origin).origin)
            id = /^\/(?:assets|api\/media)\/([0-9a-f-]+)$/.exec(
              url.pathname,
            )?.[1];
        } catch {}
        if (!id || !uuidPattern.test(id))
          return { tagName: "span", attribs: {} };
        media.add(id);
        return {
          tagName: "img",
          attribs: {
            ...(attrs['data-book-block']?{'data-book-block':attrs['data-book-block']}:{}),
            src: `/api/media/${id}?w=1280&view=content${preview ? `&preview=${preview}` : ""}`,
            srcset: imageSourceSet(`/api/media/${id}?view=content${preview ? `&preview=${preview}` : ''}`,dimensions[id]?.width),
            sizes: '(max-width: 960px) 100vw, 960px',
            decoding: 'async',
            alt: attrs.alt || "",
            loading: "lazy",
            ...(Number(dimensions[id]?.width || attrs.width) > 0
              ? { width: String(Math.min(Number(dimensions[id]?.width || attrs.width), 8192)) }
              : {}),
            ...(Number(dimensions[id]?.height || attrs.height) > 0
              ? { height: String(Math.min(Number(dimensions[id]?.height || attrs.height), 8192)) }
              : {}),
          },
        };
      },
    },
  });
}
export function serializeContent(content: object) {
  return JSON.stringify(content)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
export function createContentService({ url, token, fetcher = fetch, store, revision }: ContentOptions) {
  const origin = new URL(url).origin;
  const request = async <T = unknown>(path: string, { cookie, raw = false }: { cookie?: string; raw?: boolean } = {}): Promise<T> => {
    const headers: Record<string, string> =
      cookie === undefined
        ? { Authorization: `Bearer ${token}` }
        : { Cookie: cookie };
    const response = await fetcher(origin + path, {
      headers,
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok)
      throw Object.assign(new Error("Content service unavailable"), {
        status: response.status,
      });
    return (raw ? response : (await response.json()).data) as T;
  };
  const mediaPath = (id: string | null | undefined, media: Set<string>, preview = "", width = 0) => {
    if (!id || !uuidPattern.test(id)) return "";
    media.add(id);
    const params = new URLSearchParams();
    if (preview) params.set('preview', preview);
    if (width) params.set('w', String(width));
    return `/api/media/${id}${params.size ? `?${params}` : ''}`;
  };
  const note = (row: ContentRow, media: Set<string>, preview = "") => ({
    id: row.slug,
    recordId: row.id,
    title: row.title || "",
    summary: row.summary || "",
    ...(row.kind === 'resource-center' ? {vipOnly: row.vip_only === true} : {}),
    category: row.category || "随笔",
    tags: Array.isArray(row.tags)
      ? row.tags.filter((x) => typeof x === "string")
      : [],
    date: row.published_at || row.date_created,
    coverSrc: uuidPattern.test(row.cover || '') ? mediaPath(row.cover, media, preview, 960) + '&view=content' : '',
    ...(['works','resources'].includes(row.kind || '') && uuidPattern.test(row.showcase_cover || '') ? {
      showcaseSrc: mediaPath(row.showcase_cover, media, preview, 1280) + '&view=content',
      showcaseWidth: row.showcase_cover ? row.imageDimensions?.[row.showcase_cover]?.width : undefined,
      showcaseHeight: row.showcase_cover ? row.imageDimensions?.[row.showcase_cover]?.height : undefined,
    } : {}),
    ...(row.cover && row.imageDimensions?.[row.cover] ? {coverWidth:row.imageDimensions[row.cover].width,coverHeight:row.imageDimensions[row.cover].height} : {}),
    bodyHTML: cleanBody(row.body, origin, media, preview,row.imageDimensions),
    attachments: (row.attachments || []).flatMap(
      ({ directus_files_id: file }) =>
        file && uuidPattern.test(file.id)
          ? [
              {
                name: file.title || file.filename_download || "附件",
                url:
                  mediaPath(file.id, media, preview) +
                  (preview ? "&" : "?") +
                  "download=1",
              },
            ]
          : [],
    ),
  });
  async function buildSnapshot() {
    const [articles, profile, announcements, library, nextPublicationAt] = (store
      ? await store.publicData()
      : await Promise.all([
          request<ContentRow[]>(
            "/items/articles?" +
              new URLSearchParams({
                fields: articleFields,
                filter: JSON.stringify(publishedFilter),
                sort: "-published_at,-date_created",
                limit: "-1",
              }),
          ),
          request<ProfileRow | null>(
            "/items/site_profile?fields=name,signature,bio,avatar,background,social_links,music_settings,appearance",
          ),
          request<ContentRow[]>(
            "/items/announcements?" +
              new URLSearchParams({
                fields: "status,title,summary,image,link,sort",
                filter: JSON.stringify({ status: { _eq: "published" } }),
                sort: "sort",
                limit: "-1",
              }),
          ),
          request<ContentRow[]>(
            "/items/library_entries?" +
              new URLSearchParams({
                fields:
                  "id,kind,slug,status,title,summary,category,tags,body,cover,vip_only,published_at,date_created,external_url,file.id,file.filename_download",
                filter: JSON.stringify(publishedFilter),
                sort: "-published_at",
                limit: "-1",
              }),
          ),
        ])) as PublicRows;
    const publicMedia = new Set<string>();
    const memberMedia = new Set<string>();
    const vipMedia = new Set<string>();
    const data = {
      source: "cms",
      works: [] as Array<ReturnType<typeof note> & Record<string, unknown>>,
      resources: [] as Array<ReturnType<typeof note> & Record<string, unknown>>,
      software: [] as Array<ReturnType<typeof note> & Record<string, unknown>>,
      "resource-center": [] as Array<ReturnType<typeof note> & Record<string, unknown>>,
      notes: applyContentOrder(articles || [],profile?.content_order?.articles)
        .filter((row) => isPublished(row))
        .filter((row) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug))
        .map((row) => note(row, publicMedia)),
      profile: profile
        ? {
            name: profile.name || "無相",
            signature: profile.signature || "",
            bio: profile.bio || "",
            avatar: uuidPattern.test(profile.avatar || '') ? mediaPath(profile.avatar, publicMedia, '', 384) + '&view=content' : '',
            background: uuidPattern.test(profile.background || '') ? mediaPath(profile.background, publicMedia, '', 1920) + '&view=content' : '',
            music: cleanMusic(profile.music_settings),
            appearance: cleanAppearance(profile.appearance),
            socialLinks: (Array.isArray(profile.social_links)
              ? profile.social_links
              : []
            )
              .map((link) => ({
                label: String(link.label || ""),
                url: normalizeSocialLink(link.url),
              }))
              .filter((link) => link.url),
          }
        : null,
      announcements: (announcements || [])
        .filter((row) => row.status === "published")
        .map((row) => ({
          title: row.title || "",
          summary: row.summary || "",
          image: uuidPattern.test(row.image || '') ? mediaPath(row.image, publicMedia, '', 960) + '&view=content' : '',
          link: safeLink(row.link),
        })),
    };
    for (const track of data.profile?.music?.tracks || []) if(track.url.startsWith('/api/media/')) publicMedia.add(track.url.split('/').at(-1) as string);
    for (const row of library || []) {
      if (!isPublished(row) || !["works", "resources", "software", "resource-center"].includes(row.kind || ''))
        continue;
      const protectedBook = row.kind === 'resource-center' && row.vip_only === true;
      const itemMedia = protectedBook ? vipMedia : memberMedia;
      data[row.kind as LibraryKind].push({
        ...note(row, itemMedia),
        file: row.file?.filename_download || "",
        fileSize: row.file?.filesize || null,
        downloadUrl: row.file?.id
          ? mediaPath(row.file.id, itemMedia) + "?download=1"
          : "",
        format:
          row.file?.filename_download?.split(".").at(-1)?.toUpperCase() ||
          "资料",
        externalUrl: safeLink(row.external_url),
      });
      // Cover art remains visible in the public catalogue while the body and
      // downloadable media require an active membership.
      if (protectedBook && row.cover && uuidPattern.test(row.cover)) memberMedia.add(row.cover);
    }
    for(const kind of ['works','resources','software','resource-center'] as LibraryKind[])
      data[kind]=applyContentOrder(data[kind],profile?.content_order?.[kind],'recordId');
    return { data, media:new Set([...publicMedia,...memberMedia,...vipMedia]), publicMedia,
      memberMedia:new Set([...publicMedia,...memberMedia]), vipMedia, expiresAt:nextPublicationAt ?? Infinity };
  }
  const snapshot=revision ? createPublicSnapshotCache({load:buildSnapshot,revision}) : buildSnapshot;
  async function preview(id: string, cookies = "", kind='articles') {
    if (!uuidPattern.test(id))
      throw Object.assign(new Error("Invalid preview"), { status: 403 });
    if (store) {
      const row = await store.preview(id, cookies, kind) as ContentRow;
      const media = new Set<string>();
      if(kind==='resource-center'){
        const item=note(row,media,id);
        // Private previews use the existing owner-authorized media route.
        item.bodyHTML=item.bodyHTML.replace(/\/api\/media\/[0-9a-f-]{36}[^"\s<]*/gi,source=>source.replace('/api/media/','/api/author/media/').replace(/(?:&amp;|&)preview=[^&\s"]+/g,''));
        item.coverSrc=row.cover?`/api/author/media/${row.cover}?w=960`:'';
        return {note:{...item,previewId:id,kind,file:row.file?.filename_download||'',downloadUrl:row.file?.id?`/api/author/media/${row.file.id}?download=1`:'',externalUrl:safeLink(row.external_url)},media};
      }
      return { note: note(row, media, id), media };
    }
    if(kind!=='articles')throw Object.assign(new Error('Preview unavailable'),{status:404});
    const session = cookies
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("directus_session_token="));
    if (!session)
      throw Object.assign(new Error("Sign in to the author studio first"), {
        status: 403,
      });
    // Never substitute the service token for an author preview session.
    const row = await request<ContentRow>(`/items/articles/${id}?fields=${articleFields}`, {
      cookie: session,
    });
    const media = new Set<string>();
    return { note: note(row, media, id), media };
  }
  return {
    snapshot,
    preview,
    async media(id: string, { previewId, cookie = "", download = false, range, width, presentation = false, member = true, vip = true }: MediaOptions = {}) {
      if (!uuidPattern.test(id))
        throw Object.assign(new Error("Not found"), { status: 404 });
      const state=previewId ? null : await snapshot();
      const allowed = previewId
        ? (await preview(previewId, cookie)).media
        : vip ? state!.media : member ? (state!.memberMedia || state!.media) : (state!.publicMedia || state!.media);
      if (!allowed.has(id))
        throw Object.assign(new Error("Not found"), { status: 404 });
      if (store) return store.readMedia(id,range, download ? undefined : width,{streaming:!download,presentation:!download && presentation});
      return request(`/assets/${id}${download ? "?download=true" : ""}`, {
        raw: true,
      });
    },
  };
}
