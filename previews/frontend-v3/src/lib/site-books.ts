import { z } from "zod";
import { siteContentMedia } from "./site-articles";
import type { SiteBookPosition } from "./site-book-position";
import { notePublishedAt } from "./site-publication-date";
import { readSiteContent } from "./site-reader-request";

const bookId = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const chapterId = z.string().max(160).regex(/^[a-z\d_-]+$/i);
const heading = z.object({ title: z.string().trim().min(1), level: z.union([z.literal(2), z.literal(3), z.literal(4)]), block: chapterId, offset: z.int().nonnegative(), part: z.int().nonnegative().optional() });
const summary = z.object({
  id: bookId,
  title: z.string().trim().min(1),
  summary: z.string().default(""),
  category: z.string().default(""),
  tags: z.array(z.string()).default([]),
  date: z.string(),
  coverSrc: z.string().default(""),
  coverWidth: z.int().positive().optional(),
  coverHeight: z.int().positive().optional(),
  locked: z.boolean().default(false),
  vipOnly: z.boolean().default(false),
});
const chapter = z.object({ id: chapterId, title: z.string(), parts: z.int().positive(), headings: z.array(heading).catch([]).default([]) });
const manifest = z.object({ revision: z.string().min(1), chapters: z.array(chapter).min(1) });
const detail = summary.extend({
  book: manifest,
  recordId: z.union([z.string().min(1).max(160), z.int().positive()]).optional(),
  downloadUrl: z.string().default(""),
});
const fragment = z.object({
  revision: z.string(),
  chapter: chapterId,
  part: z.int().nonnegative(),
  parts: z.int().positive(),
  relocated: z.boolean().default(false),
  html: z.string(),
});
const list = z.object({
  items: z.array(summary).max(12),
  page: z.int().positive(),
  pages: z.int().positive().max(100),
  total: z.int().nonnegative(),
});
const membershipError = z.object({ code: z.literal("VIP_REQUIRED"), item: summary.optional() });
type SiteBookSummary = ReturnType<typeof catalogueEntry>;
export type SiteBookChapter = z.infer<typeof chapter>;

function catalogueEntry(book: z.infer<typeof summary>) {
  const tags = [book.category, ...book.tags].map((tag) => tag.trim()).filter(Boolean);
  return {
    slug: book.id,
    href: `/resources/${book.id}`,
    title: book.title,
    description: book.summary,
    category: book.category,
    tags: [...new Set(tags)],
    date: notePublishedAt(book.date)?.slice(0, 10) ?? "",
    locked: book.locked,
    vipOnly: book.vipOnly,
    cover: siteContentMedia(book.coverSrc, "cover") ?? undefined,
    coverSize: book.coverWidth && book.coverHeight ? { width: book.coverWidth, height: book.coverHeight } : undefined,
  };
}

function requestBook(origin: string, cookie: string | null, query: Record<string, string>, request: typeof fetch) {
  return readSiteContent(origin, new URLSearchParams({ ...query, kind: "resource-center" }), cookie, request);
}

async function readBookListPage(origin: string, cookie: string | null, page: number, request: typeof fetch) {
  const response = await requestBook(origin, cookie, { view: "list", page: String(page) }, request);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Book catalogue unavailable");
  const result = list.safeParse(await response.json());
  if (!result.success || result.data.page !== page || result.data.pages !== Math.max(1, Math.ceil(result.data.total / 12))) {
    throw new Error("Invalid book catalogue page");
  }
  const expectedItems = Math.min(12, Math.max(0, result.data.total - (page - 1) * 12));
  if (result.data.items.length !== expectedItems) throw new Error("Book catalogue changed during loading");
  return result.data;
}

export async function readSiteBooks(origin: string, cookie: string | null, request = fetch): Promise<
  { status: "ready"; books: SiteBookSummary[] } | { status: "sign-in" }
> {
  const first = await readBookListPage(origin, cookie, 1, request);
  if (!first) return { status: "sign-in" };
  const items = [...first.items];
  // Existing V3 search and sort operate across the shelf. Read summaries only
  // and cap parallel requests while preserving all published catalogue pages.
  for (let start = 2; start <= first.pages; start += 4) {
    const pages = await Promise.all(Array.from({ length: Math.min(4, first.pages - start + 1) }, (_, index) =>
      readBookListPage(origin, cookie, start + index, request)));
    for (const current of pages) {
      if (!current) return { status: "sign-in" };
      if (current.total !== first.total) throw new Error("Book catalogue changed during loading");
      items.push(...current.items);
    }
  }
  if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error("Book catalogue changed during loading");
  return { status: "ready", books: items.map(catalogueEntry) };
}

