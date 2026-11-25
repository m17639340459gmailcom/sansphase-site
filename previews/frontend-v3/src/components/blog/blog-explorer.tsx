"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Search, SearchX, X } from "lucide-react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { PostCard, type PostCardEntry } from "@/components/blog/post-card";
import { useIntroDone } from "@/components/fx/intro-store";
import { ScrambleText } from "@/components/fx/scramble-text";
import { POSTS_PER_PAGE, queryBlogPosts, type BlogSort } from "@/lib/blog-query";
import { cn } from "@/lib/utils";
import { FeaturedPost } from "./featured-post";
import { RollingNumber } from "./rolling-number";

const EASE = [0.16, 1, 0.3, 1] as const;
const TAG_PREVIEW = 6;

type TagChip = { key: string; label: string; count: number };

function tagKey(tag: string) {
  return tag.normalize("NFKC").toLowerCase();
}

/** Tags grouped case-insensitively, most used first (ties keep newest-post order). */
function collectTags(posts: readonly PostCardEntry[]) {
  const chips = new Map<string, TagChip>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const key = tagKey(tag);
      const chip = chips.get(key);
      if (chip) chip.count += 1;
      else chips.set(key, { key, label: tag, count: 1 });
    }
  }
  return [...chips.values()].sort((a, b) => b.count - a.count);
}

type DirectoryEntry = PostCardEntry & {
  href?: string;
  readingMinutes?: number;
  detail?: string;
  searchTerms?: readonly string[];
};

