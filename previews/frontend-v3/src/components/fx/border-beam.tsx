"use client";

import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useInViewport, usePageVisible } from "./hooks";

export type BorderBeamProps = {
  /** Seconds per lap. */
  duration?: number;
  /** Arc length of the beam in degrees. */
  size?: number;
  /** Phase offset in seconds, to desynchronise several beams. */
  delay?: number;
  /** Ring thickness in px. */
  width?: number;
  className?: string;
};

/**
 * A light beam that travels around the parent's rounded border. The parent must be
 * positioned (`relative`) and rounded; the beam inherits its radius and sits on a 1px border.
 * Pure CSS (`@property --fx-angle`); paused off-screen, hidden under reduced motion.
 */
export function BorderBeam({ duration = 6, size = 70, delay = 0, width = 1.5, className }: BorderBeamProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInViewport(ref, { once: false, amount: 0 });
  const visible = usePageVisible();
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn("fx-beam", className)}
      data-paused={inView && visible ? undefined : ""}
      style={
        {
          "--fx-beam-dur": `${duration}s`,
          "--fx-beam-size": `${size}deg`,
          "--fx-beam-delay": `${-delay}s`,
          "--fx-beam-w": `${width}px`,
        } as CSSProperties
      }
    />
  );
}
