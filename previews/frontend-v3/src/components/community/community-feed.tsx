"use client";

import { ArrowUpRight, Eye, MessageSquare, Search, ThumbsUp, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { communityTopicHref, demoTopicSorts, getDemoBoard, selectDemoTopics, type DemoTopicSort, type DemoTopicSummary } from "@/data/sansphase-community";
import { Link } from "@/i18n/navigation";
import { communityCopy, formatCommunityDate, type CommunityLocale } from "./copy";

export function CommunityFeed({ locale, topics }: { locale: CommunityLocale; topics: readonly DemoTopicSummary[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DemoTopicSort>("all");
  const copy = communityCopy[locale];
  const results = selectDemoTopics(topics, { locale, query, sort });

  return (
    <section id="community-discussions" aria-labelledby="community-feed-title" className="min-w-0 scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="community-feed-title" className="font-display text-2xl font-semibold tracking-tight">{copy.discussion}</h2>
        <span role="status" className="font-mono text-xs tabular-nums text-muted">{copy.resultCount(results.length)}</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label={copy.sort} className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-xl border border-line bg-bg-elevated p-1">
          {demoTopicSorts.map((id) => (
            <button key={id} type="button" aria-pressed={sort === id} onClick={() => setSort(id)} className="min-h-10 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-muted hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-accent sm:px-3">
              {copy.sorts[id]}
            </button>
          ))}
        </div>
        <div className="relative flex min-w-44 grow items-center rounded-xl border border-line bg-bg-elevated focus-within:border-accent">
          <Search aria-hidden className="pointer-events-none absolute left-3 size-4 text-muted" />
          <input
            type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
            aria-label={copy.search} placeholder={copy.search}
            className="min-h-11 w-full min-w-0 bg-transparent pl-9 pr-10 text-sm outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button type="button" aria-label={copy.clearSearch} onClick={() => setQuery("")} className="absolute right-0 flex size-11 cursor-pointer items-center justify-center rounded-xl text-muted hover:text-fg">
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </div>
      {results.length ? (
        <ul className="overflow-hidden rounded-2xl border border-line bg-bg-elevated divide-y divide-line">
          {results.map((topic) => {
            const board = getDemoBoard(topic.board);
            return (
              <li key={topic.id}>
                <Link
                  href={communityTopicHref(topic.id)}
                  prefetch={false}
                  className="group flex min-w-0 items-start gap-3 p-4 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:gap-4 sm:p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted">
                      <span className="font-medium text-accent">{board?.name[locale]}</span>
                      {topic.featured && <span>{copy.featured}</span>}
                      {topic.replies.some((reply) => reply.accepted) && <span>{copy.solved}</span>}
                    </p>
                    <h3 className="text-pretty font-display text-base font-semibold text-fg group-hover:text-accent sm:text-lg">{topic.title[locale]}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{topic.excerpt[locale]}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
                      <span className="font-medium text-fg">{topic.author[locale]}</span>
                      <time dateTime={topic.published}>{formatCommunityDate(topic.published, locale)}</time>
                      <span className="inline-flex items-center gap-1" aria-label={copy.likes(topic.likes)}><ThumbsUp aria-hidden className="size-3.5" />{topic.likes}</span>
                      <span className="inline-flex items-center gap-1" aria-label={copy.replies(topic.replies.length)}><MessageSquare aria-hidden className="size-3.5" />{topic.replies.length}</span>
                      <span className="inline-flex items-center gap-1" aria-label={copy.views(topic.views)}><Eye aria-hidden className="size-3.5" />{topic.views}</span>
                    </div>
                  </div>
                  {topic.cover
                    ? <Image src={topic.cover.src} alt="" width={960} height={540} unoptimized className="mt-1 aspect-video w-16 shrink-0 rounded-md border border-line sm:w-24" />
                    : <ArrowUpRight aria-hidden className="mt-1 size-4 shrink-0 text-muted group-hover:text-accent" />}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">{copy.noResults}</p>
      )}
    </section>
  );
}
