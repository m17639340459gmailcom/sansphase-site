"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { PUBLISHED_BOOK_BODY_ID, type SiteBookPosition } from "@/lib/site-book-position";
import { createSectionPositionTracker } from "@/shared/site/section-reading-position.mjs";

export type BookDirectorySection = SiteBookPosition & { title: string; level: number; href: string; part?: number };

export function BookDirectoryPane({ chapterId, headings, children }: {
  chapterId?: string;
  headings?: readonly BookDirectorySection[];
  children: ReactNode;
}) {
  const pane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = document.getElementById(PUBLISHED_BOOK_BODY_ID);
    const sidebar = pane.current;
    if (!content || !sidebar || !chapterId) return;

    const chapter = { id: chapterId, headings };
    const tracker = createSectionPositionTracker({
      content,
      sidebar,
      headingSelector: "h2, h3, h4",
      getChapter: () => chapter,
      getFirstPart: () => 0,
    });
    tracker.refresh();
    return tracker.destroy;
  }, [chapterId, headings]);

  return <div ref={pane} className="min-h-0 lg:overflow-y-auto" data-book-directory data-lenis-prevent>{children}</div>;
}
