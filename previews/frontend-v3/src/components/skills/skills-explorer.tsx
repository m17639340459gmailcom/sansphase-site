"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useInView } from "motion/react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/components/fx/hooks";
import { Odometer } from "@/components/fx/odometer";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SpotlightCard, SpotlightGroup } from "@/components/fx/spotlight";
import { FxTrigger } from "@/components/fx/trigger";
import { palettes } from "@/components/three/palette";
import type { SphereItem } from "@/components/three/tech-sphere";
import { TechIcon } from "@/components/ui/tech-icon";
import { getSkillName, levelValue, type SkillCategory } from "@/data/skills";
import { pick } from "@/data/types";
import { cn } from "@/lib/utils";
import styles from "./skills.module.css";

const TechSphere = dynamic(() => import("@/components/three/tech-sphere"), {
  ssr: false,
  loading: () => null,
});

const categoryColors: Record<string, string> = {
  ai: "#ff5a1f",
  frontend: "#ffb020",
  backend: "#0ea5b7",
  data: "#8b5cf6",
  cloud: "#22c55e",
  fde: "#ec4899",
};

const pad = (n: number) => String(n).padStart(2, "0");
const pill = { type: "spring", stiffness: 460, damping: 38, mass: 0.7 } as const;
const corners = ["tl", "tr", "bl", "br"] as const;

