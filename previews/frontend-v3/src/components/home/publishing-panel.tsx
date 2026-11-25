import { CalendarDays } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { BorderBeam } from "@/components/fx/border-beam";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { TextRoll } from "@/components/fx/text-roll";
import { ArrowSwap } from "@/components/home/data/arrow-swap";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { articles, localize, sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import type { HomeJournal } from "@/lib/home-journal";
import { formatDate } from "@/lib/utils";

export async function PublishingPanel({ posts }: { posts?: HomeJournal }) {
  const [locale, cursor] = await Promise.all([getLocale(), getTranslations("FX.common.cursor")]);
  const en = locale === "en";
  const connected = posts !== undefined;
  const recentArticles = connected
    ? (posts ?? []).slice(0, 4).map(({ slug, date, title }) => ({ slug, date, title, href: `${sansphaseLinks.blog}/${slug}` }))
    : [...articles].sort((first, second) => second.date.localeCompare(first.date)).slice(0, 4)
      .map((article) => ({ ...article, title: localize(article.title, locale) }));

  return (
    <section className="container-x section-space">
      <SectionHeading
        eyebrow={en ? "PUBLISHING LOG" : "发布记录"}
        title={en ? "From experiments" : "从实践，"}
        accent={en ? "to field notes." : "到复盘。"}
        body={connected
          ? (en ? "Browse recent writing in order of publication." : "按发表日期回看近期公开文章。")
          : (en ? "Follow the development of the knowledge base and the short-video workflow through the dated articles." : "按发表日期回看个人知识库和短视频工作流，从最初尝试到后来整理。")}
      />

      <Stagger className="mt-10" stagger={0.09}>
        <SpotlightGroup className="grid min-w-0 gap-5 lg:grid-cols-12">
          <StaggerItem variant="clip" className="lg:col-span-4">
            <Link
              href={sansphaseLinks.blogIndex}
              data-fx-spot=""
              data-cursor-text={cursor("visit")}
              className="fx-spotlight fx-roll-host group relative flex h-full flex-col justify-between gap-8 overflow-hidden rounded-2xl border border-line bg-fg p-7 text-bg [--fx-spot-size:13rem]"
            >
              <span aria-hidden className="fx-spot-lit fx-grid-lit pointer-events-none absolute inset-0" />
              <div className="relative flex items-center gap-4">
                <span className="relative grid size-13 shrink-0 place-items-center rounded-2xl border border-bg/15 transition-transform duration-500 motion-safe:group-hover:-rotate-6">
                  <CalendarDays aria-hidden className="size-6" />
                  <BorderBeam duration={5} size={120} />
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-xl font-semibold">{en ? "The journal" : "無相博客"}</span>
                  <span className="mt-1 block font-mono text-xs text-bg/65">
                    {connected ? (en ? "Public archive" : "公开文章目录") : (en ? "Demo archive" : "演示内容")}
                  </span>
                </span>
              </div>
              <span className="relative flex items-center gap-2 font-mono text-sm [--fx-roll-to:currentColor]">
                <TextRoll>{en ? "Read the journal" : "阅读博客"}</TextRoll>
                <ArrowSwap className="size-3.5" />
              </span>
            </Link>
          </StaggerItem>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:col-span-8">
            {recentArticles.map((article) => (
              <StaggerItem key={article.slug} variant="scale" className="min-w-0">
                <Link
                  href={article.href}
                  prefetch={connected ? false : undefined}
                  data-fx-spot=""
                  data-cursor-text={cursor("open")}
                  className="fx-spotlight group relative flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-line bg-bg-elevated/60 p-6 transition-colors duration-300 hover:border-accent/30 focus-visible:border-accent/30"
                >
                  <span
                    aria-hidden
                    className="absolute inset-x-6 top-0 h-px origin-left scale-x-0 bg-linear-to-r from-accent to-amber transition-[scale] duration-700 ease-(--fx-ease) group-hover:scale-x-100 group-focus-visible:scale-x-100"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <time dateTime={article.date} className="font-mono text-xs tabular-nums text-muted">
                      {formatDate(article.date, locale)}
                    </time>
                    <ArrowSwap className="size-3.5 shrink-0 text-accent" />
                  </div>
                  <h3 className="text-sm leading-relaxed font-medium text-fg">{article.title}</h3>
                </Link>
              </StaggerItem>
            ))}
            {!recentArticles.length && (
              <p role="status" className="grid place-items-center rounded-2xl border border-dashed border-line p-6 text-sm text-muted sm:col-span-2">
                {posts === null ? (en ? "Articles are temporarily unavailable." : "暂时无法加载公开文章。") : (en ? "No articles published yet." : "暂无已发布文章。")}
              </p>
            )}
          </div>
        </SpotlightGroup>
      </Stagger>
    </section>
  );
}
