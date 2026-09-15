import sanitizeHtml from "sanitize-html";
import { normalizeSocialLink } from "../src/social-links.mjs";
import { richTextAttributes, richTextStyles } from "./rich-text-policy.mjs";
import { cleanMusic, cleanAppearance } from "./profile-settings.mjs";
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
export const isPublished = (row, now = Date.now()) =>
  row.status === "published" &&
  (!row.published_at || Date.parse(row.published_at) <= now);
export function safeLink(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
export function cleanBody(body, origin, media, preview = "") {
  return sanitizeHtml(body || "", {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: {
      ...richTextAttributes,
      a: ["href", "title", "rel", "target"],
      img: ["src", "alt", "width", "height", "loading"],
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
            src: `/api/media/${id}${preview ? `?preview=${preview}` : ""}`,
            alt: attrs.alt || "",
            loading: "lazy",
            ...(Number(attrs.width) > 0
              ? { width: String(Math.min(Number(attrs.width), 8192)) }
              : {}),
            ...(Number(attrs.height) > 0
              ? { height: String(Math.min(Number(attrs.height), 8192)) }
              : {}),
          },
        };
      },
    },
  });
}
export function serializeContent(content) {
  return JSON.stringify(content)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
export function createContentService({ url, token, fetcher = fetch, store }) {
  const origin = new URL(url).origin;
  const request = async (path, { cookie, raw = false } = {}) => {
    const headers =
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
    return raw ? response : (await response.json()).data;
  };
  const mediaPath = (id, media, preview = "") => {
    if (!uuidPattern.test(id || "")) return "";
    media.add(id);
    return `/api/media/${id}${preview ? `?preview=${preview}` : ""}`;
  };
  const note = (row, media, preview = "") => ({
    id: row.slug,
    recordId: row.id,
    title: row.title || "",
    summary: row.summary || "",
    category: row.category || "随笔",
    tags: Array.isArray(row.tags)
      ? row.tags.filter((x) => typeof x === "string")
      : [],
    date: row.published_at || row.date_created,
    coverSrc: mediaPath(row.cover, media, preview),
    bodyHTML: cleanBody(row.body, origin, media, preview),
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
  async function snapshot() {
    const [articles, profile, announcements, library] = store
      ? await store.publicData()
      : await Promise.all([
          request(
            "/items/articles?" +
              new URLSearchParams({
                fields: articleFields,
                filter: JSON.stringify(publishedFilter),
                sort: "-published_at,-date_created",
                limit: "-1",
              }),
          ),
          request(
            "/items/site_profile?fields=name,signature,bio,avatar,background,social_links,music_settings,appearance",
          ),
          request(
            "/items/announcements?" +
              new URLSearchParams({
                fields: "status,title,summary,image,link,sort",
                filter: JSON.stringify({ status: { _eq: "published" } }),
                sort: "sort",
                limit: "-1",
              }),
          ),
          request(
            "/items/library_entries?" +
              new URLSearchParams({
                fields:
                  "id,kind,slug,status,title,summary,category,tags,body,cover,published_at,date_created,external_url,file.id,file.filename_download",
                filter: JSON.stringify(publishedFilter),
                sort: "-published_at",
                limit: "-1",
              }),
          ),
        ]);
    const media = new Set();
    const data = {
      source: "cms",
      works: [],
      resources: [],
      software: [],
      "resource-center": [],
      notes: (articles || [])
        .filter((row) => isPublished(row))
        .filter((row) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug))
        .map((row) => note(row, media)),
      profile: profile
        ? {
            name: profile.name || "無相",
            signature: profile.signature || "",
            bio: profile.bio || "",
            avatar: mediaPath(profile.avatar, media),
            background: mediaPath(profile.background, media),
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
          image: mediaPath(row.image, media),
          link: safeLink(row.link),
        })),
    };
    for (const track of data.profile?.music?.tracks || []) if(track.url.startsWith('/api/media/')) media.add(track.url.split('/').at(-1));
    for (const row of library || []) {
      if (!isPublished(row) || !["works", "resources", "software", "resource-center"].includes(row.kind))
        continue;
      data[row.kind].push({
        ...note(row, media),
        file: row.file?.filename_download || "",
        fileSize: row.file?.filesize || null,
        downloadUrl: row.file?.id
          ? mediaPath(row.file.id, media) + "?download=1"
          : "",
        format:
          row.file?.filename_download?.split(".").at(-1)?.toUpperCase() ||
          "资料",
        externalUrl: safeLink(row.external_url),
      });
    }
    return { data, media };
  }
  async function preview(id, cookies = "") {
    if (!uuidPattern.test(id))
      throw Object.assign(new Error("Invalid preview"), { status: 403 });
    if (store) {
      const row = await store.preview(id, cookies);
      const media = new Set();
      return { note: note(row, media, id), media };
    }
    const session = cookies
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("directus_session_token="));
    if (!session)
      throw Object.assign(new Error("Sign in to the author studio first"), {
        status: 403,
      });
    // Never substitute the service token for an author preview session.
    const row = await request(`/items/articles/${id}?fields=${articleFields}`, {
      cookie: session,
    });
    const media = new Set();
    return { note: note(row, media, id), media };
  }
  return {
    snapshot,
    preview,
    async media(id, { previewId, cookie = "", download = false, range } = {}) {
      if (!uuidPattern.test(id))
        throw Object.assign(new Error("Not found"), { status: 404 });
      const allowed = previewId
        ? (await preview(previewId, cookie)).media
        : (await snapshot()).media;
      if (!allowed.has(id))
        throw Object.assign(new Error("Not found"), { status: 404 });
      if (store) return store.readMedia(id,range);
      return request(`/assets/${id}${download ? "?download=true" : ""}`, {
        raw: true,
      });
    },
  };
}
