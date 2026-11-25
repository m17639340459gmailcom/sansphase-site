import { z } from "zod";
import type { CatalogKind, CatalogQuery } from "./catalog-navigation";
import { siteContentMedia } from "./site-articles";
import { notePublishedAt } from "./site-publication-date";
import { readSiteContent } from "./site-reader-request";

const slug = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const storedItem = z.object({
  id: slug,
  title: z.string().trim().min(1),
  summary: z.string().optional(),
  category: z.string().optional(),
  date: z.string().optional(),
  tags: z.array(z.string()).default([]),
  coverSrc: z.string().optional(),
  coverWidth: z.int().positive().optional(),
  coverHeight: z.int().positive().optional(),
  showcaseSrc: z.string().optional(),
  showcaseWidth: z.int().positive().optional(),
  showcaseHeight: z.int().positive().optional(),
  locked: z.boolean().optional(),
});
const catalogList = z.object({
  items: z.array(storedItem),
  total: z.int().nonnegative(),
  categories: z.array(z.string()),
  page: z.int().positive(),
  pages: z.int().positive(),
});
const catalogDetail = z.object({ item: storedItem.extend({
  bodyHTML: z.string().optional(),
  attachments: z.array(z.object({ name: z.string().trim().min(1), url: z.string() })).default([]),
}) });

type Failure = { status: "signin" | "forbidden" | "missing" | "unavailable" };
type Result<T> = { status: "ok"; value: T } | Failure;

function catalogCover(source: string | undefined, width: number | undefined, height: number | undefined) {
  const src = source && siteContentMedia(source, "cover");
  if (!src) return null;
  return { src, width: width ?? 960, height: height ?? 540 };
}

function toCard(item: z.infer<typeof storedItem>) {
  const date = item.date && notePublishedAt(item.date);
  return {
    id: item.id,
    title: item.title,
    summary: item.summary?.trim() ?? "",
    category: item.category?.trim() ?? "",
    date: date ? date.slice(0, 10) : null,
    tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
    cover: catalogCover(item.coverSrc, item.coverWidth, item.coverHeight),
    showcase: catalogCover(item.showcaseSrc, item.showcaseWidth, item.showcaseHeight),
  };
}

export type CatalogItem = ReturnType<typeof toCard>;
export type CatalogList = { items: CatalogItem[]; total: number; categories: string[]; page: number; pages: number };
export type CatalogDetail = CatalogItem & { bodyHTML: string; attachments: { name: string; url: string }[] };

async function catalogResponse(url: string, params: URLSearchParams, cookie: string | null, request: typeof fetch): Promise<Result<unknown>> {
  try {
    const response = await readSiteContent(url, params, cookie, request);
    if (response.status === 401) return { status: "signin" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "ok", value: await response.json() };
  } catch {
    return { status: "unavailable" };
  }
}

export async function readSiteCatalog(origin: string, kind: CatalogKind, query: CatalogQuery, cookie: string | null, request: typeof fetch = fetch): Promise<Result<CatalogList>> {
  const result = await catalogResponse(origin, new URLSearchParams({
    view: "list", kind, page: String(query.page), category: query.category, q: query.q,
  }), cookie, request);
  if (result.status !== "ok") return result;
  const data = catalogList.safeParse(result.value);
  if (!data.success || data.data.page > data.data.pages) return { status: "unavailable" };
  return { status: "ok", value: {
    ...data.data,
    items: data.data.items.filter((item) => !item.locked).map(toCard),
    categories: [...new Set(data.data.categories.map((category) => category.trim()).filter((category) => category && category !== "all"))],
  } };
}

export async function readSiteCatalogEntry(origin: string, kind: CatalogKind, id: string, cookie: string | null, request: typeof fetch = fetch): Promise<Result<CatalogDetail>> {
  if (!slug.safeParse(id).success) return { status: "missing" };
  const result = await catalogResponse(origin, new URLSearchParams({ view: "detail", kind, id }), cookie, request);
  if (result.status !== "ok") return result;
  const data = catalogDetail.safeParse(result.value);
  if (!data.success || data.data.item.id !== id) return { status: "unavailable" };
  const item = data.data.item;
  if (item.locked) return { status: "forbidden" };
  return { status: "ok", value: {
    ...toCard(item),
    // Only the existing server sanitizes and authorizes this content.
    bodyHTML: item.bodyHTML ?? "",
    attachments: item.attachments.flatMap(({ name, url }) => {
      const media = siteContentMedia(url, "download");
      return media ? [{ name, url: media }] : [];
    }),
  } };
}
