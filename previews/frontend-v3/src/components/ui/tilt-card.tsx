"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "motion/react";
import { useRef, type PointerEvent, type ReactNode } from "react";
import { useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { cn } from "@/lib/utils";

/**
 * 3D perspective tilt with a pointer-following glare. Children can pop out with
 * `[transform:translateZ(40px)]` (the card preserves 3D). CSS transforms only; flat and
 * static for coarse pointers and reduced motion.
 */
export function TiltCard({
  children,
  className,
  max = 9,
  glare = true,
}: {
  children: ReactNode;
  className?: string;
  /** Maximum tilt in degrees. */
  max?: number;
  /** Specular highlight that follows the pointer. */
  glare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const enabled = fine && !reduced;
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);
  const srx = useSpring(rx, { stiffness: 260, damping: 24 });
  const sry = useSpring(ry, { stiffness: 260, damping: 24 });
  const light = useMotionTemplate`radial-gradient(520px circle at ${gx}% ${gy}%, var(--fx-glare), transparent 45%), radial-gradient(420px circle at ${gx}% ${gy}%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 60%)`;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== "mouse") return;
    const rect = (bounds.current ??= ref.current?.getBoundingClientRect() ?? null);
    if (!rect) return;
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    ry.set((px - 0.5) * max * 2);
    rx.set(-(py - 0.5) * max * 2);
    gx.set(px * 100);
    gy.set(py * 100);
  };

  const onPointerLeave = () => {
    bounds.current = null;
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.div
      ref={ref}
      className={cn("group/tilt relative [transform-style:preserve-3d] will-change-transform", className)}
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 1100 }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
      {glare && enabled && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] opacity-0 transition-opacity duration-500 group-hover/tilt:opacity-100"
          style={{ background: light }}
        />
      )}
    </motion.div>
  );
}
