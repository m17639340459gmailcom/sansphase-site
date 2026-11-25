"use client";

import { motion, useMotionValue, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./hooks";

export type ParallaxProps = {
  children?: ReactNode;
  className?: string;
  /**
   * Fraction of scroll distance the element drifts: 0.2 = lags 20% behind (feels deeper),
   * negative = moves faster than the page.
   */
  speed?: number;
  /**
   * "center": at its layout position when centred in the viewport (mid-page content).
   * "top": at its layout position at scrollY 0 (above-the-fold content).
   */
  rest?: "center" | "top";
};

/** Scroll-linked translateY. A plain wrapper under reduced motion. */
export function Parallax({ children, className, speed = 0.2, rest = "center" }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollY } = useScroll();
  const origin = useMotionValue(0);
  const y = useTransform(() => (scrollY.get() - origin.get()) * speed);

  useEffect(() => {
    const element = ref.current;
    if (!element || reduced || rest === "top") return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const layoutTop = rect.top + window.scrollY - y.get();
      origin.set(layoutTop + rect.height / 2 - window.innerHeight / 2);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [origin, reduced, rest, y]);

  return (
    <motion.div ref={ref} className={className} style={reduced ? undefined : { y }}>
      {children}
    </motion.div>
  );
}
