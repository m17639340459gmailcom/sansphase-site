"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./hooks";

export type ScrollFadeProps = {
  children?: ReactNode;
  className?: string;
  /** px the content lifts by the time its bottom edge leaves the top of the viewport. */
  distance?: number;
  /** Final opacity. */
  to?: number;
};

/** Content drifts up and fades as it scrolls out of the top of the viewport (hero/header exits). */
export function ScrollFade({ children, className, distance = 72, to = 0 }: ScrollFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const opacity = useTransform(scrollYProgress, [0, 1], [1, to]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -distance]);
  return (
    <motion.div ref={ref} className={className} style={reduced ? undefined : { opacity, y }}>
      {children}
    </motion.div>
  );
}
