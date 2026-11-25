import { articles, localize, sansphaseLinks, topicNames } from "@/data/sansphase";
import { queryBlogPosts } from "./blog-query";
import { catalogQuery, type CatalogQuery } from "./catalog-navigation";
import type { SiteArticleMeta } from "./site-articles";

export type AboutPublication = {
  slug: string;
  title: string;
  englishTitle?: string;
  description: string;
  category: string;
  date: string;
  tags: readonly string[];
  href: string;
  cover: string;
};

export function demoAboutPublications(locale: string): AboutPublication[] {
  return articles.map((article) => ({
    slug: article.slug,
    title: localize(article.title, locale),
    englishTitle: locale === "zh" ? article.title.en : undefined,
    description: localize(article.summary, locale),
    category: localize(topicNames[article.topic], locale),
    date: article.date,
    tags: article.tags.map((tag) => localize(tag, locale)),
    href: article.href,
    cover: article.cover,
  }));
}

export function siteAboutPublications(articles: readonly SiteArticleMeta[], locale: string): AboutPublication[] {
  return articles.map(({ slug, title, englishTitle, description, category, date, tags, cover }) => ({
    slug,
    title,
    englishTitle: locale === "zh" && englishTitle !== title ? englishTitle : undefined,
    description,
    category: category ?? "",
    date,
    tags,
    href: `${sansphaseLinks.blog}/${slug}`,
    cover,
  }));
}

export type AboutPublicationQuery = CatalogQuery & { tag: string };
export type AboutPublicationSearch = Parameters<typeof catalogQuery>[0];

export function aboutPublicationQuery(search: AboutPublicationSearch): AboutPublicationQuery {
  const tag = typeof search.tag === "string" ? search.tag.trim().slice(0, 200) : "";
  return { ...catalogQuery(search), tag };
}

export function aboutPublicationHref({ category, q, tag, page }: AboutPublicationQuery) {
  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (q) params.set("q", q);
  if (tag) params.set("tag", tag);
  if (page > 1) params.set("page", String(page));
  return `${sansphaseLinks.about}${params.size ? `?${params}` : ""}#blog`;
}

const tagKey = (tag: string) => tag.normalize("NFKC").toLowerCase();

export function queryAboutPublications(articles: readonly AboutPublication[], query: AboutPublicationQuery, locale: string) {
  const tag = tagKey(query.tag);
  const match = articles.filter((article) =>
    (query.category === "all" || article.category === query.category) &&
    (!tag || article.tags.some((value) => tagKey(value) === tag)));
  return queryBlogPosts(match.map((article) => ({
    ...article,
    searchTerms: [article.category, article.englishTitle ?? ""],
  })), { search: query.q, page: query.page, locale });
}

export function relatedAboutPublication(article: AboutPublication, articles: readonly AboutPublication[]) {
  if (article.category) {
    const sameCategory = articles.find((entry) => entry.slug !== article.slug && entry.category === article.category);
    if (sameCategory) return sameCategory;
  }
  if (!article.tags.length) return undefined;
  const tags = new Set(article.tags.map(tagKey));
  return articles.find((entry) => entry.slug !== article.slug && entry.tags.some((tag) => tags.has(tagKey(tag))));
}
