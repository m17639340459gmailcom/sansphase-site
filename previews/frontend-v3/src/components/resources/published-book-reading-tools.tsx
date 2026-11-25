"use client";

import { Bookmark, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { scrollToTarget } from "@/components/fx/lenis";
import { Link } from "@/i18n/navigation";
import { PUBLISHED_BOOK_BODY_ID, siteBookPosition, siteBookPositionQuery, type SiteBookPosition } from "@/lib/site-book-position";
import { createBookProgress, type BookAnchor } from "@/shared/site/book-progress";

const empty = { progress: null, bookmarks: [] } as ReturnType<typeof createBookProgress>["value"];
const positionTop = 150;
const actionClass = "inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline";

function bookProgress(key: string) {
  try { return createBookProgress(window.localStorage, key); }
  catch { return null; }
}

function blocks(body: HTMLElement) {
  return Array.from(body.querySelectorAll<HTMLElement>("[data-book-block][data-book-offset]"));
}

function visiblePosition(body: HTMLElement): (SiteBookPosition & { part: number }) | null {
  const items = blocks(body);
  const visible = items.find((block) => block.getBoundingClientRect().bottom > positionTop) ?? items.at(-1);
  if (!visible) return null;
  const position = siteBookPosition(visible.dataset.bookBlock, visible.dataset.bookOffset);
  const part = visible.closest<HTMLElement>("[data-book-part]")?.dataset.bookPart;
  return position && { ...position, part: Number(part ?? 0) };
}

function fragmentStart(body: HTMLElement, part: number) {
  return body.querySelector<HTMLElement>(`[data-book-part="${part}"] [data-book-block]`) ?? body;
}

function restorePosition(body: HTMLElement, position: SiteBookPosition, part: number, relocated: boolean) {
  const matches = blocks(body).filter((block) => block.dataset.bookBlock === position.block);
  const block = matches.find((candidate) => {
    const beginning = Number(candidate.dataset.bookOffset);
    return beginning <= position.offset && position.offset < beginning + Math.max(candidate.textContent.length, 1);
  }) ?? matches[0];
  if (!block) {
    if (relocated) scrollToTarget(fragmentStart(body, part), { offset: -positionTop, immediate: true });
    return;
  }
  let remaining = Math.max(0, position.offset - Number(block.dataset.bookOffset));
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const text = current as Text;
    if (remaining < text.length) {
      const range = document.createRange();
      range.setStart(text, remaining);
      range.setEnd(text, remaining + 1);
      scrollToTarget(range.getBoundingClientRect().top + window.scrollY, { offset: -positionTop, immediate: true });
      return;
    }
    remaining -= text.length;
  }
  scrollToTarget(block, { offset: -positionTop, immediate: true });
}

type Chapter = { id: string; href: string; title: string };
export type PublishedBookReading = {
  key: string;
  revision: string;
  part?: number;
  target?: SiteBookPosition;
  relocated?: boolean;
};

export function PublishedBookReadingTools({ reading, chapter, chapters }: {
  reading: PublishedBookReading;
  chapter?: Chapter;
  chapters: readonly Chapter[];
}) {
  const t = useTranslations("Library");
  const { key, revision, part, target, relocated = false } = reading;
  const chapterId = chapter?.id;
  const targetBlock = target?.block;
  const targetOffset = target?.offset;
  const [stored, setStored] = useState(empty);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const refresh = () => setStored(bookProgress(key)?.value ?? empty);
    const frame = window.requestAnimationFrame(refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("storage", refresh);
    };
  }, [key]);

  useEffect(() => {
    const body = document.getElementById(PUBLISHED_BOOK_BODY_ID);
    if (!body || !chapterId || part === undefined) return;
    const anchor = siteBookPosition(targetBlock, targetOffset);
    let frame = 0;
    let pending: number | undefined;
    const save = () => {
      if (!body.isConnected || body.getBoundingClientRect().top >= window.innerHeight) return;
      const position = visiblePosition(body);
      if (position) bookProgress(key)?.save({ ...position, chapter: chapterId, revision });
    };
    const queueSave = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(save, 180);
    };
    if (anchor) frame = window.requestAnimationFrame(() => restorePosition(body, anchor, part, relocated));
    else if (part > 0) frame = window.requestAnimationFrame(() => {
      scrollToTarget(fragmentStart(body, part), { offset: -positionTop, immediate: true });
    });
    queueSave();
    window.addEventListener("scroll", queueSave, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(pending);
      window.removeEventListener("scroll", queueSave);
      window.removeEventListener("pagehide", save);
    };
  }, [key, chapterId, part, revision, relocated, targetBlock, targetOffset]);

  function changeBookmark(remove?: BookAnchor) {
    const progress = bookProgress(key);
    if (!progress) { setUnavailable(true); return; }
    if (!remove) {
      const body = document.getElementById(PUBLISHED_BOOK_BODY_ID);
      const position = body && visiblePosition(body);
      if (!position || !chapterId || part === undefined) return;
      progress.toggle({ ...position, chapter: chapterId, revision });
    } else {
      const index = progress.value.bookmarks.findIndex((mark) => mark.chapter === remove.chapter && mark.block === remove.block && mark.offset === remove.offset);
      if (index >= 0) progress.remove(index);
    }
    setStored(progress.value);
    setUnavailable(!progress.available);
  }

  function destination(anchor: BookAnchor | null) {
    if (!anchor) return null;
    const selected = chapters.find((item) => item.id === anchor.chapter);
    const position = siteBookPosition(anchor.block, anchor.offset);
    return selected && position ? { href: `${selected.href}?${siteBookPositionQuery(position)}`, title: selected.title } : null;
  }

  const resume = destination(stored.progress);
  const bookmarks = stored.bookmarks.flatMap((anchor) => {
    const mark = destination(anchor);
    return mark ? [{ ...mark, anchor }] : [];
  });
  return (
    <div className="mt-3">
      {!chapter && resume && <Link href={resume.href} scroll={false} prefetch={false} className={actionClass}>{t("resumeReading")}</Link>}
      <details className="group">
        <summary className={`${actionClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
          <Bookmark aria-hidden className="size-4" /> {t("bookmarks")}
        </summary>
        <div className="rounded-xl border border-line px-4 py-2">
          {chapter && <button type="button" className={actionClass} onClick={() => changeBookmark()}>{t("toggleBookmark")}</button>}
          <p className="py-1 text-xs leading-5 text-muted">{t("localBookmarks")}</p>
          {bookmarks.length ? <ul className="divide-y divide-line">
            {bookmarks.map((mark) => (
              <li key={mark.href} className="flex items-center justify-between gap-3">
                <Link href={mark.href} scroll={false} prefetch={false} className={actionClass}>{mark.title}</Link>
                <button type="button" className="grid size-11 shrink-0 place-items-center text-muted hover:text-accent" aria-label={t("removeBookmark", { title: mark.title })} onClick={() => changeBookmark(mark.anchor)}>
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul> : <p className="py-2 text-sm text-muted">{t("noBookmarks")}</p>}
          {unavailable && <p role="status" className="py-2 text-sm text-muted">{t("bookmarksUnavailable")}</p>}
        </div>
      </details>
      {relocated && <p role="status" className="text-sm text-muted">{t("positionMoved")}</p>}
    </div>
  );
}
