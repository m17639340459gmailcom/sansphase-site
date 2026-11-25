"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PostCardEntry } from "@/components/blog/post-card";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SplitText } from "@/components/fx/split-text";
import { SpotlightCard } from "@/components/fx/spotlight";
import { TextRoll } from "@/components/fx/text-roll";
import { FxTrigger } from "@/components/fx/trigger";
import { Tag } from "@/components/ui/tag";
import { Link } from "@/i18n/navigation";
import { cn, formatDate } from "@/lib/utils";
import { FloatingCover } from "./floating-cover";

/** The newest post as an editorial spread: floating cover on a dot-grid stage, headline rising in. */
export function FeaturedPost({
  post,
  locale,
  detail,
  href,
  prefetch,
  latestLabel,
  readLabel,
}: {
  post: PostCardEntry;
  locale: string;
  detail?: string;
  href?: string;
  prefetch?: boolean;
  latestLabel: string;
  readLabel: string;
}) {
  const cursor = useTranslations("FX.common.cursor");
  const { width, height } = post.coverSize ?? { width: 1536, height: 1024 };

  return (
    <Link
      href={href ?? `/blog/${post.slug}`}
      prefetch={prefetch}
      aria-label={[latestLabel, post.title, post.badge].filter(Boolean).join(" · ")}
      data-cursor-text={cursor("read")}
      className="fx-roll-host group/feat block rounded-3xl"
    >
      <SpotlightCard
        className={cn(
          "grid overflow-hidden rounded-3xl border border-line bg-bg-elevated transition-[border-color,box-shadow] duration-500 group-hover/feat:border-accent/40 group-hover/feat:shadow-soft",
          post.cover && "lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]",
        )}
      >
        {post.cover && (
          <div className="relative isolate grid items-center overflow-hidden border-b border-line p-4 sm:p-6 lg:border-b-0 lg:border-r lg:p-7">
            <div aria-hidden="true" className="dot-grid absolute inset-0 -z-10 opacity-50 mask-fade-y" />
            <FloatingCover slug={post.slug} src={post.cover} alt={post.coverAlt ?? ""} width={width} height={height}
              sizes="(max-width: 1023px) 90vw, 680px" className="[&_img]:max-h-[28rem] [&_img]:object-contain" />
          </div>
        )}
        <FxTrigger className="flex min-w-0 flex-col justify-center gap-3 p-4 sm:p-6 lg:p-7">
          <p className="eyebrow flex flex-wrap items-center gap-2 text-accent">
            <span aria-hidden="true" className="relative flex size-2 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative size-2 rounded-full bg-accent" />
            </span>
            <ScrambleText text={latestLabel} />
            {post.badge && <Tag tone="accent">{post.badge}</Tag>}
          </p>
          <h3 className="line-clamp-2 wrap-anywhere font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            <SplitText text={post.title} delay={0.1} stagger={0.035} />
          </h3>
          {post.description && <p className="line-clamp-2 wrap-anywhere text-sm leading-6 text-muted">{post.description}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] text-muted">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <time dateTime={post.date}>{formatDate(post.date, locale)}</time>
              {detail && (
                <>
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-accent" />
                  {detail}
                </>
              )}
            </span>
            <span className="ml-auto inline-flex h-11 items-center gap-3 rounded-full bg-fg pl-5 pr-1.5 font-sans text-sm font-medium text-bg transition-colors duration-300 group-hover/feat:bg-accent group-hover/feat:text-(--fx-on-accent)">
              <TextRoll>{readLabel}</TextRoll>
              <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-bg/15">
                <ArrowUpRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/feat:rotate-45"
                />
              </span>
            </span>
          </div>
        </FxTrigger>
      </SpotlightCard>
    </Link>
  );
}
