"use client";

import { useMotionValueEvent, useScroll } from "motion/react";
import { Fragment, useMemo, useRef, type CSSProperties } from "react";
import { useHydrated, usePrefersReducedMotion } from "@/components/fx/hooks";
import { splitText } from "@/components/fx/split";
import { cn } from "@/lib/utils";
import styles from "./scroll-highlight.module.css";

/**
 * Lead paragraph that lights up word by word (glyph by glyph in Chinese) as it crosses the reading
 * zone. Scroll writes a single `--p` variable; the real text lives in an sr-only copy. Fully lit
 * without JS and under reduced motion.
 */
export function ScrollHighlight({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const segments = useMemo(() => splitText(text), [text]);
  const count = segments.reduce((sum, segment) => sum + (segment.type === "word" ? segment.units.length : 0), 0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.9", "end 0.55"] });

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    ref.current?.style.setProperty("--p", value.toFixed(4));
  });

  return (
    <p
      ref={ref}
      className={cn(styles.scrub, className)}
      data-live={hydrated && !reduced ? "" : undefined}
      style={{ "--n": count } as CSSProperties}
    >
      <span className="sr-only select-none">{text}</span>
      <span aria-hidden="true">
        {segments.map((segment, i) =>
          segment.type === "space" ? (
            <Fragment key={i}> </Fragment>
          ) : (
            <span key={i}>
              {segment.units.map((unit) => (
                <span key={unit.index} className={styles.unit} style={{ "--i": unit.index } as CSSProperties}>
                  {unit.text}
                </span>
              ))}
            </span>
          ),
        )}
      </span>
    </p>
  );
}
