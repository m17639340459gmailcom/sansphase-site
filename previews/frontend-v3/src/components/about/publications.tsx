import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { Odometer } from "@/components/fx/odometer";
import { buttonClasses } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { Link } from "@/i18n/navigation";
import { localizedPath } from "@/i18n/paths";
import {
  aboutPublicationHref, aboutPublicationQuery, queryAboutPublications, relatedAboutPublication,
  type AboutPublication, type AboutPublicationQuery, type AboutPublicationSearch,
} from "@/lib/about-publications";
import { formatDate } from "@/lib/utils";

const link = "group/link inline-flex min-h-11 items-center gap-1.5 text-sm transition-colors";

/** Diagonal arrow swap on hover/focus of the nearest `group/link`. */
function RollArrow() {
  const move = "absolute h-3.5 w-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]";
  return (
    <span aria-hidden className="relative inline-grid h-3.5 w-3.5 place-items-center overflow-hidden">
      <ArrowUpRight className={`${move} group-hover/link:translate-x-3.5 group-hover/link:-translate-y-3.5 group-focus-visible/link:translate-x-3.5 group-focus-visible/link:-translate-y-3.5`} />
      <ArrowUpRight className={`${move} -translate-x-3.5 translate-y-3.5 group-hover/link:translate-x-0 group-hover/link:translate-y-0 group-focus-visible/link:translate-x-0 group-focus-visible/link:translate-y-0`} />
    </span>
  );
}

