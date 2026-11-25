import { getLocale, getTranslations } from "next-intl/server";
import { v3NavItems } from "@/data/nav";
import { sansphaseLinks } from "@/data/sansphase";
import { routing } from "@/i18n/routing";
import { getSansphasePosts } from "@/lib/sansphase-blog";
import { formatDate } from "@/lib/utils";
import { CommandRoot } from "./command-root";
import type { CommandData } from "./types";

/**
 * Builds the palette's small localized index on the server (page names in both languages, so
 * either can be typed; featured article titles with a few tags) and hands it to the client layer.
 */
export async function CommandPalette() {
  const locale = await getLocale();
  const other = routing.locales.find((code) => code !== locale) ?? routing.defaultLocale;
  const [tNav, tAlias, articles] = await Promise.all([
    getTranslations("Nav"),
    getTranslations({ locale: other, namespace: "Nav" }),
    getSansphasePosts(locale).catch(() => []),
  ]);

  const data: CommandData = {
    pages: [
      ...v3NavItems.map(({ key, href }) => ({ key, href, label: tNav(key), alias: tAlias(key) })),
      { key: "blog", href: sansphaseLinks.blogIndex, label: tNav("blog"), alias: tAlias("blog") },
    ],
    posts: articles.map((post) => ({
      slug: post.slug,
      href: `/blog/${post.slug}`,
      title: post.title,
      tags: post.tags.slice(0, 3),
      date: formatDate(post.date, locale),
    })),
  };

  return <CommandRoot data={data} />;
}
