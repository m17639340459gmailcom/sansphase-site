import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { BlogExplorer } from "@/components/blog/blog-explorer";
import { ResourceAccessMessage } from "@/components/resources/resource-access-message";
import { PageHeader } from "@/components/ui/page-header";
import { localize, sansphaseLinks } from "@/data/sansphase";
import { bookCategories, demoBooks } from "@/data/sansphase-library";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";
import { readSiteBooks } from "@/lib/site-books";
import "../blog/[slug]/post-fx.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Library" });
  const integrated = Boolean(siteBackendOrigin());
  return { ...sansphasePageMetadata(locale, sansphaseLinks.resources, t("navTitle"), t(integrated ? "publishedIntro" : "intro")),
    ...(integrated ? { robots: { index: false, follow: false } } : {}) };
}

export default async function ResourcesPage() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("Library")]);
  const origin = siteBackendOrigin();
  const catalogue = origin && await readSiteBooks(origin, (await headers()).get("cookie"));
  const alternateLocale = locale === "en" ? "zh" : "en";
  const books = catalogue ? (catalogue.status === "ready" ? catalogue.books : []).map((book) => {
    // No protected download, body or section manifest is sent to the browser shelf.
    const { slug, href, title, description, date, tags, cover, coverSize, vipOnly, locked } = book;
    return { slug, href, title, description, date, tags, cover, coverSize, badge: vipOnly ? t(locked ? "vipLocked" : "vip") : undefined };
  }) : demoBooks.map((book) => {
    const tags = [bookCategories[book.category], ...book.tags];
    return {
      slug: book.slug,
      href: book.href,
      title: localize(book.title, locale),
      description: localize(book.summary, locale),
      date: book.date,
      tags: tags.map((tag) => localize(tag, locale)),
      searchTerms: [book.title, book.summary, ...tags].map((text) => localize(text, alternateLocale)),
      cover: book.cover.src,
      coverSize: { width: book.cover.width, height: book.cover.height },
      detail: t("chaptersCount", { count: book.chapters.length }),
      badge: book.vipOnly ? t("vipDemo") : undefined,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow={t("navTitle")}
        title={t("title")}
        accent={t("accent")}
        body={t(origin ? "publishedIntro" : "intro")}
        index={catalogue && catalogue.status === "sign-in" ? undefined : t("booksCount", { count: books.length })}
      />
      <section id="resource-shelf" className="container-x scroll-mt-28 pb-16 pt-2 sm:pb-24">
        {catalogue && catalogue.status === "sign-in"
          ? <ResourceAccessMessage state="sign-in" locale={locale} returnTo={sansphaseLinks.resources} />
          : <BlogExplorer posts={books} locale={locale} kind="resources" />}
      </section>
    </>
  );
}
