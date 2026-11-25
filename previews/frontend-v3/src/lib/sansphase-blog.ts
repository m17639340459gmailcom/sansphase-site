import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { articles, localize } from "@/data/sansphase";
import type { Post, PostMeta } from "./blog";
import { readSiteArticle, siteArticleMeta, type SiteArticle, type SiteArticleMeta } from "./site-articles";
import { siteBackendOrigin } from "./site-backend";
import { readPublishedNotes } from "./site-publishing-data";
import { readingTime } from "./utils";

type Article = (typeof articles)[number];
type BodyLocale = keyof Article["title"];

export type SansphasePostMeta = PostMeta & {
  cover: string;
  coverSize: Article["coverSize"];
};

export type SansphasePost = SansphasePostMeta & Pick<Post, "content">;
export type SansphaseReadingPost = SansphasePost | SiteArticle;

export const sansphaseBlogSlugs = articles.map(({ slug }) => slug);

const readBody = cache((slug: string, locale: BodyLocale) =>
  readFile(join(process.cwd(), "content", "sansphase-blog", locale, slug + ".mdx"), "utf8"),
);

function toMeta(article: Article, locale: BodyLocale, content: string): SansphasePostMeta {
  return {
    slug: article.slug,
    locale,
    title: localize(article.title, locale),
    description: localize(article.summary, locale),
    date: article.date,
    tags: article.tags.map((tag) => localize(tag, locale)),
    hue: article.topic === "knowledge" ? 220 : 258,
    cover: article.cover,
    coverAlt: localize(article.title, locale),
    coverSize: article.coverSize,
    readingMinutes: readingTime(content, locale),
    fallback: false,
  };
}

export const getSiteArticleIndex = cache(async (origin: string, locale: string): Promise<SiteArticleMeta[]> => {
  const response = await readPublishedNotes(origin);
  if (!response) throw new Error("Article catalog unavailable");
  return response.items.flatMap((item) => {
    const post = siteArticleMeta(item, locale);
    return post ? [post] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
});

export async function getSansphasePosts(locale: string): Promise<SansphasePostMeta[]> {
  const origin = siteBackendOrigin();
  if (origin) return getSiteArticleIndex(origin, locale);
  const bodyLocale = locale === "en" ? "en" : "zh";
  return Promise.all(articles.map(async (article) => toMeta(article, bodyLocale, await readBody(article.slug, bodyLocale))));
}

export const getSansphasePost = cache(async (locale: string, slug: string): Promise<SansphaseReadingPost | null> => {
  const origin = siteBackendOrigin();
  if (origin) return readSiteArticle(origin, locale, slug);
  const article = articles.find((entry) => entry.slug === slug);
  if (!article) return null;
  const bodyLocale = locale === "en" ? "en" : "zh";
  const content = await readBody(article.slug, bodyLocale);
  return { ...toMeta(article, bodyLocale, content), content };
});
