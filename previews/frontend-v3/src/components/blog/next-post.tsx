"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BorderBeam } from "@/components/fx/border-beam";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SplitText } from "@/components/fx/split-text";
import { SpotlightCard } from "@/components/fx/spotlight";
import { TextRoll } from "@/components/fx/text-roll";
import { FxTrigger } from "@/components/fx/trigger";
import { Link } from "@/i18n/navigation";
import type { PostMeta } from "@/lib/blog";
import { cn, formatDate } from "@/lib/utils";
import { FloatingCover } from "./floating-cover";

/** End-of-article hand-off: the next post as a large card whose cover morphs into the next page. */
export function NextPost({ post, locale, minRead }: { post: PostMeta; locale: string; minRead: string }) {
  const fx = useTranslations("FX.blog");
  const t = useTranslations("Blog");
  const cursor = useTranslations("FX.common.cursor");
  const { width, height } = post.coverSize ?? { width: 1536, height: 1024 };
  const [hover, setHover] = useState(false);

  return (
    <Link
      href={`/blog/${post.slug}`}
      aria-label={`${fx("upNext")} · ${post.title}`}
      data-cursor-text={cursor("read")}
      onPointerEnter={(event) => event.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
      className="fx-roll-host group/next block rounded-3xl"
    >
      <SpotlightCard
        className={cn(
          "grid gap-10 rounded-3xl border border-line bg-bg-elevated p-6 transition-[border-color,box-shadow] duration-500 group-hover/next:border-accent/40 group-hover/next:shadow-soft sm:p-10 lg:items-center lg:gap-14 lg:p-14",
          post.cover && "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]",
        )}
      >
        {hover && <BorderBeam duration={5} size={90} />}
        <FxTrigger className="flex min-w-0 flex-col">
          <p className="eyebrow flex items-center gap-3">
            <span aria-hidden="true" className="fx-line inline-block h-px w-8 bg-accent" />
            <ScrambleText text={fx("upNext")} className="text-accent" />
          </p>
          <div className="mt-6 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            {post.tags.slice(0, 3).map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
          <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.2] tracking-[-0.03em] sm:text-4xl lg:text-5xl">
            <SplitText text={post.title} delay={0.15} stagger={0.04} />
          </h2>
          <p className="mt-5 line-clamp-3 max-w-xl text-sm leading-7 text-muted sm:text-[15px]">{post.description}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 font-mono text-[11px] text-muted">
            <time dateTime={post.date}>{formatDate(post.date, locale)}</time>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-accent" />
            <span>{minRead}</span>
            <span className="ml-auto inline-flex h-12 items-center gap-3 rounded-full border border-line-strong pl-5 pr-1.5 font-sans text-sm font-medium text-fg transition-colors duration-300 group-hover/next:border-accent group-hover/next:text-accent">
              <TextRoll>{t("relatedPosts")}</TextRoll>
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-accent text-(--fx-on-accent)">
                <ArrowUpRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/next:rotate-45"
                />
              </span>
            </span>
          </div>
        </FxTrigger>
        {post.cover && (
          <FloatingCover
            slug={post.slug}
            src={post.cover}
            alt={post.coverAlt ?? ""}
            width={width}
            height={height}
            sizes="(max-width: 1023px) 90vw, 520px"
            className="relative"
          />
        )}
      </SpotlightCard>
    </Link>
  );
}
