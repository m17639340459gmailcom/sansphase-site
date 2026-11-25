import { z } from "zod";
import type { PostMeta } from "./blog";
import { notePublishedAt } from "./site-publication-date";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const articleSummary = z.object({
  id: z.string().max(120).regex(slugPattern),
  title: z.string().trim().min(1),
  en: z.string().optional(),
  summary: z.string().optional(),
  summaryEn: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  date: z.string(),
  coverSrc: z.string().optional(),
  coverWidth: z.int().positive().optional(),
  coverHeight: z.int().positive().optional(),
  locked: z.boolean().optional(),
});
const articleDetail = articleSummary.extend({
  bodyHTML: z.string(),
  attachments: z.array(z.object({ name: z.string().trim().min(1), url: z.string() })).default([]),
});

export type SiteArticleMeta = PostMeta & {
  cover: string;
  coverSize: { width: number; height: number };
  category?: string;
  englishTitle?: string;
};

export type SiteArticle = SiteArticleMeta & {
  bodyHTML: string;
  attachments: { name: string; url: string }[];
};

export function siteContentMedia(source: string, use: "cover" | "download"): string | null {
  if (!/^\/api\/media\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}(?:\?|$)/i.test(source)) return null;
  const url = new URL(source, "https://media.invalid");
  if (url.hash) return null;
  const allowed = use === "cover" ? ["w", "view"] : ["download"];
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key))) return null;
  if (use === "download" && url.searchParams.get("download") !== "1") return null;
  return url.pathname + url.search;
}

export function siteArticleMeta(value: unknown, locale: string): SiteArticleMeta | null {
  const parsed = articleSummary.safeParse(value);
  if (!parsed.success || parsed.data.locked) return null;
  const item = parsed.data;
  const published = notePublishedAt(item.date);
  if (!published) return null;
  const englishTitle = item.en?.trim() || undefined;
  return {
    slug: item.id,
    // The original article body is Chinese even when English metadata is available.
    locale: "zh",
    fallback: locale === "en",
    title: (locale === "en" && englishTitle) || item.title,
    description: (locale === "en" && item.summaryEn?.trim()) || item.summary?.trim() || "",
    date: published.slice(0, 10),
    tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
    category: item.category?.trim() || undefined,
    englishTitle,
    hue: 258,
    cover: siteContentMedia(item.coverSrc ?? "", "cover") ?? "/share/cover.jpg",
    coverAlt: item.title,
    coverSize: item.coverWidth && item.coverHeight ? { width: item.coverWidth, height: item.coverHeight } : { width: 1200, height: 630 },
    readingMinutes: 1,
  };
}

export async function readSiteArticle(origin: string, locale: string, slug: string, request = fetch): Promise<SiteArticle | null> {
  if (slug.length > 120 || !slugPattern.test(slug)) return null;
  const url = new URL("/api/content", origin);
  url.search = new URLSearchParams({ view: "detail", kind: "notes", public: "1", id: slug }).toString();
  const response = await request(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw new Error("Article service unavailable");
  const payload = z.object({ item: articleDetail }).safeParse(await response.json());
  if (!payload.success || payload.data.item.id !== slug) return null;
  const item = payload.data.item;
  const meta = siteArticleMeta(item, locale);
  if (!meta) return null;
  return {
    ...meta,
    // The existing content service emits sanitized HTML. Do not run it as MDX.
    bodyHTML: item.bodyHTML,
    attachments: item.attachments.flatMap(({ name, url }) => {
      const media = siteContentMedia(url, "download");
      return media ? [{ name, url: media }] : [];
    }),
  };
}
