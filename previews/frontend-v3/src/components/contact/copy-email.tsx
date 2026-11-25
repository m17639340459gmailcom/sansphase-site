"use client";

import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { ScrambleText } from "@/components/fx/scramble-text";
import { cn } from "@/lib/utils";
import styles from "./contact.module.css";

/**
 * Email link plus a copy button: copying sweeps a highlight across the address, draws a check
 * and decodes the button label into the "copied" state. Screen readers hear a polite update.
 */
export function CopyEmail({
  email,
  label,
  copiedLabel,
  cursorLabel,
}: {
  email: string;
  label: string;
  copiedLabel: string;
  /** `data-cursor-text` for the copy button. */
  cursorLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const sweep = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
    } catch {
      return;
    }
    setCopied(true);
    if (!reduced) {
      sweep.current?.animate(
        [
          { backgroundPosition: "110% 0", opacity: 1 },
          { backgroundPosition: "-10% 0", opacity: 1, offset: 0.8 },
          { backgroundPosition: "-10% 0", opacity: 0 },
        ],
        { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={`mailto:${email}`}
        className="relative font-display text-2xl font-semibold tracking-tight text-fg transition-colors hover:text-accent sm:text-3xl"
      >
        <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[length:100%_1px]">
          {email}
        </span>
        <span ref={sweep} aria-hidden className={styles.sweep} />
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        data-cursor-text={cursorLabel}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
          copied ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:border-accent hover:text-accent",
        )}
      >
        {copied ? (
          <svg aria-hidden viewBox="0 0 24 24" className={cn(styles.check, "h-3.5 w-3.5")}>
            <path d="M5 12.5l4.2 4.2L19 7" pathLength={1} />
          </svg>
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" />
        )}
        <ScrambleText text={copied ? copiedLabel : label} duration={0.5} />
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </div>
  );
}
