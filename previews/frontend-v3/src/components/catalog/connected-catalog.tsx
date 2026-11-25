import { Download, FileText, Monitor } from "lucide-react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CatalogCard, CatalogCardGrid } from "@/components/catalog/catalog-card";
import { pad, type GalleryImage } from "@/components/projects/gallery-utils";
import { ProjectHero } from "@/components/projects/project-hero";
import { ProjectsGrid } from "@/components/projects/projects-grid";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tag } from "@/components/ui/tag";
import type { ProjectListItem } from "@/data/projects";
import { Link } from "@/i18n/navigation";
import { localizedPath } from "@/i18n/paths";
import { catalogHref, catalogPaths, catalogQuery, type CatalogKind, type CatalogQuery } from "@/lib/catalog-navigation";
import { type CatalogItem, readSiteCatalog, readSiteCatalogEntry } from "@/lib/site-catalog";
import { prepareSiteRichText } from "@/lib/site-rich-text";
import { cn, formatDate } from "@/lib/utils";

const copy = {
  zh: {
    works: "作品", resources: "资料", software: "软件推荐", search: "搜索", category: "分类",
    all: "全部", noMatches: "没有找到符合条件的内容。", login: "前往登录",
    signin: "登录现有账号后即可继续浏览。", forbidden: "当前账号无权访问此内容。",
    unavailable: "暂时无法加载内容，请稍后重试。", back: "返回列表", previous: "上一页", next: "下一页",
    pages: "分页", published: "已发布", files: "附件下载", openImage: "查看图片",
  },
  en: {
    works: "Projects", resources: "Materials", software: "Software", search: "Search", category: "Category",
    all: "All", noMatches: "No matching entries.", login: "Sign in",
    signin: "Sign in with your existing account to continue.", forbidden: "This account does not have access.",
    unavailable: "Content is temporarily unavailable. Please try again later.", back: "Back to the list", previous: "Previous", next: "Next",
    pages: "Pagination", published: "Published", files: "Downloads", openImage: "View image",
  },
} as const;

const words = (locale: string) => copy[locale === "en" ? "en" : "zh"];
const projectStyle = { hue: 248, motif: "grid" } as const;

function CatalogMessage({ state, kind, locale, path }: {
  state: "signin" | "forbidden" | "unavailable"; kind: CatalogKind; locale: string; path: string;
}) {
  const text = words(locale);
  const returnTo = localizedPath(locale, path);
  return (
    <section className="container-x py-10">
      <div className="rounded-2xl border border-line bg-bg-elevated p-6 sm:p-8">
        <p role="status" className="text-base text-muted">{text[state]}</p>
        {state === "signin" ? (
          <ButtonLink href={`/account?${new URLSearchParams({ returnTo })}`} className="mt-5" arrow>{text.login}</ButtonLink>
        ) : path !== catalogPaths[kind] && (
          <ButtonLink href={catalogPaths[kind]} variant="secondary" className="mt-5">{text.back}</ButtonLink>
        )}
      </div>
    </section>
  );
}

function toProjectCard(item: CatalogItem, index: number, published: string): ProjectListItem {
  const title = { zh: item.title, en: item.title };
  const cover = item.showcase ?? item.cover;
  return {
    ...projectStyle,
    index: pad(index + 1),
    slug: item.id,
    title,
    tagline: { zh: item.summary, en: item.summary },
    category: item.category,
    kind: { zh: "", en: "" },
    year: item.date?.slice(0, 4) ?? "",
    stage: { label: { zh: published, en: published }, tone: "ready" },
    stack: item.tags,
    highlights: [],
    cover: cover ? { ...cover, alt: title } : undefined,
  };
}

