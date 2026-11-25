"use client";

import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useFxPlay, useFxState, type FxPlayOptions } from "./trigger";

export type DrawUnderlineProps = FxPlayOptions & {
  delay?: number;
  /** Seconds. */
  duration?: number;
  className?: string;
};

/**
 * Hand-drawn stroke that draws itself under a phrase. Place it inside a `relative inline-block`
 * wrapper; it stretches to the wrapper's width and inherits `currentColor`.
 */
export function DrawUnderline({ delay = 0, duration = 0.9, className, ...playOptions }: DrawUnderlineProps) {
  const ref = useRef<SVGSVGElement>(null);
  const active = useFxPlay(ref, playOptions);
  const state = useFxState(active);
  return (
    <svg
      ref={ref}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 300 14"
      preserveAspectRatio="none"
      className={cn("fx-draw", className)}
      data-fx-state={state}
      style={{ "--fx-delay": `${delay}s`, "--fx-dur": `${duration}s` } as CSSProperties}
    >
      <path d="M3 9.6C58 4.9 127 3.2 196 5.3S283 9.6 297 4.4" pathLength={1} />
    </svg>
  );
}
