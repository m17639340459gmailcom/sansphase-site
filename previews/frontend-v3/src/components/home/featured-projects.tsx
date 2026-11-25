import { getLocale, getTranslations } from "next-intl/server";
import { ProjectShowcase } from "@/components/home/project-showcase";
import { ButtonLink } from "@/components/ui/button";
import { Magnetic } from "@/components/ui/magnetic";
import { SectionHeading } from "@/components/ui/section-heading";
import { articles, localize, sansphaseLinks, topicNames } from "@/data/sansphase";
import type { HomeJournal } from "@/lib/home-journal";

export async function FeaturedProjects({ posts }: { posts?: HomeJournal }) {
  const [t, locale] = await Promise.all([
    getTranslations("Home.featured"),
    getLocale(),
  ]);
  const connected = posts !== undefined;
  const en = locale === "en";
  const projects = connected ? (posts ?? []).slice(0, 4).map((post) => ({
    slug: post.slug,
    href: `${sansphaseLinks.blog}/${post.slug}`,
    title: post.title,
    tagline: post.description,
    category: post.category || (en ? "Public article" : "公开文章"),
    stack: post.tags,
    cover: { src: post.cover, alt: "", ...post.coverSize },
  })) : articles.map((article) => ({
    slug: article.slug,
    href: article.href,
    title: localize(article.title, locale),
    tagline: localize(article.summary, locale),
    category: localize(topicNames[article.topic], locale),
    stack: article.tags.map((tag) => localize(tag, locale)),
    cover: { src: article.cover, alt: "", ...article.coverSize },
  }));

  return (
    <section id="featured-projects" className="relative section-space overflow-hidden border-y border-line bg-bg-elevated/40">
      <div className="container-x">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            eyebrow={t("eyebrow")}
            title={t("title")}
            accent={t("titleAccent")}
            body={connected ? (en ? "Recent articles on learning and making." : "从近期发布的文章了解学习与创作实践。") : t("body")}
          />
          <Magnetic className="shrink-0">
            <ButtonLink href={sansphaseLinks.work} variant="secondary" arrow className="w-full">
              {t("cta")}
            </ButtonLink>
          </Magnetic>
        </div>

        {projects.length ? <ProjectShowcase projects={projects} prefetch={connected ? false : undefined} /> : (
          <p role="status" className="mt-8 rounded-2xl border border-line p-6 text-sm text-muted sm:mt-10">
            {posts === null ? (en ? "Articles are temporarily unavailable." : "暂时无法加载公开文章。") : (en ? "No articles published yet." : "暂无已发布文章。")}
          </p>
        )}
      </div>
    </section>
  );
}
