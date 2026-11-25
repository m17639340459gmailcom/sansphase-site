"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { rafThrottle, useFinePointer, useInViewport, usePageVisible, usePrefersReducedMotion } from "./hooks";

export type AuroraProps = {
  className?: string;
  /** Opacity multiplier for the blobs (1 = default, 0.5 = quieter). */
  intensity?: number;
  /** Drift gently toward the cursor (fine pointers only). */
  interactive?: boolean;
};

/**
 * Slow-drifting accent/amber light (with a hint of cool) behind content. Absolutely fills its
 * positioned parent; put it on a negative z-index. Soft radial gradients, transform-only animation.
 */
export function Aurora({ className, intensity = 1, interactive = true }: AuroraProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInViewport(ref, { once: false, amount: 0 });
  const visible = usePageVisible();
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const track = interactive && fine && !reduced && inView;

  useEffect(() => {
    const element = ref.current;
    if (!track || !element) return;
    const update = rafThrottle((x: number, y: number) => {
      element.style.setProperty("--fx-px", x.toFixed(3));
      element.style.setProperty("--fx-py", y.toFixed(3));
    });
    const onMove = (event: PointerEvent) =>
      update((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      update.cancel();
    };
  }, [track]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("fx-aurora", className)}
      data-paused={inView && visible ? undefined : ""}
      style={{ "--fx-aurora-o": intensity } as CSSProperties}
    >
      <div className="fx-aurora-field">
        <span className="fx-aurora-blob fx-aurora-a" />
        <span className="fx-aurora-blob fx-aurora-b" />
        <span className="fx-aurora-blob fx-aurora-c" />
      </div>
    </div>
  );
}
