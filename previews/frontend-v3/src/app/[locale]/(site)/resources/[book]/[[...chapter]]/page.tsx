import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ResourceAccessMessage } from "@/components/resources/resource-access-message";
import { ResourceBookReader } from "@/components/resources/resource-book-reader";
import { PageHeader } from "@/components/ui/page-header";
import { localize } from "@/data/sansphase";
import { bookCategories, demoBooks, demoChapterDownload, resolveDemoBook, type BookChapter, type DemoBook } from "@/data/sansphase-library";
import { routing } from "@/i18n/routing";
import { renderMdx } from "@/lib/mdx";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";
import { siteBookPosition, siteBookPositionQuery } from "@/lib/site-book-position";
import { readSiteBook, readSiteBookChapter } from "@/lib/site-books";
import { getTranslations } from "next-intl/server";

type Params = { locale: string; book: string; chapter?: string[] };
type ReadingSearch = { part?: string | string[]; block?: string | string[]; offset?: string | string[] };
type Props = { params: Promise<Params>; searchParams: Promise<ReadingSearch> };

export const dynamic = "force-dynamic";

function findBook({ book, chapter }: Params) {
  const selected = resolveDemoBook(book, chapter);
  if (!selected) notFound();
  return selected;
}

export function generateStaticParams() {
  if (siteBackendOrigin()) return [];
  return routing.locales.flatMap((locale) =>
    demoBooks.flatMap((book) => [[], ...book.chapters.map(({ id }) => [id])]
      .map((chapter) => ({ locale, book: book.slug, chapter }))),
  );
}

function chapterHref(book: DemoBook, chapter?: BookChapter) {
  return chapter ? `${book.href}/${chapter.id}` : book.href;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const values = await params;
  const { locale } = values;
  if (siteBackendOrigin()) {
    const t = await getTranslations({ locale, namespace: "Library" });
    return { title: t("navTitle"), robots: { index: false, follow: false } };
  }
  const { book, chapter } = findBook(values);
  const item = chapter ?? book;
  return sansphasePageMetadata(locale, chapterHref(book, chapter), localize(item.title, locale), localize(item.summary, locale));
}

export default async function ResourceBookPage({ params, searchParams }: Props) {
  const [values, search] = await Promise.all([params, searchParams]);
  const origin = siteBackendOrigin();
  if (origin) return <PublishedBookPage origin={origin} values={values} search={search} />;
  const { locale } = values;
  const { book, chapter, chapterIndex } = findBook(values);
  const download = chapter && demoChapterDownload(book.slug, chapter.id, locale);
  const markdown = download && await readFile(join(process.cwd(), "public", download.slice(1)), "utf8");
  const body = markdown && await renderMdx(markdown.replace(/^# [^\r\n]+\r?\n(?:\r?\n)?/u, ""));

  return <ResourceBookReader chapterIndex={chapterIndex} body={body} download={download} book={{
    href: book.href,
    title: localize(book.title, locale),
    summary: localize(book.summary, locale),
    overview: localize(book.overview, locale),
    category: localize(bookCategories[book.category], locale),
    vipOnly: book.vipOnly,
    chapters: book.chapters.map((item) => ({
      id: item.id,
      href: chapterHref(book, item),
      title: localize(item.title, locale),
      summary: localize(item.summary, locale),
    })),
  }} />;
}

async function PublishedBookPage({ origin, values, search }: {
  origin: string;
  values: Params;
  search: ReadingSearch;
}) {
  const { locale, book: slug, chapter: chapters = [] } = values;
  const { part, block, offset } = search;
  const requestedPosition = block !== undefined || offset !== undefined;
  const target = siteBookPosition(block, offset);
  const selectedId = chapters[0];
  if (chapters.length > 1 ||
    (part !== undefined && (typeof part !== "string" || !/^[1-9]\d{0,7}$/.test(part) || !selectedId)) ||
    (requestedPosition && (!target || part !== undefined || !selectedId))) notFound();
  const requestedPart = part === undefined ? 1 : Number(part);
  const bookPath = `/resources/${encodeURIComponent(slug)}`;
  const chapterPath = selectedId ? `${bookPath}/${encodeURIComponent(selectedId)}` : bookPath;
  const readingPath = target ? `${chapterPath}?${siteBookPositionQuery(target)}` : requestedPart === 1 ? chapterPath : `${chapterPath}?part=${requestedPart}`;
  const cookie = (await headers()).get("cookie");
  const result = await readSiteBook(origin, cookie, slug);
  if (result.status === "missing") notFound();
  if (result.status !== "ready") {
    return <PublishedBookAccess locale={locale} state={result.status} returnTo={readingPath} title={result.status === "vip-required" ? result.book?.title : undefined} />;
  }

  const book = result.book;
  const chapterIndex = book.chapters.findIndex((item) => item.id === selectedId);
  if (selectedId && chapterIndex < 0) notFound();
  const selected = book.chapters[chapterIndex];
  if (selected && requestedPart > selected.parts) notFound();
  const chapter = selected && await readSiteBookChapter(origin, cookie, slug, book.revision, selected, target ?? requestedPart - 1);
  if (chapter && chapter.status !== "ready") {
    return <PublishedBookAccess locale={locale} state={chapter.status} returnTo={chapter.status === "changed" ? chapterPath : readingPath} title={book.title} />;
  }
  return <ResourceBookReader
    published
    reading={{ key: book.readingKey, revision: book.revision, part: chapter?.part, target: target ?? undefined, relocated: chapter?.relocated }}
    chapterIndex={chapterIndex}
    body={chapter?.fragments.map((html, index) => (
      <div key={index} className="contents" data-book-part={index} dangerouslySetInnerHTML={{ __html: html }} />
    ))}
    subsections={selected?.headings.map((heading) => ({
      ...heading,
      href: `${chapterPath}?${siteBookPositionQuery(heading)}`,
    }))}
    bookDownload={book.download ?? undefined}
    cover={book.cover ? <Image src={book.cover} alt={book.title} width={book.coverSize?.width ?? 960} height={book.coverSize?.height ?? 540} unoptimized className="mt-5 h-auto max-w-full rounded-xl" /> : undefined}
    book={{
      href: book.href,
      title: book.title,
      summary: book.description,
      category: book.category,
      vipOnly: book.vipOnly,
      chapters: book.chapters.map((item) => ({ id: item.id, title: item.title, href: `${book.href}/${encodeURIComponent(item.id)}` })),
    }}
  />;
}

async function PublishedBookAccess({ locale, state, title, returnTo }: {
  locale: string;
  state: "sign-in" | "vip-required" | "changed";
  title?: string;
  returnTo: string;
}) {
  const t = await getTranslations("Library");
  return <>
    <PageHeader eyebrow={t("navTitle")} title={t("chapters")} />
    <div className="container-x pb-12 pt-5 sm:pb-16">
      <ResourceAccessMessage state={state} locale={locale} returnTo={returnTo} bookTitle={title} />
    </div>
  </>;
}
