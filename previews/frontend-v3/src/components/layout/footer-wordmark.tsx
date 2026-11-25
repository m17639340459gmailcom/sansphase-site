"use client";

import { useEffect, useRef } from "react";
import { SplitText } from "@/components/fx/split-text";
import { FxTrigger } from "@/components/fx/trigger";
import { cn } from "@/lib/utils";
import styles from "./footer.module.css";

const PROBE_SIZE = 100;

/**
 * Full-bleed outlined name that closes every page. Letters rise in on reveal and a band of accent
 * light sweeps through once; on fine pointers the accent gradient pools around the cursor
 * (`--mx`/`--my` come from the footer's SpotlightGroup). Sized so the name spans the viewport.
 */
export function FooterWordmark({ text }: { text: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = frame.current;
    const sample = probe.current;
    if (!element || !sample) return;
    let alive = true;
    const fit = () => {
      if (!alive) return;
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const natural = sample.getBoundingClientRect().width;
      if (width > 0 && natural > 0) element.style.setProperty("--wm-size", `${(width / natural) * PROBE_SIZE}px`);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    document.fonts?.ready.then(fit);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={frame} aria-hidden="true" className={cn(styles.wordmark, "fx-watermark font-display")}>
      <span ref={probe} className={styles.probe}>
        {text}
      </span>
      <FxTrigger amount={0.35} className={styles.fit}>
        <SplitText text={text} by="char" stagger={0.045} duration={1.1} className={styles.outline} />
        <span data-fx-spot="" className={styles.lit}>
          {text}
        </span>
        <span className={styles.sweep}>{text}</span>
      </FxTrigger>
    </div>
  );
}