export function SkillsExplorer({ categories }: { categories: SkillCategory[] }) {
  const t = useTranslations("Skills");
  const fx = useTranslations("FX.about.skills");
  const cursor = useTranslations("FX.common.cursor");
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const [active, setActive] = useState<string | null>(null);
  // `undefined`: nothing hovered; `null`: hovering "All".
  const [hovered, setHovered] = useState<string | null | undefined>(undefined);
  const wrapper = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapper, { amount: 0.1 });
  const visible = usePageVisible();
  const reduced = usePrefersReducedMotion();

  const items = useMemo<SphereItem[]>(
    () =>
      Array.from(
        new Map(
          categories
            .flatMap((c) =>
              c.skills.map((s) => ({ name: getSkillName(s, locale), category: c.id, weight: levelValue[s.level] })),
            )
            .map((s) => [s.name, s] as const),
        ).values(),
      ),
    [categories, locale],
  );

  const palette = palettes[resolvedTheme === "dark" ? "dark" : "light"];
  const preview = hovered === undefined ? active : hovered;
  const options = [
    { id: null, label: t("all"), count: items.length },
    ...categories.map((c) => ({ id: c.id, label: pick(c.title, locale), count: c.skills.length })),
  ];
  const current = options.find((o) => o.id === preview) ?? options[0];
  // Clicking a category floats its skills to the front of the legend (FLIP via `layout`).
  const legend = active
    ? [...items.filter((i) => i.category === active), ...items.filter((i) => i.category !== active)]
    : items;

  return (
    <div className="surface-panel overflow-hidden">
      <div className="grid grid-cols-1 gap-6 p-5 sm:p-7 lg:grid-cols-12 lg:items-center lg:gap-10 lg:p-8">
        {/* Category selector: a sliding pill follows the preview, a bar marks the active filter. */}
        <div className="min-w-0 lg:col-span-4">
          <p className="eyebrow mb-5">{t("categories")}</p>
          <div
            role="group"
            aria-label={t("categories")}
            className="grid grid-cols-2 gap-x-3 gap-y-1 lg:grid-cols-1"
            onMouseLeave={() => setHovered(undefined)}
          >
            {options.map((o) => {
              const isPreview = preview === o.id;
              const isActive = active === o.id;
              return (
                <button
                  key={o.id ?? "all"}
                  type="button"
                  aria-pressed={isActive}
                  onMouseEnter={() => setHovered(o.id)}
                  onFocus={() => setHovered(o.id)}
                  onBlur={() => setHovered(undefined)}
                  onClick={() => {
                    setHovered(undefined);
                    setActive(o.id === null || active === o.id ? null : o.id);
                  }}
                  className={cn(
                    "relative isolate flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors duration-300",
                    isPreview ? "text-accent" : "text-muted hover:text-fg",
                  )}
                >
                  {isPreview && (
                    <motion.span layoutId="skills-filter-pill" aria-hidden transition={pill} className="absolute inset-0 -z-10 rounded-lg bg-accent-soft" />
                  )}
                  {isActive && (
                    <motion.span layoutId="skills-filter-mark" aria-hidden transition={pill} className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-accent" />
                  )}
                  <span className="flex items-center gap-2.5">
                    {o.id && (
                      <span
                        aria-hidden
                        className="hidden h-1.5 w-1.5 shrink-0 rounded-full opacity-70 sm:block"
                        style={{ background: categoryColors[o.id] }}
                      />
                    )}
                    <span className="font-medium">{o.label}</span>
                  </span>
                  <Odometer value={pad(o.count)} duration={1.2} className="font-mono text-[11px]" />
                </button>
              );
            })}
          </div>
          <p className="mt-5 flex items-center gap-2 border-t border-line pt-5 text-xs leading-relaxed text-muted">
            <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
            {t("sphereHint")}
          </p>
        </div>

        {/* Sphere viewport with a HUD: radar sweep, reticle, corner brackets and a live readout. */}
        <div
          ref={wrapper}
          data-cursor-text={cursor("drag")}
          className="relative isolate aspect-square w-full min-w-0 max-h-[32rem] overflow-hidden lg:col-span-8 lg:aspect-[5/4]"
        >
          <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
            <div className="h-[60%] w-[60%] rounded-full bg-[radial-gradient(circle,var(--accent-glow),transparent_70%)] blur-3xl opacity-20" />
          </div>
          <div aria-hidden className={cn(styles.radar, "-z-10")} data-paused={inView && visible ? undefined : ""} />
          <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 -z-10 h-full w-full">
            <circle cx="50" cy="50" r="43" fill="none" className="stroke-line" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
            <circle cx="50" cy="50" r="30" fill="none" className="stroke-line" strokeWidth="0.25" strokeDasharray="1 2" vectorEffect="non-scaling-stroke" />
            <path d="M50 4V14M50 86V96M4 50H14M86 50H96" className="stroke-line-strong" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          </svg>
          {corners.map((corner) => (
            <span key={corner} aria-hidden data-c={corner} className={styles.corner} />
          ))}
          <div aria-hidden className="pointer-events-none absolute top-3 left-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            <span
              className="h-1.5 w-1.5 rounded-full transition-colors duration-300"
              style={{ background: current.id ? categoryColors[current.id] : "var(--accent)" }}
            />
            <ScrambleText text={current.label} duration={0.5} className="text-fg" />
            <span className="tabular-nums">
              {pad(current.count)}/{pad(items.length)}
            </span>
          </div>
          <div aria-hidden className="pointer-events-none absolute right-4 bottom-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            {fx("nodes", { count: items.length })}
          </div>
          <TechSphere
            items={items}
            palette={palette}
            activeCategory={preview}
            categoryColors={categoryColors}
            reduced={reduced}
            active={inView}
          />
        </div>
      </div>

      {/* Legend: every node as a chip; hover previews its category, a filter reorders them. */}
      <div aria-hidden className="hidden border-t border-line px-7 py-5 md:block lg:px-8" onPointerLeave={() => setHovered(undefined)}>
        <ul className="flex flex-wrap gap-1.5">
          {legend.map((item) => {
            const lit = preview !== null && item.category === preview;
            return (
              <motion.li
                layout="position"
                key={item.name}
                transition={pill}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setHovered(item.category);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-[color,background-color,border-color,opacity] duration-300",
                  lit ? "border-accent/40 bg-accent-soft text-fg" : "border-line text-muted",
                  preview !== null && !lit && "opacity-45",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: categoryColors[item.category] }} />
                {item.name}
              </motion.li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Technology directory: category cards with a share-of-directory meter and staggered rows. */
export function SkillMatrix({ categories }: { categories: SkillCategory[] }) {
  const locale = useLocale();
  const fx = useTranslations("FX.about.skills");
  const total = categories.reduce((sum, c) => sum + c.skills.length, 0);
  const starts = categories.map((_, ci) => categories.slice(0, ci).reduce((sum, c) => sum + c.skills.length, 0));

  return (
    <SpotlightGroup className="grid gap-5 md:grid-cols-2 lg:gap-6">
      {categories.map((c, ci) => (
        <FxTrigger key={c.id} as="section" amount={0.25} className={cn(styles.dir, "min-w-0")}>
          <SpotlightCard className="h-full rounded-2xl border border-line bg-bg-elevated p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <ScrambleText text={pad(ci + 1)} className="mb-3 block font-mono text-[10px] tracking-[0.16em] text-accent" />
                <h3 className="font-display text-xl font-semibold tracking-tight">{pick(c.title, locale)}</h3>
                <p className="mt-2 max-w-sm text-sm leading-[1.75] text-muted">{pick(c.blurb, locale)}</p>
              </div>
              <Odometer value={pad(c.skills.length)} className="font-mono text-[11px] text-muted" />
            </div>

            <div aria-hidden className="mt-5">
              <div className={styles.meter} style={{ "--n": total } as CSSProperties}>
                {Array.from({ length: total }, (_, k) => {
                  const lit = k >= starts[ci] && k < starts[ci] + c.skills.length;
                  return (
                    <span
                      key={k}
                      data-lit={lit ? "" : undefined}
                      style={lit ? ({ "--k": k - starts[ci] } as CSSProperties) : undefined}
                    />
                  );
                })}
              </div>
              <p className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                <span>{fx("share")}</span>
                <span className="tabular-nums text-fg">{Math.round((c.skills.length / total) * 100)}%</span>
              </p>
            </div>

            <ul className="mt-4 flex flex-col divide-y divide-line/60 border-t border-line/60">
              {c.skills.map((s, si) => {
                const name = getSkillName(s, locale);
                return (
                  <li
                    key={s.name}
                    className={cn(styles.row, "group/skill flex min-h-10 items-center gap-3 py-2")}
                    style={{ "--i": si } as CSSProperties}
                  >
                    <span className="flex min-w-0 items-center gap-2.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/skill:translate-x-1">
                      <TechIcon icon={s.icon} name={name} size={16} className="shrink-0 text-muted transition-colors duration-300 group-hover/skill:text-accent" />
                      <span className="text-[13px] font-medium leading-relaxed sm:text-sm">{name}</span>
                    </span>
                    <span aria-hidden className="ml-auto h-px w-0 bg-accent transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/skill:w-6" />
                  </li>
                );
              })}
            </ul>
          </SpotlightCard>
        </FxTrigger>
      ))}
    </SpotlightGroup>
  );
}
