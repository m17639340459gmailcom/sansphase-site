"use client";

import { useCallback, useEffect, useRef, type FocusEvent, type PointerEvent } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { useIntroDone } from "@/components/fx/intro-store";
import { cn } from "@/lib/utils";
import { NavPageLink } from "./nav-page-link";
import styles from "./nav-brand.module.css";

const WORD = Array.from("無相");
const NOISE = "01<>/_#+";
const DURATION = 420;

/** Decodes the cells left to right and flags the root so CSS runs the slices and glint. */
function glitch(root: HTMLElement, cells: HTMLElement[]) {
  root.removeAttribute("data-glitch");
  void root.offsetWidth; // restart the CSS animations on a repeat hover
  root.setAttribute("data-glitch", "");
  const start = performance.now();
  let frame = 0;
  let tick = 0;
  const finish = () => {
    cancelAnimationFrame(frame);
    cells.forEach((cell, i) => {
      cell.textContent = WORD[i];
    });
  };
  const render = (now: number) => {
    const progress = (now - start) / DURATION;
    const refresh = tick++ % 2 === 0;
    cells.forEach((cell, i) => {
      if (progress >= 0.3 + i * 0.25) cell.textContent = WORD[i];
      else if (refresh) cell.textContent = NOISE[Math.floor(Math.random() * NOISE.length)];
    });
    if (progress < 1) frame = requestAnimationFrame(render);
    else finish();
  };
  frame = requestAnimationFrame(render);
  return finish;
}

/** Accent gradient that glitches, decodes and glints on hover, focus and intro. */
export function NavBrand({ label, onNavigate, className }: { label: string; onNavigate?: () => void; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const cells = useRef<HTMLSpanElement[]>([]);
  const cancel = useRef<(() => void) | null>(null);
  const reduced = usePrefersReducedMotion();
  const introDone = useIntroDone();

  const run = useCallback(() => {
    if (reduced || !root.current) return;
    cancel.current?.();
    cancel.current = glitch(root.current, cells.current);
  }, [reduced]);

  // Powers on as the intro curtain opens (or right after hydration when the intro is skipped).
  useEffect(() => {
    if (introDone) run();
  }, [introDone, run]);

  useEffect(() => () => cancel.current?.(), []);

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === "mouse") run();
  };
  const onFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    if (event.currentTarget.matches(":focus-visible")) run();
  };

  return (
    <NavPageLink
      href="/"
      aria-label={label}
      onNavigate={onNavigate}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      className={cn("inline-flex h-12 shrink-0 items-center justify-center rounded-lg px-2 sm:h-[52px]", className)}
    >
      <span
        ref={root}
        aria-hidden="true"
        className={cn(styles.brand, "font-display text-2xl font-semibold tracking-tight sm:text-[28px]")}
      >
        <span className={styles.word}>
          {WORD.map((char, i) => (
            <span key={char} className={styles.cell}>
              <span className={styles.sizer}>{char}</span>
              <span
                ref={(node) => {
                  if (node) cells.current[i] = node;
                }}
                className={styles.char}
              >
                {char}
              </span>
            </span>
          ))}
        </span>
        <span className={styles.ghost} data-layer="a">
          {WORD.join("")}
        </span>
        <span className={styles.ghost} data-layer="b">
          {WORD.join("")}
        </span>
      </span>
    </NavPageLink>
  );
}
