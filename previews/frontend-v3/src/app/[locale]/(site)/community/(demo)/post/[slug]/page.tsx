import { ArrowLeft, ArrowUpRight, Eye, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { communityCopy, formatCommunityDate, toCommunityLocale } from "@/components/community/copy";
import { DemoLike, DemoReplyForm } from "@/components/community/thread-actions";
import { Tag } from "@/components/ui/tag";
import { communityBoardHref, communityTopicHref, demoTopics, getDemoBoard, getDemoTopic } from "@/data/sansphase-community";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";

type Props = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => demoTopics.map(({ id }) => ({ locale, slug: id })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: language, slug } = await params;
  const locale = toCommunityLocale(language);
  const topic = getDemoTopic(slug);
  if (!topic) return {};
  return sansphasePageMetadata(locale, communityTopicHref(topic.id), topic.title[locale], topic.excerpt[locale]);
}

export default async function CommunityThreadPage({ params }: Props) {
  const { locale: language, slug } = await params;
  const locale = toCommunityLocale(language);
  const copy = communityCopy[locale];
  const topic = getDemoTopic(slug);
  if (!topic) notFound();
  const board = getDemoBoard(topic.board);

  return (
    <div className="container-x pb-16 pt-29 sm:pb-24 sm:pt-36">
      <div className="mx-auto max-w-4xl">
        <nav aria-label={copy.boards} className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Link href="/community" className="inline-flex min-h-10 items-center gap-2 hover:text-accent"><ArrowLeft aria-hidden className="size-4" />{copy.home}</Link>
          <span aria-hidden>/</span>
          <Link href={communityBoardHref(topic.board)} className="inline-flex min-h-10 items-center hover:text-accent">{board?.name[locale]}</Link>
        </nav>
        <article className="min-w-0 rounded-2xl border border-line bg-bg-elevated">
          <header className="border-b border-line px-4 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="accent">{copy.preview}</Tag>
              {topic.featured && <Tag>{copy.featured}</Tag>}
              {topic.replies.some((reply) => reply.accepted) && <Tag>{copy.solved}</Tag>}
            </div>
            <h1 className="mt-4 text-pretty font-display text-3xl font-semibold leading-[1.2] tracking-tight sm:text-[2.5rem]">{topic.title[locale]}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
              <span className="font-medium text-fg">{topic.author[locale]}</span>
              <time dateTime={topic.published}>{formatCommunityDate(topic.published, locale)}</time>
              <span className="inline-flex items-center gap-1.5"><Eye aria-hidden className="size-3.5" />{copy.views(topic.views)}</span>
              <a href="#community-replies" className="inline-flex items-center gap-1.5 rounded hover:text-accent"><MessageSquare aria-hidden className="size-3.5" />{copy.replies(topic.replies.length)}</a>
            </div>
          </header>
          <div className="space-y-4 px-4 py-6 sm:px-8 sm:py-8">
            {topic.body[locale].map((paragraph) => <p key={paragraph} className="text-pretty text-[15px] leading-8 text-fg/90 sm:text-base">{paragraph}</p>)}
            {topic.cover && <Image src={topic.cover.src} alt={topic.cover.alt[locale]} width={960} height={540} sizes="(max-width: 640px) 90vw, 820px" unoptimized className="h-auto w-full rounded-xl border border-line" />}
            {topic.related && (
              <Link href={topic.related.href} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-accent hover:border-accent/50">
                <span>{topic.related.title[locale]}</span><ArrowUpRight aria-hidden className="size-4 shrink-0" />
              </Link>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2">{topic.tags.map((tag) => <Tag key={tag.en}>{tag[locale]}</Tag>)}</div>
            <DemoLike locale={locale} count={topic.likes} />
          </div>
        </article>
        <section id="community-replies" className="mt-9 scroll-mt-24" aria-labelledby="community-replies-label">
          <h2 id="community-replies-label" className="mb-4 font-display text-2xl font-semibold">{copy.replies(topic.replies.length)}</h2>
          <ol className="space-y-3">
            {topic.replies.map(({ author, date, text, accepted }) => (
              <li key={author.en + date} className="rounded-xl border border-line bg-bg-elevated p-4 sm:p-5">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
                  <strong className="text-sm text-fg">{author[locale]}</strong>
                  <time dateTime={date}>{formatCommunityDate(date, locale)}</time>
                  {accepted && <Tag tone="accent">{copy.featuredReply}</Tag>}
                </div>
                <p className="text-pretty text-sm leading-7 text-muted">{text[locale]}</p>
              </li>
            ))}
          </ol>
          <DemoReplyForm locale={locale} />
        </section>
      </div>
    </div>
  );
}
