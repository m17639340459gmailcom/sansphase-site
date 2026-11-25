import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TextRollProps = {
  children: ReactNode;
  className?: string;
  /** Seconds between characters (string children only); capped so long labels stay snappy. */
  stagger?: number;
};

/**
 * Label that rolls up to a duplicate on hover/focus of itself or its nearest `.fx-roll-host`.
 * Plain strings roll per character (screen readers get one sr-only copy); other nodes roll whole.
 * CSS only, so it works in server components. The incoming copy uses `--fx-roll-to` as its color.
 */
export function TextRoll({ children, className, stagger = 0.014 }: TextRollProps) {
  if (typeof children === "string" || typeof children === "number") {
    const text = String(children);
    const chars = Array.from(text);
    const step = Math.min(stagger, 0.24 / Math.max(1, chars.length));
    const letters = chars.map((char, i) => (
      <span key={i} style={{ "--i": i } as CSSProperties}>
        {char}
      </span>
    ));
    return (
      <span
        className={cn("fx-roll", className)}
        data-magnetic-inner=""
        style={{ "--fx-roll-stagger": `${step}s` } as CSSProperties}
      >
        <span className="sr-only">{text}</span>
        <span aria-hidden="true" className="fx-roll-track" data-split="">
          <span className="fx-roll-a">{letters}</span>
          <span className="fx-roll-b">{letters}</span>
        </span>
      </span>
    );
  }
  return (
    <span className={cn("fx-roll", className)} data-magnetic-inner="">
      <span className="fx-roll-track">
        <span className="fx-roll-a">{children}</span>
        <span aria-hidden="true" className="fx-roll-b">
          {children}
        </span>
      </span>
    </span>
  );
}
