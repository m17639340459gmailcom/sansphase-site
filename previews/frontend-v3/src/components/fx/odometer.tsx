"use client";

import { useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useFxPlay, useFxState, type FxPlayOptions } from "./trigger";

const DIGITS = Array.from({ length: 20 }, (_, i) => i % 10);

export type OdometerProps = FxPlayOptions & {
  /** Any string; digits roll, everything else (".", "+", "%", "k") stays put. */
  value: string;
  /** Seconds per column. */
  duration?: number;
  delay?: number;
  className?: string;
};

/** Mechanical counter: each digit spins a full turn into place when played. */
export function Odometer({ value, duration = 1.6, delay = 0, className, ...playOptions }: OdometerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const active = useFxPlay(ref, playOptions);
  const state = useFxState(active);
  const chars: { char: string; digit?: number; column?: number }[] = [];
  let column = 0;
  for (const char of value) {
    chars.push(/\d/.test(char) ? { char, digit: Number(char), column: column++ } : { char });
  }

  return (
    <span
      ref={ref}
      className={cn("fx-odo", className)}
      data-fx-state={state}
      style={{ "--fx-dur": `${duration}s`, "--fx-delay": `${delay}s` } as CSSProperties}
    >
      <span className="sr-only select-none">{value}</span>
      <span aria-hidden="true" className="fx-odo-vis">
        {chars.map((item, i) =>
          item.digit !== undefined ? (
            <span
              key={i}
              className="fx-odo-d"
              style={{ "--n": 10 + item.digit, "--i": item.column } as CSSProperties}
            >
              <span className="invisible">{item.char}</span>
              <span className="fx-odo-col">
                {DIGITS.map((digit, j) => (
                  <span key={j}>{digit}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={i}>{item.char}</span>
          ),
        )}
      </span>
    </span>
  );
}
