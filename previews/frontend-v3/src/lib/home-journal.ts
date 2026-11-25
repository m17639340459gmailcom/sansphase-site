import type { SiteArticleMeta } from "@/lib/site-articles";

export type HomeJournal = readonly SiteArticleMeta[] | null | undefined;

type TopicCount = { id: string; name: string; count: number; category?: string };
export function summarizeHomeTopics(posts: readonly Pick<SiteArticleMeta, "category">[], labels: { other: string; noCategory: string }) {
  const counts = new Map<string, number>();
  for (const { category = "" } of posts) counts.set(category, (counts.get(category) ?? 0) + 1);
  const ranked: TopicCount[] = [...counts].sort((a, b) => b[1] - a[1]).map(([category, count]) =>
    category ? { id: `category:${category}`, name: category, category, count } : { id: "no-category", name: labels.noCategory, count });
  const entries = ranked.length <= 5 ? ranked : [
    ...ranked.slice(0, 4),
    { id: "other", name: labels.other, count: ranked.slice(4).reduce((sum, entry) => sum + entry.count, 0) },
  ];
  return { total: posts.length, topicCount: counts.size - Number(counts.has("")), entries };
}
