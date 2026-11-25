"use client";

import { ArrowUp, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rafThrottle } from "@/components/fx/hooks";
import { scrollToTarget } from "@/components/fx/lenis";
import { cn } from "@/lib/utils";

export type TocItem = { id: string; text: string; depth: 2 | 3 };

/** Element whose scroll span counts as "the article" for the reading progress. */
const READING_ROOT = "[data-reading-root]";

/** "01", "02"… for top-level sections, null for subsections. */
function sectionNumbers(items: TocItem[]) {
  let section = 0;
  return items.map((item) => (item.depth === 2 ? String(++section).padStart(2, "0") : null));
}

function atPageBottom() {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
}

/**
 * The heading currently being read: the last one whose top crossed 30% of the viewport. An
 * IntersectionObserver re-picks as headings cross that line; jumps (anchors, End key) can skip
 * over it, so the pick also runs once scrolling settles. At the very bottom of the page the last
 * heading wins, since short final sections never reach the line.
 */
function useActiveHeading(items: TocItem[]) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => heading !== null);
    if (headings.length === 0) return;
    let settle = 0;

    const pick = () => {
      if (atPageBottom()) {
        setActiveId(headings[headings.length - 1].id);
        return;
      }
      const line = window.innerHeight * 0.3;
      let current: string | null = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > line) break;
        current = heading.id;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(pick, 120);
    };

    const observer = new IntersectionObserver(pick, { rootMargin: "-30% 0px -69% 0px" });
    headings.forEach((heading) => observer.observe(heading));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  return activeId;
}

/** Sweeps an underline across the heading once the scroll to it has (roughly) landed. */
function flashHeading(id: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const heading = document.getElementById(id);
  const target = heading?.querySelector("a") ?? heading;
  target?.animate(
    [
      { backgroundSize: "0% 1px" },
      { backgroundSize: "100% 1px", color: "var(--accent)", offset: 0.35 },
      { backgroundSize: "100% 1px", color: "var(--accent)", offset: 0.7 },
      { backgroundSize: "0% 1px" },
    ],
    { duration: 1700, delay: 380, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}

/**
 * Desktop "on this page" rail: a reading-progress ring with a live percentage, section numbers,
 * and an accent marker that slides to the active heading while a fill tracks the sections read.
 * Scroll work is rAF-throttled and writes CSS variables / text directly (no React state per frame).
 */
export function TableOfContents({ items, label }: { items: TocItem[]; label: string }) {
  const t = useTranslations("FX.blog");
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  const activeId = useActiveHeading(items);
  const activeIndex = items.findIndex((item) => item.id === activeId);

  useEffect(() => {
    const nav = root.current;
    const article = document.querySelector<HTMLElement>(READING_ROOT);
    if (!nav || !article) return;
    const update = rafThrottle(() => {
      const rect = article.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const progress = span <= 0 ? (rect.top <= 0 ? 1 : 0) : Math.min(1, Math.max(0, -rect.top / span));
      nav.style.setProperty("--pfx-read", progress.toFixed(4));
      nav.toggleAttribute("data-done", progress > 0.995);
      if (percent.current) percent.current.textContent = String(Math.round(progress * 100));
    });
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      update.cancel();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useLayoutEffect(() => {
    const rail = list.current;
    if (!rail) return;
    const place = () => {
      const link = activeId ? rail.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(activeId)}"]`) : null;
      rail.style.setProperty("--pfx-mark-o", link ? "1" : "0");
      if (!link) return;
      rail.style.setProperty("--pfx-mark-y", `${link.offsetTop}px`);
      rail.style.setProperty("--pfx-mark-h", `${link.offsetHeight}px`);
    };
    place();
    // Slide only once the first position is painted.
    const frame = requestAnimationFrame(() => rail.setAttribute("data-ready", ""));
    const observer = new ResizeObserver(place);
    observer.observe(rail);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [activeId]);

  if (items.length === 0) return null;
  const numbers = sectionNumbers(items);

  return (
    <nav ref={root} aria-label={label} className="pfx-toc flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center">
          <svg aria-hidden="true" viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
            <circle cx="18" cy="18" r="15" className="pfx-ring-track" />
            <circle cx="18" cy="18" r="15" className="pfx-ring-bar" />
          </svg>
          <span aria-hidden="true" className="font-mono text-[10px] tabular-nums text-fg">
            <span ref={percent}>0</span>%
          </span>
        </span>
        <div className="min-w-0">
          <p className="eyebrow">{label}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">
            {t("readingProgress")} · {t("sections", { count: items.length })}
          </p>
        </div>
      </div>

      <div ref={list} className="pfx-toc-list relative">
        <span aria-hidden="true" className="pfx-toc-rail" />
        <span aria-hidden="true" className="pfx-toc-fill" />
        <span aria-hidden="true" className="pfx-toc-mark" />
        <ul className="flex flex-col">
          {items.map((item, index) => {
            const state = activeIndex < 0 || index > activeIndex ? "next" : index === activeIndex ? "active" : "past";
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  data-toc-id={item.id}
                  data-state={state}
                  aria-current={state === "active" ? "location" : undefined}
                  onClick={() => flashHeading(item.id)}
                  className={cn(
                    "pfx-toc-link flex gap-3 py-1.5 pr-2 text-[13px] leading-snug",
                    item.depth === 3 ? "pl-9" : "pl-4",
                  )}
                >
                  {numbers[index] && (
                    <span aria-hidden="true" className="pfx-toc-num">
                      {numbers[index]}
                    </span>
                  )}
                  <span>{item.text}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => scrollToTarget(0)}
        className="group/top inline-flex min-h-11 items-center gap-2 self-start font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-accent"
      >
        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-line transition-colors group-hover/top:border-accent">
          <ArrowUp aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/top:-translate-y-0.5" />
        </span>
        {t("backToTop")}
      </button>
    </nav>
  );
}

/** Collapsible table of contents for narrow screens; closes itself after a jump. */
export function TocDisclosure({ items, label, className }: { items: TocItem[]; label: string; className?: string }) {
  const t = useTranslations("FX.blog");
  const details = useRef<HTMLDetailsElement>(null);
  const activeId = useActiveHeading(items);
  if (items.length === 0) return null;
  const numbers = sectionNumbers(items);

  return (
    <details ref={details} className={cn("pfx-disclosure group/tocm rounded-xl border border-line bg-bg-elevated", className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
        {label}
        <span className="font-mono text-[11px] font-normal text-muted">{t("sections", { count: items.length })}</span>
        <ChevronDown
          aria-hidden="true"
          className="ml-auto h-4 w-4 text-muted transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-open/tocm:rotate-180"
        />
      </summary>
      <nav aria-label={label} className="border-t border-line px-3 py-2">
        <ul>
          {items.map((item, index) => {
            const active = item.id === activeId;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={active ? "location" : undefined}
                  onClick={() => {
                    if (details.current) details.current.open = false;
                    flashHeading(item.id);
                  }}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm transition-colors",
                    item.depth === 3 && "pl-9",
                    active ? "bg-accent-soft text-accent" : "text-muted hover:text-accent",
                  )}
                >
                  {numbers[index] && (
                    <span aria-hidden="true" className="font-mono text-[10px] tabular-nums opacity-70">
                      {numbers[index]}
                    </span>
                  )}
                  {item.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </details>
  );
}
