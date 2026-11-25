import { z } from "zod";

const previewHost = "localhost:4308";
const authorCookie = "sansphase_author_session";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const recordId = new RegExp(`^${uuid}$`, "i");
const mediaBase = "/api/author/media/";

function ownerCookie(session: string) {
  return /^[a-z\d._~-]+$/i.test(session) ? `${authorCookie}=${session}` : null;
}

function privateMediaUrl(pathname: string, search: string, origin: URL) {
  if (!pathname.startsWith(mediaBase) || !recordId.test(pathname.slice(mediaBase.length)) ||
    (search && !search.startsWith("?")) || search.includes("#")) return null;
  const params = new URLSearchParams(search);
  if (new Set(params.keys()).size !== params.size) return null;
  for (const [name, value] of params) {
    if (name === "w" && /^\d{1,4}$/.test(value) && Number(value) > 0 && Number(value) <= 8192) continue;
    if (name === "view" && value === "content") continue;
    if (name === "download" && value === "1") continue;
    return null;
  }
  return new URL(pathname + search, origin);
}

export function planLocalBookMediaRequest(
  { method, pathname, search, headers }: { method: string; pathname: string; search: string; headers: Headers },
  origin: URL | null,
) {
  if (!origin || method !== "GET" || headers.get("host") !== previewHost) return null;
  if (headers.get("sec-fetch-site") === "cross-site") return null;
  const session = headers.get("cookie")?.split(";").map((value) => value.trim())
    .find((value) => value.startsWith(`${authorCookie}=`))?.slice(authorCookie.length + 1);
  const cookie = session && ownerCookie(session);
  const destination = privateMediaUrl(pathname, search, origin);
  if (!cookie || !destination) return null;
  return { destination, headers: new Headers({ cookie, host: origin.host }) };
}

const chapterSchema = z.object({
  id: z.string().min(1).max(160).refine((id) => id !== "." && id !== ".." && !/[\\/]/.test(id)),
  title: z.string(),
  parts: z.number().int().positive(),
});
const draftSchema = z.object({
  recordId: z.string().regex(recordId),
  previewId: z.string().regex(recordId),
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  category: z.string(),
  vipOnly: z.boolean(),
  coverSrc: z.string(),
  book: z.object({ revision: z.string(), chapters: z.array(chapterSchema).min(1) }),
});
const partSchema = z.object({ revision: z.string(), chapter: z.string(), part: z.number(), parts: z.number(), html: z.string() });
export type LocalBookDraft = z.infer<typeof draftSchema>;

async function requestBook(origin: URL, cookie: string, query: Record<string, string>, fetcher: typeof fetch) {
  const url = new URL("/api/content", origin);
  url.search = new URLSearchParams({ ...query, previewKind: "resource-center" }).toString();
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? await response.json() as unknown : null;
  } catch {
    return null;
  }
}

export async function loadLocalBookDraft(origin: URL | null, session: string, id: string, fetcher = fetch) {
  const cookie = ownerCookie(session);
  if (!origin || !cookie || !recordId.test(id)) return null;
  const response = await requestBook(origin, cookie, { preview: id }, fetcher);
  const result = z.object({ preview: draftSchema }).safeParse(response);
  if (!result.success || result.data.preview.previewId !== id || result.data.preview.recordId !== id) return null;
  const draft = result.data.preview;
  if (!draft.coverSrc.startsWith(mediaBase) || draft.coverSrc.includes("#")) draft.coverSrc = "";
  if (draft.coverSrc) {
    const url = new URL(draft.coverSrc, origin);
    if (!privateMediaUrl(url.pathname, url.search, origin)) draft.coverSrc = "";
  }
  return draft;
}

export async function loadLocalBookChapter(
  origin: URL,
  session: string,
  draft: LocalBookDraft,
  chapter: z.infer<typeof chapterSchema>,
  fetcher = fetch,
) {
  const cookie = ownerCookie(session);
  if (!cookie) return null;
  const fragments: string[] = [];
  for (let part = 0; part < chapter.parts; part++) {
    const response = await requestBook(origin, cookie, {
      preview: draft.previewId, view: "book-part", kind: "resource-center", id: draft.id, chapter: chapter.id, part: String(part),
    }, fetcher);
    const result = partSchema.safeParse(response);
    if (!result.success || result.data.revision !== draft.book.revision || result.data.chapter !== chapter.id ||
      result.data.part !== part || result.data.parts !== chapter.parts) return null;
    fragments.push(result.data.html);
  }
  return fragments.join("");
}
