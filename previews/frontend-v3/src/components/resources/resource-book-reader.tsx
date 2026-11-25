import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, Download } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Tag } from "@/components/ui/tag";
import { sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import { PUBLISHED_BOOK_BODY_ID } from "@/lib/site-book-position";
import { BookDirectoryPane, type BookDirectorySection } from "./book-directory-pane";
import { PublishedBookIllustrations } from "./published-book-illustrations";
import { PublishedBookReadingTools, type PublishedBookReading } from "./published-book-reading-tools";

type ReaderChapter = { id: string; href: string; title: string; summary?: string };
type ReaderBook = {
  href: string;
  title: string;
  summary: string;
  overview?: string;
  category: string;
  vipOnly: boolean;
  chapters: readonly ReaderChapter[];
};
const chapterLink = "flex min-h-11 items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm text-muted transition-colors hover:text-fg aria-[current=page]:border-accent/30 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent";
const bookReadingToolLabels = [
  "resumeReading", "bookmarks", "toggleBookmark", "localBookmarks", "removeBookmark",
  "noBookmarks", "bookmarksUnavailable", "positionMoved",
] as const;

async function BookReadingToolsLocale({ children }: { children: ReactNode }) {
  const { Library } = await getMessages();
  const messages = Object.fromEntries(bookReadingToolLabels.map((key) => [key, Library[key]]));
  return <NextIntlClientProvider messages={{ Library: messages }}>{children}</NextIntlClientProvider>;
}

export async function ResourceBookReader({ book, chapterIndex, body, download, cover, draft = false, published = false, bookDownload, reading, subsections }: {
  book: ReaderBook;
  chapterIndex: number;
  body?: ReactNode;
  download?: string;
  cover?: ReactNode;
  draft?: boolean;
  published?: boolean;
  bookDownload?: string;
  reading?: PublishedBookReading;
  subsections?: readonly BookDirectorySection[];
}) {
  const chapter = book.chapters[chapterIndex];
  const previous = book.chapters[chapterIndex - 1];
  const next = book.chapters[chapterIndex + 1];
  const t = await getTranslations("Library");

  return (
    <>
      <PageHeader
        eyebrow={t(draft ? "draftPreview" : published ? "navTitle" : "sample")}
        title={book.title}
        body={book.summary}
        className="pt-28 sm:pt-32"
      />
      <div className="container-x pb-12 pt-5 sm:pb-16" data-reader-parent={draft ? undefined : chapter ? book.href : sansphaseLinks.resources}>
        <Link href={sansphaseLinks.resources} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-accent">
          <ArrowLeft aria-hidden className="size-4" />
          {t("back")}
        </Link>
        <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-7">
          <nav aria-label={t("chapters")} className="rounded-2xl border border-line bg-bg-elevated p-4 lg:sticky lg:top-28 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:flex-col">
            <p className="mb-2 flex shrink-0 items-center gap-2 px-3 py-2 text-sm font-medium">
              <BookOpen aria-hidden className="size-4 text-accent" />
              {t("chapters")}
            </p>
            <BookDirectoryPane chapterId={chapter?.id} headings={subsections}>
              <Link href={book.href} prefetch={false} aria-current={!chapter ? "page" : undefined} className={chapterLink}>
                {t("overview")}
              </Link>
              <ol>
                {book.chapters.map((item, index) => (
                  <li key={item.id}>
                    <Link href={item.href} prefetch={false} aria-current={chapter?.id === item.id ? "page" : undefined} data-section-chapter={item.id} className={chapterLink}>
                      <span className="w-5 shrink-0 font-mono text-xs text-muted">{String(index + 1).padStart(2, "0")}</span>
                      {item.title}
                    </Link>
                    {chapter?.id === item.id && Boolean(subsections?.length) && (
                      <details open className="group/sections ms-5 border-s border-line ps-3">
                        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted hover:text-accent [&::-webkit-details-marker]:hidden">
                          <ChevronDown aria-hidden className="size-3 transition-transform group-open/sections:rotate-180" />
                          {t("subsections")}
                        </summary>
                        <ul className="pb-2" data-section-headings={item.id}>
                          {subsections?.map((section, index) => (
                            <li key={`${section.href}:${index}`} className={section.level > 2 ? "ps-3" : undefined}>
                              <Link href={section.href} prefetch={false} scroll={false} data-section-heading className="block rounded-md px-1.5 py-2 text-xs leading-5 text-muted hover:text-accent aria-[current=location]:bg-accent-soft aria-[current=location]:text-accent">
                                {section.title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </BookDirectoryPane>
          </nav>

          <article className="min-w-0 rounded-2xl border border-line bg-bg-elevated px-5 py-6 sm:px-9 sm:py-9">
            <h2 className="text-pretty font-display text-2xl font-semibold tracking-tight">{chapter?.title ?? t("overview")}</h2>
            {reading && (
              <BookReadingToolsLocale>
                <PublishedBookReadingTools key={reading.key} reading={reading} chapter={chapter} chapters={book.chapters} />
              </BookReadingToolsLocale>
            )}
            {chapter ? (
              <>
                <div id={reading ? PUBLISHED_BOOK_BODY_ID : undefined} className="prose-tdx mt-5 overflow-x-auto [&_tr>*:first-child]:whitespace-nowrap">{body}</div>
                {reading && <PublishedBookIllustrations passage={`${book.href}/${chapter.id}?part=${reading.part}&revision=${reading.revision}`} />}
                {download && (
                  <a href={download} download className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline">
                    <Download aria-hidden className="size-4" /> {t("downloadChapter")}
                  </a>
                )}
              </>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Tag>{book.category}</Tag>
                  <Tag>{t("chaptersCount", { count: book.chapters.length })}</Tag>
                  {book.vipOnly && <Tag tone="accent">{t(published ? "vip" : "vipDemo")}</Tag>}
                </div>
                {book.overview && <p className="mt-4 max-w-2xl text-pretty text-sm leading-7 text-muted">{book.overview}</p>}
                {cover}
                {bookDownload && (
                  <a href={bookDownload} download className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline">
                    <Download aria-hidden className="size-4" /> {t("downloadBook")}
                  </a>
                )}
                <ol className="mt-6 grid gap-3">
                  {book.chapters.map((item) => (
                    <li key={item.id}>
                      <Link href={item.href} prefetch={false} className="group block rounded-xl border border-line px-4 py-3 hover:border-accent/40">
                        <span className="font-medium group-hover:text-accent">{item.title}</span>
                        {item.summary && <span className="mt-1 block text-sm leading-6 text-muted">{item.summary}</span>}
                      </Link>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <nav aria-label={t("chapterNavigation")} className="mt-7 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
              {chapter && (
                <Link href={previous?.href ?? book.href} prefetch={false} className="inline-flex min-h-11 items-center gap-2 text-muted hover:text-accent">
                  <ArrowLeft aria-hidden className="size-4" /> {previous ? t("previous") : t("overview")}
                </Link>
              )}
              {next && (
                <Link href={next.href} prefetch={false} className="ml-auto inline-flex min-h-11 items-center gap-2 text-accent hover:underline">
                  {chapter ? t("next") : t("start")} <ArrowRight aria-hidden className="size-4" />
                </Link>
              )}
            </nav>
          </article>
        </div>
      </div>
    </>
  );
}