export function BlogExplorer({
  posts,
  locale,
  kind = "blog",
}: {
  posts: readonly DirectoryEntry[];
  locale: string;
  kind?: "blog" | "resources";
}) {
  const isLibrary = kind === "resources";
  const t = useTranslations(isLibrary ? "Library.catalog" : "Blog");
  const tc = useTranslations("Common");
  const fx = useTranslations("FX.blog");
  const prefetch = isLibrary ? false : undefined;
  const readingLabel = (post: DirectoryEntry) =>
    post.readingMinutes === undefined ? undefined : tc("minRead", { minutes: post.readingMinutes });
  const controlId = useId();
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<BlogSort>("newest");
  const [page, setPage] = useState(1);
  const [tag, setTag] = useState<string | null>(null);
  const [allTags, setAllTags] = useState(false);
  const [entered, setEntered] = useState(false);
  const introDone = useIntroDone();
  const inView = useInView(results, { once: true, amount: 0.05 });
  const shown = introDone && inView;

  const tags = useMemo(() => collectTags(posts), [posts]);
  const pool = tag ? posts.filter((post) => post.tags.some((value) => tagKey(value) === tag)) : posts;
  const result = queryBlogPosts(pool, { search, sort, page, locale });
  const hasFilters = search.length > 0 || sort !== "newest" || tag !== null;
  const featured = !hasFilters && result.currentPage === 1 ? result.posts[0] : undefined;
  const gridPosts = featured ? result.posts.slice(1) : result.posts;
  const preview = tags.slice(0, TAG_PREVIEW);
  const activeTag = tags.find((chip) => chip.key === tag);
  const visibleTags = allTags ? tags : activeTag && !preview.includes(activeTag) ? [...preview, activeTag] : preview;
  const hiddenTags = tags.length - TAG_PREVIEW;
  const visiblePages = Array.from({ length: result.totalPages }, (_, index) => index + 1)
    .filter((value) => value === 1 || value === result.totalPages || Math.abs(value - result.currentPage) <= 1);

  function reset() {
    setSearch("");
    setSort("newest");
    setTag(null);
    setPage(1);
    searchInput.current?.focus();
  }

  function selectTag(next: string | null) {
    setTag(next);
    setPage(1);
  }

  function goToPage(nextPage: number) {
    setPage(nextPage);
    resultsHeading.current?.focus({ preventScroll: true });
    resultsHeading.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }

  const reveal = (index: number) => ({
    initial: entered ? { opacity: 0, scale: 0.94 } : { opacity: 0, y: 36 },
    animate: shown ? { opacity: 1, y: 0, scale: 1 } : undefined,
    exit: { opacity: 0, scale: 0.94, transition: { duration: 0.22, ease: EASE } },
    transition: {
      duration: 0.75,
      ease: EASE,
      delay: entered ? 0.05 : 0.1 + index * 0.07,
      layout: { duration: 0.6, ease: EASE },
    },
    onAnimationComplete: () => setEntered(true),
  });

  const chipClass =
    "relative isolate inline-flex h-11 items-center gap-2 rounded-full border px-4 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors duration-300 pointer-fine:h-9";

  return (
    <>
      <div className="border-b border-line py-6">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_13rem] sm:gap-6">
          <div>
            <label htmlFor={`${controlId}-search`} className="mb-2 block text-sm font-medium">
              {t("searchLabel")}
            </label>
            <div className="group/search relative rounded-xl border border-line bg-bg-elevated transition-colors focus-within:border-accent">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted transition-[color,scale] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-focus-within/search:scale-110 group-focus-within/search:text-accent"
              />
              <input
                ref={searchInput}
                id={`${controlId}-search`}
                type="search"
                value={search}
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && search) {
                    event.preventDefault();
                    setSearch("");
                    setPage(1);
                  }
                }}
                placeholder={t("searchPlaceholder")}
                aria-controls={`${controlId}-results`}
                className={cn(
                  "h-12 w-full min-w-0 rounded-xl bg-transparent pl-11 text-sm text-fg outline-none placeholder:text-muted/80 [&::-webkit-search-cancel-button]:appearance-none",
                  search ? "pr-28" : "pr-16",
                )}
              />

              <div className="absolute inset-y-0 right-1.5 flex items-center gap-1">
                <span aria-hidden="true" className="flex items-baseline px-1.5 font-mono text-[11px] text-muted">
                  <RollingNumber value={result.total} pad={2} className="text-fg" />
                  <span className="px-0.5">/</span>
                  {String(posts.length).padStart(2, "0")}
                </span>
                <AnimatePresence initial={false}>
                  {search && (
                    <motion.button
                      type="button"
                      aria-label={fx("clearSearch")}
                      onClick={() => {
                        setSearch("");
                        setPage(1);
                        searchInput.current?.focus();
                      }}
                      initial={{ opacity: 0, scale: 0.6, rotate: -90 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      exit={{ opacity: 0, scale: 0.6, rotate: 90 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:text-accent pointer-fine:h-9 pointer-fine:w-9"
                    >
                      <X aria-hidden="true" className="h-4 w-4" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
          <div>
            <label htmlFor={`${controlId}-sort`} className="mb-2 block text-sm font-medium">
              {t("sortLabel")}
            </label>
            <div className="group/sort relative rounded-xl border border-line bg-bg-elevated transition-colors hover:border-line-strong focus-within:border-accent">
              <select
                id={`${controlId}-sort`}
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as BlogSort);
                  setPage(1);
                }}
                aria-controls={`${controlId}-results`}
                className="h-12 w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-4 pr-10 text-sm text-fg outline-none"
              >
                <option value="newest">{t("sortNewest")}</option>
                <option value="oldest">{t("sortOldest")}</option>
                <option value="title">{t("sortTitle")}</option>
              </select>

              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted transition-[color,translate] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-focus-within/sort:text-accent group-hover/sort:translate-y-[calc(-50%+2px)]"
              />
            </div>
          </div>
        </div>

        {tags.length > 0 && (
          <div role="group" aria-label={fx("tags")} className="mt-5 flex flex-wrap items-center gap-2">
            {[{ key: null, label: fx("allTags"), count: posts.length }, ...visibleTags].map((chip, index) => {
              const active = chip.key === tag;
              return (
                <motion.button
                  key={chip.key ?? "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectTag(chip.key)}
                  initial={index > TAG_PREVIEW ? { opacity: 0, scale: 0.85 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease: EASE, delay: index > TAG_PREVIEW ? (index - TAG_PREVIEW) * 0.025 : 0 }}
                  className={cn(
                    chipClass,
                    active ? "border-fg text-bg" : "border-line text-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={`${controlId}-tag-pill`}
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-full bg-fg"
                      transition={{ type: "spring", stiffness: 480, damping: 38 }}
                    />
                  )}
                  {chip.label}
                  <span className={cn("tabular-nums", active ? "text-bg/60" : "text-muted/70")}>{chip.count}</span>
                </motion.button>
              );
            })}
            {hiddenTags > 0 && (
              <button
                type="button"
                aria-expanded={allTags}
                onClick={() => setAllTags(!allTags)}
                className={cn(chipClass, "border-dashed border-line-strong text-muted hover:border-accent hover:text-accent")}
              >
                {allTags ? fx("fewerTags") : fx("moreTags", { count: hiddenTags })}
                <ChevronDown
                  aria-hidden="true"
                  className={cn("h-3.5 w-3.5 transition-transform duration-500", allTags && "rotate-180")}
                />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mb-6 mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 ref={resultsHeading} tabIndex={-1} className="eyebrow flex scroll-mt-28 items-center gap-3">
          <span aria-hidden="true" className="inline-block h-px w-6 bg-accent" />
          <ScrambleText text={t("allPosts")} />
        </h2>
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-muted">
            {result.total > 0
              ? t("resultsRange", { start: result.start, end: result.end, count: result.total })
              : t("resultsCount", { count: 0 })}
          </p>
          {hasFilters && (
            <button type="button" onClick={reset} className="min-h-8 text-accent underline underline-offset-4 hover:text-fg">
              {t("reset")}
            </button>
          )}
        </div>
      </div>

      <div ref={results} id={`${controlId}-results`} className="relative">
        <AnimatePresence mode="popLayout">
          {featured && (
            <motion.div key={`featured-${featured.slug}`} data-reveal="" layout="position" className="mb-5 sm:mb-6" {...reveal(0)}>
              <FeaturedPost
                post={featured}
                href={featured.href}
                latestLabel={t("latest")}
                readLabel={isLibrary ? t("openBook") : fx("readArticle")}
                locale={locale}
                detail={featured.detail ?? readingLabel(featured)}
                prefetch={prefetch}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <ul className={cn("relative grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2", !isLibrary && "lg:grid-cols-3")}>
          <AnimatePresence mode="popLayout">
            {gridPosts.map((post, index) => (
              <motion.li key={post.slug} data-reveal="" layout="position" className="h-full min-w-0" {...reveal(index + 1)}>
                <PostCard post={post} href={post.href} locale={locale} minRead={readingLabel(post)} detail={post.detail} prefetch={prefetch} wideCover={isLibrary} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <AnimatePresence>
          {result.total === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.12 }}
              className="relative isolate overflow-hidden rounded-2xl border border-dashed border-line-strong px-6 py-16 text-center"
            >
              <div aria-hidden="true" className="dot-grid absolute inset-0 -z-10 opacity-40 mask-fade-y" />
              {search && (
                <p aria-hidden="true" className="fx-terminal mb-6 truncate">
                  <span className="text-accent">~/{kind}</span> $ grep &quot;{search}&quot; <span className="text-fg">→ 0</span>
                  <span className="fx-caret" />
                </p>
              )}
              <SearchX aria-hidden="true" className="pfx-wobble mx-auto mb-5 h-7 w-7 text-accent" />
              <h3 className="font-display text-xl font-semibold">{t(posts.length ? "noResults" : "empty")}</h3>
              {posts.length > 0 && (
                <>
                  <p className="mt-3 text-sm leading-7 text-muted">{t("noResultsHint")}</p>
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-6 min-h-11 rounded-full border border-line bg-bg-elevated px-5 text-sm transition-colors hover:border-accent hover:text-accent"
                  >
                    {t("reset")}
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {result.total > 0 && (
        <nav aria-label={t("paginationLabel")} className="mt-10 flex flex-col items-center gap-4 border-t border-line pt-7 sm:mt-12">
          <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-2">
            <button
              type="button"
              disabled={result.currentPage === 1}
              onClick={() => goToPage(result.currentPage - 1)}
              aria-label={t("previousPage")}
              className="group/prev flex h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line px-3 text-sm transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-fg sm:px-4"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4 transition-transform duration-300 group-enabled/prev:group-hover/prev:-translate-x-0.5" />
              <span className="hidden sm:inline">{t("previousPage")}</span>
            </button>
            {visiblePages.map((value, index) => {
              const current = result.currentPage === value;
              return (
                <span key={value} className="flex items-center gap-1 sm:gap-2">
                  {index > 0 && value - visiblePages[index - 1] > 1 && (
                    <span aria-hidden="true" className="px-1 text-muted">…</span>
                  )}
                  <button
                    type="button"
                    onClick={() => goToPage(value)}
                    aria-label={t("goToPage", { page: value })}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "relative isolate h-11 min-w-11 rounded-full border px-3 font-mono text-sm transition-colors",
                      current ? "border-fg text-bg" : "border-line hover:border-accent hover:text-accent",
                    )}
                  >
                    {current && (
                      <motion.span
                        layoutId={`${controlId}-page-pill`}
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 rounded-full bg-fg"
                        transition={{ type: "spring", stiffness: 480, damping: 38 }}
                      />
                    )}
                    {value}
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              disabled={result.currentPage === result.totalPages}
              onClick={() => goToPage(result.currentPage + 1)}
              aria-label={t("nextPage")}
              className="group/next flex h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line px-3 text-sm transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-fg sm:px-4"
            >
              <span className="hidden sm:inline">{t("nextPage")}</span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 group-enabled/next:group-hover/next:translate-x-0.5" />
            </button>
          </div>
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
            <span>{t("pageOf", { page: result.currentPage, pages: result.totalPages })}</span>
            <span aria-hidden="true">·</span>
            <span>{t("perPage", { count: POSTS_PER_PAGE })}</span>
          </p>
        </nav>
      )}
    </>
  );
}
