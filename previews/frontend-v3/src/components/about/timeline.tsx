"use client";

import { GraduationCap, MapPin } from "lucide-react";
import { motion, useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type RefCallback } from "react";
import { useInViewport, usePrefersReducedMotion } from "@/components/fx/hooks";
import { useIntroDone } from "@/components/fx/intro-store";
import { Odometer } from "@/components/fx/odometer";
import { SpotlightCard, SpotlightGroup } from "@/components/fx/spotlight";
import type { EducationEntry, ExperienceEntry } from "@/data/timeline";
import { pick } from "@/data/types";
import { Reveal } from "@/components/ui/reveal";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import styles from "./about.module.css";

const TICK = 40;

/**
 * Education as a scroll-drawn timeline: the spine draws itself as you scroll, a glowing head
 * travels down it, and each entry's node lights up, its year rolls in and its card slides in
 * from its side when the head arrives. Static and fully drawn under reduced motion.
 */
export function EducationTimeline({
  entries,
  locale,
  classOfLabel,
}: {
  entries: EducationEntry[];
  locale: string;
  classOfLabel: string;
}) {
  const list = useRef<HTMLOListElement>(null);
  const nodes = useRef<(HTMLSpanElement | null)[]>([]);
  const stops = useRef<number[]>([]);
  const reachedRef = useRef(-1);
  const gradient = `spine${useId().replace(/[^\w-]/g, "")}`;
  const reduced = usePrefersReducedMotion();
  const introDone = useIntroDone();
  const [size, setSize] = useState(0);
  const [reached, setReached] = useState(-1);
  const height = useMotionValue(0);
  const { scrollYProgress } = useScroll({ target: list, offset: ["start 0.7", "end 0.6"] });
  const progress = useSpring(scrollYProgress, { stiffness: 220, damping: 32, mass: 0.4, restDelta: 0.0005 });
  const headY = useTransform(() => progress.get() * height.get());
  const headOpacity = useTransform(progress, [0, 0.015, 0.985, 1], [0, 1, 1, 0]);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    // Layout reads only on resize; scrolling itself just compares against cached stops.
    const observer = new ResizeObserver(() => {
      const top = element.getBoundingClientRect().top;
      const total = Math.max(element.offsetHeight, 1);
      stops.current = nodes.current.map((node) => {
        if (!node) return 1;
        const rect = node.getBoundingClientRect();
        return (rect.top + rect.height / 2 - top - 4) / total;
      });
      height.set(total);
      setSize(total);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  useMotionValueEvent(progress, "change", (value) => {
    let count = reachedRef.current;
    stops.current.forEach((stop, i) => {
      if (value >= stop) count = Math.max(count, i);
    });
    if (count === reachedRef.current) return;
    reachedRef.current = count;
    setReached(count);
  });

  const shown = reduced ? entries.length - 1 : introDone ? reached : -1;
  const nodeRef = (i: number): RefCallback<HTMLSpanElement> => (node) => {
    nodes.current[i] = node;
  };
  const ticks = Array.from({ length: Math.floor(size / TICK) + 1 }, (_, i) => `M2 ${i * TICK}H10`).join("");

  return (
    <SpotlightGroup>
      <ol ref={list} className="relative">
        <span aria-hidden className="absolute inset-y-0 left-[11px] w-px -translate-x-1/2 bg-line md:left-1/2" />
        {size > 0 && (
          <svg
            aria-hidden
            className="pointer-events-none absolute top-0 left-[11px] -translate-x-1/2 overflow-visible md:left-1/2"
            width="12"
            height={size}
            viewBox={`0 0 12 ${size}`}
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2={size} gradientUnits="userSpaceOnUse">
                <stop offset="0" style={{ stopColor: "var(--accent)" }} />
                <stop offset="0.55" style={{ stopColor: "var(--amber)" }} />
                <stop offset="1" style={{ stopColor: "var(--accent)" }} />
              </linearGradient>
            </defs>
            <path d={ticks} className="stroke-line-strong" strokeWidth="1" opacity="0.7" />
            <motion.path
              d={`M6 0V${size}`}
              fill="none"
              stroke={`url(#${gradient})`}
              strokeWidth="2"
              style={{ pathLength: reduced ? 1 : progress }}
            />
          </svg>
        )}
        {!reduced && size > 0 && (
          <motion.span
            aria-hidden
            className={cn(styles.head, "left-[11px] md:left-1/2")}
            style={{ y: headY, opacity: headOpacity }}
          />
        )}
        {entries.map((entry, i) => (
          <TimelineEntry
            key={entry.id}
            entry={entry}
            locale={locale}
            classOfLabel={classOfLabel}
            side={i % 2 === 0 ? "left" : "right"}
            reached={i <= shown}
            nodeRef={nodeRef(i)}
          />
        ))}
      </ol>
    </SpotlightGroup>
  );
}

function TimelineEntry({
  entry: e,
  locale,
  classOfLabel,
  side,
  reached,
  nodeRef,
}: {
  entry: EducationEntry;
  locale: string;
  classOfLabel: string;
  side: "left" | "right";
  reached: boolean;
  nodeRef: RefCallback<HTMLSpanElement>;
}) {
  const card = useRef<HTMLElement>(null);
  const introDone = useIntroDone();
  // Safety net: a card that is almost fully in view always shows, even if the head lags.
  const seen = useInViewport(card, { amount: 0.9 });
  const on = reached || (introDone && seen);
  const period = pick(e.period, locale);
  const [from, to] = period.split(/\s*[—–-]\s*/);
  const left = side === "left";

  return (
    <li className={cn(styles.entry, "relative grid pb-12 last:pb-0 md:grid-cols-2 md:gap-x-24 md:pb-20")}>
      <span ref={nodeRef} aria-hidden data-on={on ? "" : undefined} className={cn(styles.node, "top-[52px] left-[11px] sm:top-[60px] md:left-1/2")} />
      <article
        ref={card}
        data-reveal
        data-on={on ? "" : undefined}
        className={cn(
          styles.card,
          "relative ml-10 min-w-0 md:ml-0",
          left ? "md:col-start-1 md:[--from:-56px]" : "md:col-start-2 md:[--from:56px]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            styles.connector,
            "top-[52px] -left-[21px] w-[21px] origin-left [--dir:90deg] sm:top-[60px] md:w-10",
            left ? "md:right-[-40px] md:left-auto md:origin-right md:[--dir:270deg]" : "md:-left-10",
          )}
        />
        <SpotlightCard className="grid min-w-0 content-start rounded-2xl border border-line bg-bg-elevated p-6 sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div
              className={cn(
                "relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-line bg-white",
                e.logoFit === "wordmark" && "min-w-0 w-28 shrink",
              )}
            >
              <Image
                src={e.logo}
                alt=""
                fill
                unoptimized={e.logo.startsWith("/api/media/") || e.logo === "/share/cover.jpg"}
                sizes={e.logoFit === "wordmark" ? "112px" : "56px"}
                className={cn("object-contain p-2", e.logoFit !== "contain" && "object-cover p-0")}
              />
            </div>
            {e.classOf && (
              <Tag tone="accent" className="shrink-0 whitespace-nowrap">
                {classOfLabel.replace("{year}", e.classOf)}
              </Tag>
            )}
          </div>
          <p className="eyebrow mb-2 md:sr-only">{period}</p>
          <h3 className="font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
            {pick(e.school, locale)}
          </h3>
          <p className="mt-2 mb-6 text-base leading-relaxed text-fg/85">
            {e.degree && <>{pick(e.degree, locale)} · </>}
            <span className="font-serif italic text-accent [:lang(zh)_&]:font-sans [:lang(zh)_&]:not-italic">
              {pick(e.field, locale)}
            </span>
          </p>
          {e.focus.length > 0 && (
            <ul className="flex flex-col gap-2.5 border-t border-line pt-5 text-sm leading-relaxed text-muted">
              {e.focus.map((f) => (
                <li key={f.en} className="flex items-start gap-2">
                  <GraduationCap aria-hidden className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" />
                  {pick(f, locale)}
                </li>
              ))}
            </ul>
          )}
          {e.location && (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted">
              <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />
              {pick(e.location, locale)}
            </p>
          )}
        </SpotlightCard>
      </article>
      <div
        aria-hidden
        data-on={on ? "" : undefined}
        className={cn(
          "hidden transition-opacity duration-700 md:row-start-1 md:flex md:flex-col md:pt-6",
          left ? "md:col-start-2 md:items-start" : "md:col-start-1 md:items-end md:text-right",
          !on && "opacity-40",
        )}
      >
        <Odometer
          value={from}
          play={on}
          className={cn(styles.year, "font-display text-6xl font-semibold tracking-[-0.04em] lg:text-7xl")}
        />
        {to && <span className="mt-3 font-mono text-xs tracking-[0.18em] text-accent">→ {to}</span>}
        <span className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">{e.shortName}</span>
      </div>
    </li>
  );
}

export function ExperienceTimeline({
  entries,
  locale,
}: {
  entries: ExperienceEntry[];
  locale: string;
}) {
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => (
        <Reveal key={e.id} as="li" delay={i * 0.08} className="border-t border-line py-8 first:pt-0 first:border-t-0 last:pb-0 sm:py-10">
          <div className="grid gap-4 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent">
                {pick(e.period, locale)}
              </p>
              <p className="mt-2 text-sm text-muted">{pick(e.org, locale)}</p>
            </div>
            <div className="lg:col-span-9">
              <h3 className="font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                {pick(e.title, locale)}
              </h3>
              <p className="mt-3 max-w-[44rem] text-[15px] leading-[1.85] text-fg/85">{pick(e.summary, locale)}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {e.bullets.map((b) => (
                  <li key={b.en} className="flex gap-3 text-sm leading-[1.8] text-muted">
                    <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                    {pick(b, locale)}
                  </li>
                ))}
              </ul>
              <ul className="mt-5 flex flex-wrap gap-1.5">
                {e.stack.map((s) => (
                  <li
                    key={s}
                    className="rounded-md bg-accent-soft/50 px-2 py-1 font-mono text-[10px] text-muted"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      ))}
    </ol>
  );
}
