"use client";

import { Fragment, useMemo, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { splitText, type SplitBy } from "./split";
import { useFxPlay, useFxState, type FxPlayOptions } from "./trigger";

export type SplitVariant = "rise" | "mask" | "blur";

export type SplitTextProps = FxPlayOptions & {
  text: string;
  as?: "span" | "div" | "p" | "h1" | "h2" | "h3" | "h4";
  by?: SplitBy;
  variant?: SplitVariant;
  /** Seconds before the first unit moves. */
  delay?: number;
  /** Seconds between units (default 0.05 per word, 0.022 per char). */
  stagger?: number;
  /** Seconds per unit. */
  duration?: number;
  className?: string;
  unitClassName?: string;
};

/**
 * Per-word (Latin) / per-glyph (CJK) entrance. Screen readers get the plain text;
 * the animated copy is aria-hidden. Driven entirely by CSS keyframes on `data-fx-state`.
 */
export function SplitText({
  text,
  as = "span",
  by = "auto",
  variant = "rise",
  delay = 0,
  stagger,
  duration = 0.9,
  className,
  unitClassName,
  ...playOptions
}: SplitTextProps) {
  // Typed as span: every allowed tag takes the same props here.
  const Tag = as as "span";
  const ref = useRef<HTMLSpanElement>(null);
  const active = useFxPlay(ref, playOptions);
  const state = useFxState(active);
  const segments = useMemo(() => splitText(text, by), [text, by]);
  const style = {
    "--fx-delay": `${delay}s`,
    "--fx-stagger": `${stagger ?? (by === "char" ? 0.022 : 0.05)}s`,
    "--fx-dur": `${duration}s`,
  } as CSSProperties;

  return (
    <Tag ref={ref} className={cn("fx-split", className)} data-fx-state={state} data-variant={variant} style={style}>
      <span className="sr-only select-none">{text}</span>
      <span aria-hidden="true">
        {segments.map((segment, i) =>
          segment.type === "space" ? (
            <Fragment key={i}>{" "}</Fragment>
          ) : (
            <span key={i} className="fx-w">
              {segment.units.map((unit) => (
                <span
                  key={unit.index}
                  className={cn("fx-u", unitClassName)}
                  style={{ "--i": unit.index } as CSSProperties}
                >
                  {unit.text}
                </span>
              ))}
            </span>
          ),
        )}
      </span>
    </Tag>
  );
}
