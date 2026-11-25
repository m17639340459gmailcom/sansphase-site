"use client";

import { ArrowUp } from "lucide-react";
import { motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { useRef } from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { Magnetic } from "@/components/ui/magnetic";
import { cn } from "@/lib/utils";
import styles from "./footer.module.css";

/**
 * Back-to-top link whose ring traces the page's scroll progress and glows once the end is
 * reached. It leans toward the cursor; the arrow rolls up on hover and focus.
 */
export function BackToTop({ label, className }: { label: string; className?: string }) {
  const ring = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    ring.current?.toggleAttribute("data-complete", value > 0.995);
  });

  return (
    <Magnetic strength={0.4} inner={0.5} className={className}>
      <a
        href="#top"
        className={cn(
          styles.top,
          "font-mono text-xs uppercase tracking-[0.16em] text-muted transition-colors duration-300 hover:text-accent",
        )}
      >
        {label}
        <span ref={ring} className={styles.ring}>
          <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={styles.dial}>
            <circle cx="24" cy="24" r="23" className={styles.track} />
            <motion.circle
              cx="24"
              cy="24"
              r="23"
              className={styles.bar}
              style={{ pathLength: reduced ? scrollYProgress : smooth }}
            />
          </svg>
          <span aria-hidden="true" className={styles.arrows} data-magnetic-inner="">
            <ArrowUp className="h-4 w-4" />
            <ArrowUp className="h-4 w-4 text-accent" />
          </span>
        </span>
      </a>
    </Magnetic>
  );
}