export async function Publications({ articles, locale, search, unavailable }: {
  articles: readonly AboutPublication[]; locale: string; search?: AboutPublicationSearch; unavailable: boolean;
}) {
  const [t, blog] = await Promise.all([getTranslations("About.publications"), getTranslations("Blog")]);
  const filterEnabled = search !== undefined;
  const filters = aboutPublicationQuery(search ?? {});
  const result = queryAboutPublications(articles, filters, locale);
  const categories = [...new Set(articles.map(({ category }) => category).filter(Boolean))];
  const resetHref = aboutPublicationHref(aboutPublicationQuery({}));
  const href = (changes: Partial<AboutPublicationQuery>) => aboutPublicationHref({ ...filters, ...changes });
  const prefetch = filterEnabled ? false : undefined;
  const copy = locale === "en" ? {
    intro: "Browse published articles by topic or search for something specific.",
    category: "Topic", search: "Search", unavailable: "Articles are temporarily unavailable. Please try again later.",
  } : {
    intro: "按主题浏览已发布的文章，或搜索你感兴趣的内容。",
    category: "主题", search: "搜索", unavailable: "暂时无法加载文章，请稍后再试。",
  };

  return (
    <section id="blog" className="container-x scroll-mt-24 py-16 sm:scroll-mt-28 lg:py-24" aria-label={t("title")}>
      <SectionHeading eyebrow={t("eyebrow")} title={t("title")} body={filterEnabled ? copy.intro : t("intro")} size="md" />
      {filterEnabled && articles.length > 0 && (
        <form action={localizedPath(locale, resetHref)} method="get" className="mt-8 flex flex-wrap items-center gap-2">
          {filters.tag && <input type="hidden" name="tag" value={filters.tag} />}
          {categories.length > 0 && (
            <select aria-label={copy.category} name="category" defaultValue={filters.category} className="min-h-11 max-w-full rounded-xl border border-line bg-bg-elevated px-3 text-sm focus:border-accent focus-visible:outline-none">
              <option value="all">{blog("allPosts")}</option>
              {filters.category !== "all" && !categories.includes(filters.category) && <option value={filters.category}>{filters.category}</option>}
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          )}
          <input aria-label={blog("searchLabel")} name="q" type="search" maxLength={200} defaultValue={filters.q} placeholder={blog("searchPlaceholder")} className="min-h-11 min-w-40 max-w-xs flex-1 rounded-xl border border-line bg-bg-elevated px-3 text-sm focus:border-accent focus-visible:outline-none" />
          <button type="submit" className={buttonClasses({ variant: "secondary" })}>{copy.search}</button>
          {(filters.category !== "all" || filters.q || filters.tag) && (
            <Link href={resetHref} prefetch={false} className="inline-flex min-h-11 items-center px-2 text-sm text-accent hover:underline">
              {blog("reset")}{filters.tag && <span className="ml-1 text-muted">· {filters.tag}</span>}
            </Link>
          )}
        </form>
      )}
      {!result.posts.length && (
        <p role="status" className="mt-8 border-t border-line py-8 text-sm text-muted">
          {unavailable ? copy.unavailable : articles.length ? blog("noResults") : blog("empty")}
        </p>
      )}
      <ol className={result.posts.length ? "mt-8 border-t border-line sm:mt-10" : undefined}>
        {result.posts.map((article, index) => {
          const { title } = article;
          const companion = relatedAboutPublication(article, articles);
          return (
            <Reveal
              key={article.slug}
              as="li"
              delay={index * 0.08}
              className="group/pub relative isolate grid gap-4 border-b border-line py-7 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-6 sm:py-9 lg:gap-10"
            >
              {/* Hover: a soft sweep fills the row and an accent rule draws along its base. */}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 -inset-x-3 -z-10 origin-left scale-x-0 rounded-xl bg-accent-soft transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/pub:scale-x-100 sm:-inset-x-5" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-accent transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/pub:scale-x-100" />
              <span aria-hidden className="text-outline pointer-events-none absolute right-0 top-8 hidden font-display text-7xl font-semibold leading-none tracking-[-0.04em] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/pub:-translate-x-3 group-hover/pub:text-outline-accent xl:block">
                {String(result.start + index).padStart(2, "0")}
              </span>
              <time dateTime={article.date} className="font-mono text-sm text-accent transition-transform duration-500 group-hover/pub:translate-x-1 sm:pt-1">
                <Odometer value={article.date.slice(0, 4)} duration={1.4} />
              </time>
              <article className="min-w-0 max-w-4xl">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-relaxed text-muted">
                  {article.category && (
                    <>
                      <span>{article.category}</span>
                      <span className="h-1 w-1 rounded-full bg-line-strong transition-colors group-hover/pub:bg-accent" aria-hidden />
                    </>
                  )}
                  <span>{t("format")}</span>
                </div>
                <h3 className="font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                  <Link
                    href={article.href}
                    prefetch={prefetch}
                    className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size,color] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:text-accent focus-visible:bg-[length:100%_1px] group-hover/pub:bg-[length:100%_1px]"
                  >
                    {title}
                  </Link>
                </h3>
                {article.englishTitle && <p lang="en" className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">{article.englishTitle}</p>}
                {article.tags.length > 0 && (
                  <p className="mt-4 text-xs leading-relaxed text-muted">
                    {filterEnabled ? article.tags.map((tag, index) => (
                      <Fragment key={tag}>
                        {index > 0 && " · "}
                        <Link href={href({ tag, page: 1 })} prefetch={false} className="hover:text-accent hover:underline focus-visible:underline">{tag}</Link>
                      </Fragment>
                    )) : article.tags.join(" · ")}
                  </p>
                )}
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {formatDate(article.date, locale)}
                </p>
                {article.description && <p className="mt-4 max-w-3xl text-sm leading-[1.8] text-fg/85">{article.description}</p>}
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                  <Link href={article.href} prefetch={prefetch} aria-label={t("readArticle", { title })} className={`${link} font-medium text-accent hover:text-accent-strong`}>
                    {t("read")}
                    <RollArrow />
                  </Link>
                  {companion && (
                    <Link href={companion.href} prefetch={prefetch} aria-label={t("relatedArticle", { title: companion.title })} className={`${link} text-muted hover:text-fg`}>
                      {t("related")}
                      <RollArrow />
                    </Link>
                  )}
                </div>
              </article>
            </Reveal>
          );
        })}
      </ol>
      {filterEnabled && result.totalPages > 1 && (
        <nav aria-label={blog("paginationLabel")} className="mt-8 flex flex-wrap items-center gap-3 text-sm text-muted">
          {result.currentPage > 1 && <Link href={href({ page: result.currentPage - 1 })} prefetch={false} className={buttonClasses({ variant: "secondary" })}>{blog("previousPage")}</Link>}
          <span>{blog("pageOf", { page: result.currentPage, pages: result.totalPages })}</span>
          {result.currentPage < result.totalPages && <Link href={href({ page: result.currentPage + 1 })} prefetch={false} className={buttonClasses({ variant: "secondary" })}>{blog("nextPage")}</Link>}
        </nav>
      )}
    </section>
  );
}
