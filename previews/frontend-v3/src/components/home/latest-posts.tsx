import { getLocale, getTranslations } from "next-intl/server";
import { PostCard } from "@/components/blog/post-card";
import { ButtonLink } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
import { sansphaseLinks } from "@/data/sansphase";
import type { HomeJournal } from "@/lib/home-journal";
import { getSansphasePosts } from "@/lib/sansphase-blog";

export async function LatestPosts({ posts }: { posts?: HomeJournal }) {
  const t = await getTranslations("Home.writing");
  const locale = await getLocale();
  const articles = posts === undefined ? await getSansphasePosts(locale).catch(() => []) : posts ?? [];

  return (
    <section className="container-x section-space border-t border-line">
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <SectionHeading eyebrow={t("eyebrow")} title={t("title")} accent={t("titleAccent")} />
        <ButtonLink href={sansphaseLinks.blogIndex} variant="secondary" arrow className="shrink-0">
          {t("cta")}
        </ButtonLink>
      </div>
      <Stagger className="mt-10 grid gap-5 md:grid-cols-3" stagger={0.12}>
        {articles.slice(0, 3).map((post) => (
          <StaggerItem key={post.slug} variant="clip" className="h-full">
            <PostCard
              post={post}
              locale={locale}
              prefetch={posts !== undefined ? false : undefined}
              coverSize={post.coverSize}
            />
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
