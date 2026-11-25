"use client";

import { useEffect, useRef } from "react";
import { rafThrottle, useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import styles from "./hero.module.css";

const CELL = 64;
const TRAIL = 10;
// Controls and the particle stage give their own feedback; the grid stays quiet over them.
const QUIET = "a, button, [role='button'], [data-particle-surface]";

/**
 * Pointer layer for the hero grid (aligned with `grid-bg`'s 64px cells): recently crossed cells
 * light up and fade out behind the cursor. The targeting frame itself is the global cursor.
 * Renders nothing for touch input or reduced motion.
 */
export function HeroGridTrail() {
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  if (!fine || reduced) return null;
  return <TrailLayer />;
}

function TrailLayer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    const cells = Array.from(layer.querySelectorAll<HTMLElement>("[data-cell]"));
    let origin: DOMRect | null = null;
    let last: [number, number, boolean] | null = null;
    let current = "";
    let next = 0;

    const paint = rafThrottle((x: number, y: number, quiet: boolean) => {
      if (quiet) {
        current = "";
        return;
      }
      origin ??= layer.getBoundingClientRect();
      const col = Math.floor((x - origin.left) / CELL);
      const row = Math.floor((y - origin.top) / CELL);
      const key = `${col}:${row}`;
      if (key === current) return;
      current = key;
      const position = `${col * CELL}px ${row * CELL}px`;
      const cell = cells[next];
      next = (next + 1) % cells.length;
      cell.style.translate = position;
      cell.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: "linear" });
    });

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const quiet = event.target instanceof Element && event.target.closest(QUIET) !== null;
      last = [event.clientX, event.clientY, quiet];
      paint(...last);
    };
    const onLeave = () => {
      paint.cancel();
      last = null;
      current = "";
    };
    // The grid moves under a still pointer while scrolling.
    const onScroll = () => {
      origin = null;
      if (last) paint(...last);
    };
    const onResize = () => {
      origin = null;
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      paint.cancel();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className={styles.trail}>
      {Array.from({ length: TRAIL }, (_, i) => (
        <span key={i} data-cell="" className={styles.trailCell} />
      ))}
    </div>
  );
}
