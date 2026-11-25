"use client";

import { motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { clamp } from "@/lib/utils";

const spring = { stiffness: 170, damping: 20, mass: 0.6 };

/**
 * Pointer-tracked card for layered 3D compositions. Writes springy `--px`/`--py` (-1…1, 0 at
 * rest) for CSS to derive rotation, parallax and light from, and sets `data-depth` once the
 * pointer can actually drive it (fine pointer, no reduced motion), so the 3D layers only exist
 * where they can move. Also a spotlight target and a scramble host for its descendants.
 */
export function DepthCard({
  children,
  className,
  cursorText,
}: {
  children: ReactNode;
  className?: string;
  /** Label for the site cursor while it is over the card. */
  cursorText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const enabled = fine && !reduced;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const px = useSpring(x, spring);
  const py = useSpring(y, spring);

  // Smooth scrolling moves the card under a still pointer; measure again on the next move.
  useEffect(() => {
    if (!enabled) return;
    const forget = () => {
      bounds.current = null;
    };
    window.addEventListener("scroll", forget, { passive: true });
    window.addEventListener("resize", forget);
    return () => {
      window.removeEventListener("scroll", forget);
      window.removeEventListener("resize", forget);
    };
  }, [enabled]);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== "mouse") return;
    const rect = (bounds.current ??= ref.current?.getBoundingClientRect() ?? null);
    if (!rect) return;
    x.set(clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1));
    y.set(clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1));
  };

  const onPointerLeave = () => {
    bounds.current = null;
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      className={className}
      data-fx-spot=""
      data-scramble-host=""
      data-depth={enabled ? "" : undefined}
      data-cursor-text={cursorText}
      style={{ "--px": px, "--py": py } as unknown as CSSProperties}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </motion.div>
  );
}
