import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import type { SansphasePostMeta } from "@/lib/sansphase-blog";
import { formatDate } from "@/lib/utils";

export function ArticleRows({
  posts,
  locale,
  heading: Heading = "h3",
}: {
  posts: SansphasePostMeta[];
  locale: string;
  heading?: "h3" | "h4";
}) {
  const t = useTranslations("Common");

  return (
    <ul role="list" className="min-w-0 divide-y divide-line rounded-2xl border border-line bg-bg-elevated/50">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link
            href={`${sansphaseLinks.blog}/${post.slug}`}
            className="group grid grid-cols-[minmax(0,1fr)_5rem] items-start gap-x-4 rounded-xl p-4 transition-colors hover:bg-bg-elevated focus-visible:bg-bg-elevated sm:grid-cols-[minmax(0,1fr)_8rem] sm:gap-x-6 sm:p-5 md:grid-cols-[minmax(0,1fr)_9rem]"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                <time dateTime={post.date}>{formatDate(post.date, locale)}</time>
                <span>{t("minRead", { minutes: post.readingMinutes })}</span>
              </p>
              <Heading className="mt-2 font-display text-lg font-semibold leading-snug text-pretty transition-colors group-hover:text-accent group-focus-visible:text-accent sm:text-xl">
                {post.title}
              </Heading>
            </div>
            <div className="col-start-2 row-start-1 self-start overflow-hidden rounded-lg border border-line bg-bg sm:row-span-2">
              <Image
                src={post.cover}
                alt=""
                width={post.coverSize.width}
                height={post.coverSize.height}
                sizes="(min-width: 768px) 144px, (min-width: 640px) 128px, 80px"
                className="h-auto w-full"
              />
            </div>
            <div className="col-span-2 mt-2 sm:col-span-1 sm:col-start-1">
              <p className="text-sm leading-relaxed text-pretty text-muted">{post.description}</p>
              <div className="mt-3 flex items-end justify-between gap-x-2">
                <ul role="list" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {post.tags.map((tag) => <li key={tag}>{tag}</li>)}
                </ul>
                <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-accent" />
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
