import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ResourceBookReader } from "@/components/resources/resource-book-reader";
import { loadLocalBookChapter, loadLocalBookDraft } from "@/lib/local-book-preview";
import { localV3AdminOrigin } from "@/lib/local-reader-bridge";
import { siteBackendOrigin } from "@/lib/site-backend";

type Props = { params: Promise<{ book: string; chapter?: string[] }> };

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function AuthorBookPreviewPage({ params }: Props) {
  const siteOrigin = siteBackendOrigin();
  const origin = siteOrigin ? new URL(siteOrigin) : localV3AdminOrigin(process.env.SANSPHASE_V3_LOCAL_READER_ORIGIN);
  const [{ book, chapter = [] }, requestHeaders, requestCookies] = await Promise.all([params, headers(), cookies()]);
  if (!origin || (!siteOrigin && requestHeaders.get("host") !== "localhost:4308") || chapter.length > 1) notFound();
  const session = requestCookies.get("sansphase_author_session")?.value ?? "";
  const draft = await loadLocalBookDraft(origin, session, book);
  if (!draft) notFound();
  const chapterIndex = draft.book.chapters.findIndex((item) => item.id === chapter[0]);
  if (chapter.length && chapterIndex < 0) notFound();
  const selected = draft.book.chapters[chapterIndex];
  const html = selected ? await loadLocalBookChapter(origin, session, draft, selected) : "";
  if (html === null) notFound();
  const href = `/book-preview/${book}`;
  // The owner-only content service sanitizes the HTML before fragmenting chapters.
  const body = selected ? <div dangerouslySetInnerHTML={{ __html: html }} /> : undefined;

  return <ResourceBookReader
    draft
    chapterIndex={chapterIndex}
    body={body}
    cover={draft.coverSrc ? <Image src={draft.coverSrc} alt={draft.title} width={960} height={540} unoptimized className="mt-5 h-auto max-w-full rounded-xl" /> : undefined}
    book={{
      href,
      title: draft.title,
      summary: draft.summary,
      category: draft.category,
      vipOnly: draft.vipOnly,
      chapters: draft.book.chapters.map((item) => ({ id: item.id, href: `${href}/${encodeURIComponent(item.id)}`, title: item.title })),
    }}
  />;
}