type SiteBook = SiteBookSummary & { revision: string; readingKey: string; chapters: SiteBookChapter[]; download: string | null };
type BookResult =
  | { status: "ready"; book: SiteBook }
  | { status: "vip-required"; book: SiteBookSummary | null }
  | { status: "sign-in" }
  | { status: "missing" };

export async function readSiteBook(origin: string, cookie: string | null, id: string, request = fetch): Promise<BookResult> {
  if (!bookId.safeParse(id).success) return { status: "missing" };
  const response = await requestBook(origin, cookie, { view: "detail", id }, request);
  if (response.status === 401) return { status: "sign-in" };
  if (response.status === 404) return { status: "missing" };
  if (response.status === 403) {
    const denied = membershipError.safeParse(await response.json().catch(() => null));
    if (!denied.success) return { status: "missing" };
    const metadata = denied.data.item;
    return { status: "vip-required", book: metadata?.id === id ? catalogueEntry(metadata) : null };
  }
  if (!response.ok) throw new Error("Book service unavailable");
  const result = z.object({ item: detail }).safeParse(await response.json());
  if (!result.success || result.data.item.id !== id || result.data.item.locked) return { status: "missing" };
  const book = result.data.item;
  return { status: "ready", book: {
    ...catalogueEntry(book),
    revision: book.book.revision,
    readingKey: String(book.recordId ?? book.id),
    chapters: book.book.chapters,
    download: siteContentMedia(book.downloadUrl, "download"),
  } };
}

export async function readSiteBookPart(
  origin: string, cookie: string | null, id: string, revision: string, item: SiteBookChapter, selection: number | SiteBookPosition, request = fetch,
): Promise<{ status: "ready"; html: string; part: number; relocated: boolean } | { status: "sign-in" | "vip-required" | "changed" }> {
  const position = typeof selection === "number" ? null : selection;
  const part = typeof selection === "number" ? selection : 0;
  if (!Number.isSafeInteger(part) || part < 0 || part >= item.parts) return { status: "changed" };
  const query = { view: "book-part", id, chapter: item.id, part: String(part), ...(position && { block: position.block, offset: String(position.offset) }) };
  const response = await requestBook(origin, cookie, query, request);
  if (response.status === 401) return { status: "sign-in" };
  if (response.status === 404) return { status: "changed" };
  if (response.status === 403) {
    const denied = membershipError.safeParse(await response.json().catch(() => null));
    return { status: denied.success ? "vip-required" : "changed" };
  }
  if (!response.ok) throw new Error("Book chapter unavailable");
  const result = fragment.safeParse(await response.json());
  if (!result.success || result.data.revision !== revision || result.data.chapter !== item.id ||
    (!position && result.data.part !== part) || result.data.part >= item.parts || result.data.parts !== item.parts) return { status: "changed" };
  // The existing content service sanitizes HTML before fragmenting chapters.
  return { status: "ready", html: result.data.html, part: result.data.part, relocated: result.data.relocated };
}

export async function readSiteBookChapter(
  origin: string, cookie: string | null, id: string, revision: string, item: SiteBookChapter, selection: number | SiteBookPosition, request = fetch,
): Promise<{ status: "ready"; fragments: string[]; part: number; relocated: boolean } | { status: "sign-in" | "vip-required" | "changed" }> {
  const selected = await readSiteBookPart(origin, cookie, id, revision, item, selection, request);
  if (selected.status !== "ready") return selected;

  // Transport fragments share one reading page. Keep concurrent requests
  // bounded and only render if every fragment matches the authorized edition.
  const fragments: string[] = [];
  const batchSize = 4;
  for (let start = 0; start < item.parts; start += batchSize) {
    const batch = await Promise.all(Array.from({ length: Math.min(batchSize, item.parts - start) }, (_, index) => {
      const part = start + index;
      return part === selected.part ? selected : readSiteBookPart(origin, cookie, id, revision, item, part, request);
    }));
    for (const fragment of batch) {
      if (fragment.status !== "ready") return fragment;
      fragments.push(fragment.html);
    }
  }
  return { status: "ready", fragments, part: selected.part, relocated: selected.relocated };
}
