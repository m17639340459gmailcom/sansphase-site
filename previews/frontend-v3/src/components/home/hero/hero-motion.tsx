"use client";

import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from "motion/react";
import { createContext, useContext, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useMediaQuery, usePrefersReducedMotion } from "@/components/fx/hooks";
import { useSpotlight } from "@/components/fx/spotlight";

const HeroScrollContext = createContext<MotionValue<number> | null>(null);

/**
 * The hero `<section>`: lights its `[data-fx-spot]` layers around the pointer and shares its exit
 * progress (0 at the top of the page, 1 once it has scrolled out) with the layers inside.
 */
export function HeroSection({ children, ...props }: ComponentPropsWithoutRef<"section">) {
  const ref = useRef<HTMLElement>(null);
  useSpotlight(ref);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  return (
    <HeroScrollContext.Provider value={scrollYProgress}>
      <section ref={ref} {...props}>
        {children}
      </section>
    </HeroScrollContext.Provider>
  );
}

export function useHeroScroll() {
  const progress = useContext(HeroScrollContext);
  const fallback = useMotionValue(0);
  return progress ?? fallback;
}

type Preset = { y: number[]; fade: number[]; opacity: number[]; scale: number[] };

const presets: Record<"copy" | "stage", Preset> = {
  copy: { y: [0, -120], fade: [0, 0.75], opacity: [1, 0], scale: [1, 1] },
  stage: { y: [0, 120], fade: [0.1, 1], opacity: [1, 0.25], scale: [1, 0.9] },
};

/**
 * Hero exit choreography: the copy lifts away and fades, the particle stage lags behind (depth)
 * and recedes. The stage only moves on wide screens, where it sits beside the copy.
 */
export function HeroScrollLayer({
  layer,
  className,
  children,
}: {
  layer: keyof typeof presets;
  className?: string;
  children: ReactNode;
}) {
  const progress = useHeroScroll();
  const reduced = usePrefersReducedMotion();
  const wide = useMediaQuery("(min-width: 1024px)");
  const preset = presets[layer];
  const y = useTransform(progress, [0, 1], preset.y);
  const opacity = useTransform(progress, preset.fade, preset.opacity);
  const scale = useTransform(progress, [0, 1], preset.scale);
  const enabled = !reduced && (layer === "copy" || wide);
  return (
    <motion.div className={className} style={enabled ? { y, opacity, scale } : { y: 0, opacity: 1, scale: 1 }}>
      {children}
    </motion.div>
  );
}
