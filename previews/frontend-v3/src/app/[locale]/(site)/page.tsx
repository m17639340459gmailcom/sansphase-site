import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { Preloader } from "@/components/fx/preloader";
import { Facts } from "@/components/home/facts";
import { FeaturedProjects } from "@/components/home/featured-projects";
import { Hero } from "@/components/home/hero";
import { HomeIntroReady } from "@/components/home/home-intro-ready";
import { LatestPosts } from "@/components/home/latest-posts";
import { LearningSpotlight } from "@/components/home/learning-spotlight";
import { PublishingPanel } from "@/components/home/publishing-panel";
import { ReadingTopics } from "@/components/home/reading-topics";
import { SitePublishingPanel } from "@/components/home/site-publishing-panel";
import { TechMarquee } from "@/components/home/tech-marquee";
import { WhatIDo } from "@/components/home/what-i-do";
import { articles } from "@/data/sansphase";
import { localizedPath, siteOrigin } from "@/i18n/paths";
import { summarizeHomeTopics } from "@/lib/home-journal";
import { getSiteArticleIndex } from "@/lib/sansphase-blog";
import { isPublishedSiteOrigin, siteBackendOrigin } from "@/lib/site-backend";
import { loadSitePublishingData } from "@/lib/site-publishing-data";
import { publicationToday } from "@/lib/site-publishing-model";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "zh" && locale !== "en") return {};
  const t = await getTranslations({ locale, namespace: "Home" });
  const title = t("brandTitle");
  const description = t("intro");
  const integrated = Boolean(siteBackendOrigin());
  const allowIndex = integrated && isPublishedSiteOrigin(siteOrigin);
  const image = integrated
    ? { url: "/share/cover.jpg", width: 1200, height: 630, alt: title }
    : { url: articles[0].cover, ...articles[0].coverSize };
  return {
    title: { absolute: title },
    description,
    applicationName: "SANSPHASE",
    authors: [{ name: "無相 SANSPHASE" }],
    creator: "無相 SANSPHASE",
    keywords: ["SANSPHASE", "無相", "学习资料", "软件推荐", "创作社区"],
    openGraph: { title, description, type: "website", siteName: "SANSPHASE", locale: locale === "zh" ? "zh_CN" : "en_US", images: [image] },
    twitter: { title, description, card: "summary_large_image", images: [image] },
    robots: { index: allowIndex, follow: allowIndex },
  };
}

export default async function HomePage() {
  await connection();
  const locale = await getLocale();
  return (
    <>
      <Preloader homePath={localizedPath(locale, "/")} />
      <Hero />
      <Suspense fallback={null}>
        <HomePublishing locale={locale} />
      </Suspense>
    </>
  );
}

async function HomePublishing({ locale }: { locale: string }) {
  const origin = siteBackendOrigin();
  const now = new Date();
  const today = publicationToday(now);
  const [posts, publishing] = origin
    ? await Promise.all([
        getSiteArticleIndex(origin, locale).catch(() => null),
        loadSitePublishingData({ siteOrigin: origin, linkOrigin: siteOrigin, includeFeatured: true, now }),
      ])
    : [undefined, undefined];
  const publicPosts = posts?.filter(({ date }) => date <= today) ?? posts;
  const topics = publicPosts ? summarizeHomeTopics(publicPosts, locale === "en"
    ? { other: "Other topics", noCategory: "Uncategorized" }
    : { other: "其他主题", noCategory: "未分类" }) : publicPosts;
  return (
    <>
      <TechMarquee />
      <WhatIDo featured={publishing?.featured} />
      <FeaturedProjects posts={publicPosts} />
      <Facts selectedCount={publicPosts === null ? null : publicPosts?.slice(0, 4).length} topicCount={topics === null ? null : topics?.topicCount} />
      <PublishingPanel posts={publicPosts} />
      <SitePublishingPanel data={publishing} today={today} />
      <ReadingTopics topics={topics} />
      <LatestPosts posts={publicPosts} />
      <LearningSpotlight connected={Boolean(origin)} />
      <HomeIntroReady />
    </>
  );
}
