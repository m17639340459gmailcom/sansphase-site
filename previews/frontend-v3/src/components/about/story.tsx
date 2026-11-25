"use client";

import { motion, useScroll } from "motion/react";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useHydrated, usePrefersReducedMotion } from "@/components/fx/hooks";
import { ScrambleText } from "@/components/fx/scramble-text";
import { countUnits, splitText } from "@/components/fx/split";
import { FxTrigger } from "@/components/fx/trigger";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";
import styles from "./about.module.css";

const pad = (n: number) => String(n).padStart(2, "0");

/** Lead paragraph whose words light up as it is read through (scroll-linked, one CSS var). */
function ScrollLit({ text, index }: { text: string; index: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const hydrated = useHydrated();
  const reduced = usePrefersReducedMotion();
  const on = hydrated && !reduced;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.55"] });
  const segments = useMemo(() => splitText(text), [text]);

  return (
    <motion.p
      ref={ref}
      data-paragraph={index}
      data-on={on ? "" : undefined}
      className={cn(styles.lead, "text-lg leading-[1.85] text-fg sm:text-xl")}
      style={on ? ({ "--p": scrollYProgress, "--n": countUnits(text) } as unknown as CSSProperties) : undefined}
    >
      {segments.map((segment, i) =>
        segment.type === "space" ? (
          " "
        ) : (
          <span key={i}>
            {segment.units.map((unit) => (
              <span key={unit.index} className={styles.unit} style={{ "--i": unit.index } as CSSProperties}>
                {unit.text}
              </span>
            ))}
          </span>
        ),
      )}
    </motion.p>
  );
}

/**
 * Background story: a sticky index rail tracks the paragraph being read while the lead
 * paragraph lights up word by word.
 */
export function Story({ eyebrow, paragraphs }: { eyebrow: string; paragraphs: string[] }) {
  const section = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: section, offset: ["start 0.7", "end 0.6"] });
  const [lead, ...rest] = paragraphs;

  useEffect(() => {
    const root = section.current;
    const target = counter.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) target.style.setProperty("--idx", entry.target.getAttribute("data-paragraph"));
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    root.querySelectorAll("[data-paragraph]").forEach((paragraph) => observer.observe(paragraph));
    return () => observer.disconnect();
  }, []);

  return (
    <section className="container-x pb-16 lg:pb-24">
      <div ref={section} className="grid gap-6 border-t border-line pt-10 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-3">
          <FxTrigger className="flex flex-col gap-6 lg:sticky lg:top-28">
            <p className="eyebrow flex items-center gap-3">
              <span className="fx-line inline-block h-px w-6 bg-accent" />
              <ScrambleText text={eyebrow} />
            </p>
            <div aria-hidden className="hidden items-start gap-4 lg:flex">
              <span className="relative h-32 w-px overflow-hidden bg-line">
                <motion.span
                  className="absolute inset-0 origin-top bg-accent"
                  style={reduced ? undefined : { scaleY: scrollYProgress }}
                />
              </span>
              <span className="flex font-mono text-xs tabular-nums leading-[1.25em] text-muted">
                <span className="inline-block h-[1.25em] overflow-hidden text-fg">
                  <span ref={counter} className={styles.digits}>
                    {paragraphs.map((_, i) => (
                      <span key={i} className="block">{pad(i + 1)}</span>
                    ))}
                  </span>
                </span>
                <span className="px-1.5">/</span>
                {pad(paragraphs.length)}
              </span>
            </div>
          </FxTrigger>
        </div>
        <div className="flex max-w-[46rem] flex-col gap-5 lg:col-span-8">
          {lead && <ScrollLit text={lead} index={0} />}
          {rest.map((paragraph, i) => (
            <Reveal key={i} delay={i * 0.05}>
              <p data-paragraph={i + 1} className="text-base leading-[1.9] text-muted sm:text-[17px]">
                {paragraph}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
