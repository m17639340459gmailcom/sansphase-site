"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "motion/react";
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";

/**
 * Elements that lean toward the pointer. Descendants marked `data-magnetic-inner` (button labels
 * and arrows already are) travel `inner` times further for a layered parallax. Inert for coarse
 * pointers and reduced motion.
 */
export function Magnetic({
  children,
  strength = 0.35,
  inner = 0.35,
  className,
}: {
  children: ReactNode;
  strength?: number;
  /** Extra travel of `[data-magnetic-inner]` descendants, relative to the wrapper. */
  inner?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const enabled = fine && !reduced;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.6 });
  const innerX = useMotionTemplate`${sx}px`;
  const innerY = useMotionTemplate`${sy}px`;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== "mouse") return;
    // Measured once per hover: the element itself moves while we track it.
    const rect = (bounds.current ??= ref.current?.getBoundingClientRect() ?? null);
    if (!rect) return;
    x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
    y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
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
      style={
        {
          x: sx,
          y: sy,
          display: "inline-block",
          "--fx-mag-x": innerX,
          "--fx-mag-y": innerY,
          "--fx-mag-inner": inner,
        } as unknown as CSSProperties
      }
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </motion.div>
  );
}
