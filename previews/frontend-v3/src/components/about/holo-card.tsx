"use client";

import { motion, useMotionValue, useSpring } from "motion/react";
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { cn } from "@/lib/utils";
import styles from "./about.module.css";

const tiltSpring = { stiffness: 190, damping: 20, mass: 0.6 };
const lightSpring = { stiffness: 150, damping: 24 };

/**
 * Holographic tilt: the card leans toward the pointer while a foil band and a glare slide
 * across it (`--hx`/`--hy`), and `hud` floats above the surface in 3D. Flat for touch and
 * reduced motion.
 */
export function HoloCard({
  children,
  hud,
  className,
  max = 10,
}: {
  children: ReactNode;
  hud?: ReactNode;
  className?: string;
  /** Maximum tilt in degrees. */
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const enabled = fine && !reduced;
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(rx, tiltSpring);
  const rotateY = useSpring(ry, tiltSpring);
  const hx = useSpring(px, lightSpring);
  const hy = useSpring(py, lightSpring);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== "mouse") return;
    const element = ref.current;
    // The root never rotates, so one measurement per hover stays exact.
    const rect = (bounds.current ??= element?.getBoundingClientRect() ?? null);
    if (!element || !rect) return;
    element.dataset.active = "";
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    px.set(x);
    py.set(y);
    ry.set((x - 0.5) * max * 2);
    rx.set(-(y - 0.5) * max * 2);
  };

  const onPointerLeave = () => {
    bounds.current = null;
    if (ref.current) delete ref.current.dataset.active;
    rx.set(0);
    ry.set(0);
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <div ref={ref} className={cn(styles.holoRoot, className)} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <motion.div
        className={styles.tilt}
        style={enabled ? ({ rotateX, rotateY, "--hx": hx, "--hy": hy } as unknown as CSSProperties) : undefined}
      >
        {children}
        {hud}
      </motion.div>
    </div>
  );
}
