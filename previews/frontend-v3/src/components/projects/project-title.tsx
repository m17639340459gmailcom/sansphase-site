"use client";

import { useEffect, useRef } from "react";
import { rafThrottle, useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { SplitText } from "@/components/fx/split-text";
import { cn } from "@/lib/utils";
import styles from "./project-title.module.css";

/** Pointer influence radius, px. */
const RADIUS = 240;

/**
 * Case title: letters rise in one by one, then swell around the cursor by driving the display
 * font's variable axes (heavier and narrower, so the line barely reflows). One CSS variable per
 * glyph, written in rAF; fine pointers only, static under reduced motion.
 */
export function ProjectTitle({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const title = ref.current;
    const zone = title?.closest("header") ?? title;
    if (!title || !zone || !fine || reduced) return;
    let glyphs: { node: HTMLElement; x: number; y: number }[] = [];
    let pointer: [number, number] | null = null;

    const measure = () => {
      glyphs = [...title.querySelectorAll<HTMLElement>(".fx-u")].map((node) => {
        const box = node.getBoundingClientRect();
        return { node, x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
    };
    const paint = rafThrottle(() => {
      if (!pointer) return;
      const [x, y] = pointer;
      for (const glyph of glyphs) {
        const reach = Math.max(0, 1 - Math.hypot(x - glyph.x, (y - glyph.y) * 1.5) / RADIUS);
        glyph.node.style.setProperty("--fx-swell", (reach * reach * (3 - 2 * reach)).toFixed(3));
      }
    });
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (!pointer) measure();
      pointer = [event.clientX, event.clientY];
      paint();
    };
    const onLeave = () => {
      pointer = null;
      paint.cancel();
      for (const glyph of glyphs) glyph.node.style.setProperty("--fx-swell", "0");
    };
    // The title scrolls (and fades up) under a still pointer.
    const onScroll = () => {
      if (!pointer) return;
      measure();
      paint();
    };

    zone.addEventListener("pointermove", onMove, { passive: true });
    zone.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      onLeave();
      zone.removeEventListener("pointermove", onMove);
      zone.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
    };
  }, [fine, reduced]);

  return (
    <h1 ref={ref} className={cn(styles.title, className)}>
      <SplitText text={text} by="char" variant="mask" delay={delay} stagger={0.035} duration={1} />
    </h1>
  );
}
