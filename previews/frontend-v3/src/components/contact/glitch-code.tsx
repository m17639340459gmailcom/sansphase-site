"use client";

import { useEffect, useRef } from "react";
import { rafThrottle, useFinePointer, useInViewport, usePageVisible, usePrefersReducedMotion } from "@/components/fx/hooks";
import { cn } from "@/lib/utils";
import styles from "./contact.module.css";

/**
 * Giant status code with a chromatic split: accent and cool copies sit behind the ink layer,
 * lean with the pointer and tear into offset slices in periodic bursts. The real text is sr-only.
 */
export function GlitchCode({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const inView = useInViewport(ref, { once: false, amount: 0 });
  const track = fine && !reduced;

  useEffect(() => {
    const element = ref.current;
    if (!track || !element) return;
    const update = rafThrottle((x: number, y: number) => {
      element.style.setProperty("--gx", x.toFixed(3));
      element.style.setProperty("--gy", y.toFixed(3));
    });
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      update((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      update.cancel();
    };
  }, [track]);

  return (
    <span className={cn("block", className)}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden className={styles.glitch} data-paused={inView && visible ? undefined : ""}>
        <span className={styles.shift} data-layer="cool">
          <span className={styles.slices}>{text}</span>
        </span>
        <span className={styles.shift} data-layer="accent">
          <span className={styles.slices}>{text}</span>
        </span>
        <span className={styles.main}>{text}</span>
      </span>
    </span>
  );
}
