import { BookOpenText, Clock3 } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { ArrowSwap } from "@/components/home/data/arrow-swap";
import { PostCardFrame } from "@/components/home/data/post-card-frame";
import styles from "@/components/home/data/post-card.module.css";
import { Tag } from "@/components/ui/tag";
import type { PostMeta } from "@/lib/blog";
import { cn, formatDate } from "@/lib/utils";

export type PostCardEntry = Pick<PostMeta, "slug" | "title" | "description" | "date" | "tags" | "cover" | "coverAlt" | "coverSize">
  & Partial<Pick<PostMeta, "locale" | "fallback">> & { badge?: string };

export function PostCard({
  post,
  locale,
  minRead,
  detail,
  featured = false,
  href,
  prefetch,
  wideCover = false,
  coverSize = post.coverSize ?? { width: 1536, height: 1024 },
}: {
  post: PostCardEntry;
  locale: string;
  minRead?: string;
  detail?: string;
  featured?: boolean;
  href?: string;
  prefetch?: boolean;
  wideCover?: boolean;
  coverSize?: { width: number; height: number };
}) {
  const cursor = useTranslations("FX.common.cursor");
  const label = detail ?? minRead;
  const LabelIcon = detail ? BookOpenText : Clock3;

  return (
    <PostCardFrame
      href={href ?? `/blog/${post.slug}`}
      prefetch={prefetch}
      cursorText={cursor("read")}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line hover:border-accent/40 hover:shadow-soft",
        featured ? "bg-fg text-bg" : "bg-bg-elevated",
      )}
    >
      {post.cover && (
        <div className={cn("relative shrink-0 overflow-hidden border-b border-line bg-bg", wideCover ? "aspect-video" : "aspect-[3/2]")}>
          <Image
            src={post.cover}
            alt={post.coverAlt ?? ""}
            width={coverSize.width}
            height={coverSize.height}
            unoptimized={post.cover.startsWith("/api/media/") || post.cover === "/share/cover.jpg"}
            sizes={featured ? "(max-width: 768px) 100vw, 1200px" : wideCover
              ? "(max-width: 767px) 100vw, (max-width: 1279px) 50vw, 580px"
              : "(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw"}
            className={cn("h-full w-full object-contain", styles.cover)}
          />
          <span aria-hidden="true" className={styles.glare} />
          {label && <span
            aria-hidden="true"
            className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/85 px-2.5 py-1 font-mono text-[10px] text-fg backdrop-blur-md"
          >
            <LabelIcon className="h-3 w-3 text-accent transition-[rotate] duration-700 ease-(--fx-ease) motion-safe:group-hover:rotate-[360deg]" />
            {label}
          </span>}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col px-4 py-3 sm:px-5">
        <h3 className="line-clamp-2 wrap-anywhere font-display text-lg font-semibold leading-snug tracking-tight">
          <span className="bg-[linear-gradient(var(--accent),var(--accent))] bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat [box-decoration-break:clone] transition-[background-size] duration-700 ease-(--fx-ease) group-hover:bg-[length:100%_1.5px] group-focus-visible:bg-[length:100%_1.5px]">
            {post.title}
          </span>
        </h3>
        {post.description && <p className={cn("mt-1 line-clamp-1 wrap-anywhere text-sm leading-5", featured ? "text-bg/70" : "text-muted")}>
          {post.description}
        </p>}
        <div className={cn("mt-auto flex items-center justify-between gap-2 pt-2 font-mono text-[11px]", featured ? "text-bg/65" : "text-muted")}>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <time dateTime={post.date}>{formatDate(post.date, locale)}</time>
            {label && (post.cover ? (
              <span className="sr-only">{label}</span>
            ) : (
              <>
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-accent" />
                {label}
              </>
            ))}
            {post.fallback && post.locale && <span>{post.locale.toUpperCase()}</span>}
            {post.badge && <Tag tone="accent">{post.badge}</Tag>}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-300 group-hover:bg-accent group-hover:text-(--fx-on-accent) group-focus-visible:bg-accent group-focus-visible:text-(--fx-on-accent)",
              featured ? "bg-bg/10 text-bg" : "bg-bg text-fg",
            )}
          >
            <ArrowSwap />
          </span>
        </div>
      </div>
    </PostCardFrame>
  );
}
