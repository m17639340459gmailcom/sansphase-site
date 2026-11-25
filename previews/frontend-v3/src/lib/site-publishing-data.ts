import { cache } from "react";
import { z } from "zod";
import type { LocalizedText } from "@/data/sansphase";
import { countPublications, publicationToday, type HomeFeatures, type NoteCard, type ResourcePublicationDay, type SitePublishing } from "@/lib/site-publishing-model";
import { notePublishedAt } from "@/lib/site-publication-date";

const publicationDate = z.iso.date();
const resourceDaySchema = z.object({
  date: publicationDate,
  resourceCenter: z.int().nonnegative(),
  materials: z.int().nonnegative(),
  works: z.int().nonnegative(),
  software: z.int().nonnegative(),
});
const activitySchema = z.object({ resourceActivity: z.object({ days: z.array(resourceDaySchema) }) });
const notesSchema = z.object({ items: z.array(z.unknown()), totalPublished: z.int().nonnegative() });
const pageItemSchema = z.object({ id: z.string().min(1) }).loose();
const notesPageSchema = notesSchema.extend({
  items: z.array(pageItemSchema),
  page: z.int().positive(),
  pages: z.int().positive(),
  total: z.int().nonnegative(),
});

// The deployed canonical blog route accepts an ASCII slug up to 120 characters.
const noteSchema = z.object({
  id: z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  summary: z.string().optional(),
  en: z.string().optional(),
  summaryEn: z.string().optional(),
  date: z.string(),
  tags: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
});
const homeFeatureSchema = noteSchema.pick({ id: true, title: true }).extend({
  summary: z.string(),
  coverSrc: z.string().regex(/^\/api\/media\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\?view=home-cover$/i).optional().catch(undefined),
}).optional().catch(undefined);
const featuredSchema = z.object({ featured: z.object({
  works: homeFeatureSchema,
  resources: homeFeatureSchema,
  "resource-center": homeFeatureSchema,
  software: homeFeatureSchema,
}) });

const NOTES_LIMIT = 4;
const MAX_NOTE_PAGES = 64;
const PAGE_CONCURRENCY = 4;
const READ_TIMEOUT_MS = 5000;

type NoteOptions = {
  siteOrigin: string;
  translations?: readonly { slug: string; title: LocalizedText; summary: LocalizedText }[];
};

type LoadOptions = NoteOptions & {
  activityPreviewOrigin?: string;
  includeFeatured?: boolean;
  linkOrigin?: string;
  now?: Date;
  request?: typeof fetch;
};

export function parseSiteNotes(value: unknown, today: string, { siteOrigin, translations = [] }: NoteOptions) {
  const response = notesSchema.safeParse(value);
  if (!response.success || response.data.items.length > response.data.totalPublished) return null;
  const candidates = new Map<string, { card: NoteCard; publishedAt: string }>();
  for (const item of response.data.items) {
    const parsed = noteSchema.safeParse(item);
    if (!parsed.success) continue;
    const note = parsed.data;
    const publishedAt = notePublishedAt(note.date);
    if (note.locked || !publishedAt || candidates.has(note.id)) continue;
    const date = publishedAt.slice(0, 10);
    if (date > today) continue;
    const translation = translations.find(({ slug }) => slug === note.id);
    const summary = note.summary?.trim() ?? "";
    candidates.set(note.id, {
      publishedAt,
      card: {
        id: note.id,
        title: { zh: note.title, en: note.en?.trim() || translation?.title.en || note.title },
        summary: { zh: summary, en: note.summaryEn?.trim() || translation?.summary.en || summary },
        tags: [...new Set((note.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
        date,
        href: new URL(`/blog/${note.id}`, siteOrigin).href,
      },
    });
  }
  const latest = [...candidates.values()].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  return { cards: latest.slice(0, NOTES_LIMIT).map(({ card }) => card), total: response.data.totalPublished };
}

export function parseResourceActivity(value: unknown, today: string): ResourcePublicationDay[] | null {
  const response = activitySchema.safeParse(value);
  if (!response.success) return null;
  const present = new Set<string>();
  let total = 0;
  for (const day of response.data.resourceActivity.days) {
    total += countPublications(day);
    if (present.has(day.date) || !Number.isSafeInteger(total)) return null;
    present.add(day.date);
  }
  return response.data.resourceActivity.days
    .filter((day) => day.date <= today && countPublications(day) > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function loopbackOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return local && url.protocol === "http:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      ? url.origin : null;
  } catch {
    return null;
  }
}

async function readPublic(request: typeof fetch, url: URL, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await request(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      signal,
      cache: "no-store",
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** The public list follows author ordering. Find chronological cards in a complete catalog. */
export const readPublishedNotes = cache(async (origin: string, request = fetch) => {
  const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
  async function readPage(page: number) {
    const url = new URL(`/api/content?view=list&kind=notes&public=1&page=${page}`, origin);
    const body = notesPageSchema.safeParse(await readPublic(request, url, signal));
    return body.success && body.data.page === page ? body.data : null;
  }
  const first = await readPage(1);
  if (!first || first.pages > MAX_NOTE_PAGES || first.pages > Math.max(1, first.total) || first.total !== first.totalPublished) return null;
  const items = [...first.items];
  for (let page = 2; page <= first.pages; page += PAGE_CONCURRENCY) {
    if (signal.aborted) return null;
    const batchLength = Math.min(PAGE_CONCURRENCY, first.pages - page + 1);
    const batch = await Promise.all(Array.from({ length: batchLength }, (_, index) => readPage(page + index)));
    for (const response of batch) {
      if (!response || response.pages !== first.pages || response.total !== first.total || response.totalPublished !== first.totalPublished) return null;
      items.push(...response.items);
    }
  }
  const noteIds = new Set(items.map(({ id }) => id));
  return items.length === first.total && noteIds.size === items.length ? { items, totalPublished: first.totalPublished } : null;
});

export async function loadSitePublishingData({ siteOrigin, translations, activityPreviewOrigin, includeFeatured = false, linkOrigin, now, request }: LoadOptions): Promise<SitePublishing> {
  const today = publicationToday(now);
  const activityUrl = new URL("/api/content?view=bootstrap&public=1&activity=resources", loopbackOrigin(activityPreviewOrigin) ?? siteOrigin);
  if (includeFeatured) activityUrl.searchParams.set("featured", "1");
  const [notesBody, activityBody] = await Promise.all([
    request ? readPublishedNotes(siteOrigin, request) : readPublishedNotes(siteOrigin),
    readPublic(request ?? fetch, activityUrl, AbortSignal.timeout(READ_TIMEOUT_MS)),
  ]);
  const notes = parseSiteNotes(notesBody, today, { siteOrigin: linkOrigin ?? siteOrigin, translations });
  const featured: HomeFeatures | null = includeFeatured ? featuredSchema.safeParse(activityBody).data?.featured ?? null : null;
  return { notes: notes?.cards ?? [], noteTotal: notes?.total ?? null, activity: parseResourceActivity(activityBody, today), ...(includeFeatured ? { featured } : {}) };
}
