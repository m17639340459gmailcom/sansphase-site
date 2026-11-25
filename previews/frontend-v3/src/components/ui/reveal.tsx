"use client";

import { motion, useInView, type Variants } from "motion/react";
import { useRef, type ReactNode } from "react";
import { useIntroDone } from "@/components/fx/intro-store";

export type RevealVariant = "fade-up" | "clip" | "scale";

const ease = [0.16, 1, 0.3, 1] as const;

const variantMap: Record<RevealVariant, Variants> = {
  "fade-up": {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0 },
  },
  clip: {
    hidden: { opacity: 0, y: 14, clipPath: "inset(0% 0% 100% 0%)" },
    // Drop the clip afterwards so shadows and focus rings are not cut off.
    visible: { opacity: 1, y: 0, clipPath: "inset(0% 0% 0% 0%)", transitionEnd: { clipPath: "none" } },
  },
  scale: {
    hidden: { opacity: 0, y: 10, scale: 0.96 },
    visible: { opacity: 1, y: 0, scale: 1 },
  },
};

const durations: Record<RevealVariant, number> = { "fade-up": 0.5, clip: 0.9, scale: 0.6 };

/**
 * Scroll-triggered entrance. Fires once when ~20% of the element is visible, and never
 * before the intro curtain opens.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
  once = true,
  variant = "fade-up",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "span" | "li" | "section" | "article";
  once?: boolean;
  variant?: RevealVariant;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const introDone = useIntroDone();
  const inView = useInView(ref, { once, amount: 0.2, margin: "0px 0px -40px 0px" });
  // The tags share every prop used here; typing them as div keeps the ref simple.
  const Component = motion[as] as typeof motion.div;
  return (
    <Component
      ref={ref}
      data-reveal
      className={className}
      variants={variantMap[variant]}
      initial="hidden"
      animate={introDone && inView ? "visible" : "hidden"}
      transition={{ duration: durations[variant], delay, ease }}
    >
      {children}
    </Component>
  );
}

/** Stagger children that are themselves `Reveal`-like motion elements. */
export function Stagger({
  children,
  className,
  stagger = 0.08,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const introDone = useIntroDone();
  const inView = useInView(ref, { once: true, amount: 0.15 });
  return (
    <motion.div
      ref={ref}
      data-reveal
      className={className}
      initial="hidden"
      animate={introDone && inView ? "visible" : "hidden"}
      transition={{ staggerChildren: stagger }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  variant = "fade-up",
}: {
  children: ReactNode;
  className?: string;
  variant?: RevealVariant;
}) {
  return (
    <motion.div
      data-reveal
      className={className}
      variants={variantMap[variant]}
      transition={{ duration: durations[variant], ease }}
    >
      {children}
    </motion.div>
  );
}
