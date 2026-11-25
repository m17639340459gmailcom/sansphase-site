"use client";

import { ArrowDown } from "lucide-react";
import { motion, useMotionValueEvent, useTransform } from "motion/react";
import { useRef } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { ScrambleText } from "@/components/fx/scramble-text";
import { FxTrigger } from "@/components/fx/trigger";
import { cn } from "@/lib/utils";
import { useHeroScroll } from "./hero-motion";
import styles from "./hero.module.css";

/** Bottom-of-hero cue: a scrolling mouse wheel and a signal running down the rule; fades on scroll. */
export function HeroScrollCue({ hint }: { hint: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const progress = useHeroScroll();
  const reduced = usePrefersReducedMotion();
  const opacity = useTransform(progress, [0, 0.22], [1, 0]);

  // Idle loops stop once the cue has faded out.
  useMotionValueEvent(progress, "change", (value) => {
    ref.current?.toggleAttribute("data-paused", value > 0.25);
  });

  return (
    <motion.div
      ref={ref}
      aria-hidden="true"
      style={{ opacity: reduced ? 1 : opacity }}
      className={cn(styles.cueFrame, "pointer-events-none absolute inset-x-0 bottom-7 hidden lg:block")}
    >
      <FxTrigger
        trigger="mount"
        data-reveal=""
        className={cn(styles.cue, "container-x flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted")}
      >
        <span className={styles.mouse}>
          <span className={styles.wheel} />
        </span>
        <ScrambleText text={hint} delay={1.7} duration={1} />
        <span className={cn(styles.cueLine, "relative h-px flex-1 overflow-hidden bg-line")} />
        <ArrowDown className="h-3.5 w-3.5 text-accent" />
      </FxTrigger>
    </motion.div>
  );
}
