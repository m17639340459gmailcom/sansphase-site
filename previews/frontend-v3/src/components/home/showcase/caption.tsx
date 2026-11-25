"use client";

import { motion, useIsPresent } from "motion/react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { SplitText } from "@/components/fx/split-text";

const easeIn = [0.5, 0, 0.75, 0] as const;
const lift = { opacity: 0, y: -14, filter: "blur(4px)" };

/**
 * One project's title and tagline. Keyed per project inside `AnimatePresence`: the outgoing copy
 * lifts away (and leaves the accessibility tree) while the incoming one types up letter by letter.
 * Both share one grid cell, so the swap never shifts the layout.
 */
export function ShowcaseCaption({ title, tagline, play }: { title: string; tagline: string; play: boolean }) {
  const present = useIsPresent();
  // No exit under reduced motion: a fade would double-expose the old and new titles.
  const reduced = usePrefersReducedMotion();
  return (
    <motion.div
      className="[grid-area:1/1]"
      aria-hidden={present ? undefined : true}
      exit={reduced ? undefined : lift}
      transition={{ duration: 0.26, ease: easeIn }}
    >
      <SplitText
        as="h3"
        text={title}
        by="char"
        stagger={0.022}
        duration={0.8}
        play={play}
        className="font-display text-2xl font-semibold tracking-tight sm:text-3xl"
      />
      <SplitText
        as="p"
        text={tagline}
        variant="blur"
        stagger={0.012}
        delay={0.16}
        duration={0.7}
        play={play}
        className="mt-3 min-h-14 max-w-2xl text-sm leading-7 text-muted sm:min-h-0 sm:text-[15px]"
      />
    </motion.div>
  );
}
