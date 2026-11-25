"use client";

import { useEffect, useRef } from "react";
import { DrawUnderline } from "@/components/fx/draw-underline";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { SplitText } from "@/components/fx/split-text";
import { HERO_MORPH_EVENT } from "./events";
import styles from "./hero.module.css";

/**
 * The serif accent line stays visible. Decorative glints sweep through it on entrance,
 * hover, and particle morphs.
 */
export function HeroAccent({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const root = ref.current;
    if (reduced || !root) return;
    let running: Animation[] = [];
    const glint = (lead: number) => {
      if (document.hidden || running.some((animation) => animation.playState === "running")) return;
      if (!root.querySelector(".fx-split[data-fx-state='play']")) return;
      running = Array.from(root.querySelectorAll<HTMLElement>(".fx-u"), (unit, i) =>
        unit.animate([{ backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0" }], {
          duration: 1300,
          delay: lead + i * 40,
          easing: "cubic-bezier(0.76, 0, 0.24, 1)",
        }),
      );
    };
    const onMorph = () => glint(250);
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") glint(0);
    };
    document.addEventListener(HERO_MORPH_EVENT, onMorph);
    root.addEventListener("pointerenter", onEnter);
    return () => {
      document.removeEventListener(HERO_MORPH_EVENT, onMorph);
      root.removeEventListener("pointerenter", onEnter);
      running.forEach((animation) => animation.cancel());
    };
  }, [reduced]);

  return (
    <span ref={ref} className={`relative inline-block ${styles.readableAccent}`}>
      <SplitText text={text} by="char" stagger={0.034} unitClassName={styles.shine} />
      <DrawUnderline />
    </span>
  );
}
