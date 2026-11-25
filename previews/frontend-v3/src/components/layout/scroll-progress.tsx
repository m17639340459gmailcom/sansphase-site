"use client";

import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";

/**
 * Reading progress: an accent-to-amber hairline with a glowing head riding its tip.
 * Named for view transitions so route changes never cover it.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const reduced = usePrefersReducedMotion();
  const smooth = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  const progress = reduced ? scrollYProgress : smooth;
  const opacity = useTransform(progress, [0, 0.004], [0, 1]);
  // The head's track is shifted left by the unscrolled share, so its right edge sits on the tip.
  const headX = useTransform(progress, (value) => `${(value - 1) * 100}%`);

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[2px]"
      style={{ opacity, viewTransitionName: "scroll-progress" }}
    >
      <motion.div
        className="absolute inset-0 origin-left bg-linear-to-r from-accent via-accent to-amber"
        style={{ scaleX: progress }}
      />
      <motion.div className="absolute inset-0" style={{ x: headX }}>
        <span className="absolute -top-px right-0 h-1 w-24 rounded-full bg-linear-to-r from-transparent to-amber opacity-80 blur-[3px]" />
        <span className="absolute -right-0.5 -top-[3px] h-2 w-2 rounded-full bg-amber shadow-[0_0_10px_2px_var(--accent-glow),0_0_18px_4px_var(--accent-glow)]" />
      </motion.div>
    </motion.div>
  );
}