export async function ConnectedCatalog({ origin, kind, locale, search }: {
  origin: string; kind: CatalogKind; locale: string; search: Record<string, string | string[] | undefined>;
}) {
  const query = catalogQuery(search);
  const text = words(locale);
  const result = await readSiteCatalog(origin, kind, query, (await headers()).get("cookie"));
  if (result.status === "missing") notFound();
  if (result.status !== "ok") return <CatalogMessage state={result.status} kind={kind} locale={locale} path={catalogHref(kind, query)} />;
  const { items, categories, total, page, pages } = result.value;
  const options = [{ id: "all", name: text.all }, ...categories.map((name) => ({ id: name, name }))];

  function pageHref(next: Partial<CatalogQuery>) {
    return catalogHref(kind, { ...query, ...next });
  }

  return (
    <section id="catalog" className="container-x pb-16 pt-5 sm:pb-24">
      <form action={localizedPath(locale, catalogPaths[kind])} method="get" className="mb-6 flex max-w-lg items-center gap-2">
        {query.category !== "all" && <input type="hidden" name="category" value={query.category} />}
        <input aria-label={text.search} name="q" type="search" maxLength={200} defaultValue={query.q} placeholder={text.search} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg-elevated px-4 text-sm focus:border-accent focus-visible:outline-none" />
        <button type="submit" className={buttonClasses({ variant: "secondary" })}>{text.search}</button>
      </form>
      {kind === "works" ? (
        <ProjectsGrid
          projects={items.map((item, index) => toProjectCard(item, (page - 1) * 12 + index, text.published))}
          catalog={{ query, categories, total }}
        />
      ) : (
        <>
          <nav aria-label={text.category} className="mb-6 flex flex-wrap gap-2">
            {options.map(({ id, name }) => {
              const current = query.category === id;
              return (
                <Link key={id} href={pageHref({ category: id, page: 1 })} prefetch={false} scroll={false}
                  aria-current={current ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors", current
                    ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong hover:text-fg")}>
                  {name}
                </Link>
              );
            })}
          </nav>
          <CatalogCardGrid fillWidth={kind === "software"}>
            {items.map((item) => {
              const Icon = kind === "software" ? Monitor : FileText;
              return (
                <CatalogCard key={item.id} href={`${catalogPaths[kind]}/${item.id}`} title={item.title} summary={item.summary}
                  image={item.cover ?? item.showcase} fallback={<Icon className="size-9" strokeWidth={1.25} />} />
              );
            })}
          </CatalogCardGrid>
          {!items.length && <p role="status" className="py-10 text-center text-muted">{text.noMatches}</p>}
        </>
      )}
      {pages > 1 && (
        <nav aria-label={text.pages} className="mt-8 flex items-center justify-center gap-4">
          {page > 1 && <Link href={pageHref({ page: page - 1 })} prefetch={false} className={buttonClasses({ variant: "secondary" })}>{text.previous}</Link>}
          <span className="font-mono text-sm text-muted">{page} / {pages}</span>
          {page < pages && <Link href={pageHref({ page: page + 1 })} prefetch={false} className={buttonClasses({ variant: "secondary" })}>{text.next}</Link>}
        </nav>
      )}
    </section>
  );
}

export async function ConnectedCatalogEntry({ origin, kind, locale, slug }: { origin: string; kind: CatalogKind; locale: string; slug: string }) {
  const text = words(locale);
  const result = await readSiteCatalogEntry(origin, kind, slug, (await headers()).get("cookie"));
  if (result.status === "missing") notFound();
  if (result.status !== "ok") {
    return (
      <>
        <PageHeader eyebrow={text[kind]} title={text[kind]} />
        <CatalogMessage state={result.status} kind={kind} locale={locale} path={`${catalogPaths[kind]}/${slug}`} />
      </>
    );
  }
  const { title, summary, category, date, tags, bodyHTML, attachments } = result.value;
  const body = prepareSiteRichText(bodyHTML);
  const seen = new Set<string>();
  const images: GalleryImage[] = [];
  for (const image of [result.value.showcase, result.value.cover]) {
    if (!image || seen.has(image.src)) continue;
    seen.add(image.src);
    images.push({ ...image, alt: title, caption: title });
  }

  return (
    <article className="pb-16 sm:pb-24">
      {kind === "works" ? (
        <ProjectHero
          project={{ slug, index: "", year: date?.slice(0, 4) ?? "", ...projectStyle }}
          title={title} tagline={summary} kind="" category={category || text[kind]}
          stage={{ label: text.published, tone: "ready" }} caseLabel={text[kind]} backLabel={text.back}
          metrics={[]} images={images} cursorLabel={text.openImage}
        />
      ) : <PageHeader eyebrow={text[kind]} title={title} body={summary} />}
      <div className="container-x pt-5">
        <div className="flex flex-wrap items-center gap-3 border-b border-line pb-5 text-sm">
          {kind !== "works" && <Link href={catalogPaths[kind]} prefetch={false} className="text-muted hover:text-accent">{text.back}</Link>}
          {date && <time dateTime={date} className="font-mono text-xs text-muted">{formatDate(date, locale)}</time>}
          {kind !== "works" && category && <Tag tone="accent">{category}</Tag>}
          {tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
        </div>
        {body.html && <div className="prose-tdx mt-10 min-w-0 max-w-3xl" dangerouslySetInnerHTML={{ __html: body.html }} />}
        {attachments.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 font-display text-xl font-semibold">{text.files}</h2>
            <ul className="flex flex-wrap gap-3">
              {attachments.map(({ name, url }) => (
                <li key={url}>
                  <a className={buttonClasses({ variant: "secondary" })} href={url} download>
                    <Download className="size-4 text-accent" aria-hidden /> {name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}
