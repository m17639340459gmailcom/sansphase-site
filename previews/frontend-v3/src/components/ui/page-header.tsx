import type { CSSProperties, ReactNode } from "react";
import { Aurora } from "@/components/fx/aurora";
import { Parallax } from "@/components/fx/parallax";
import { ScrollFade } from "@/components/fx/scroll-fade";
import { isCjk } from "@/components/fx/split";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { TerminalPath } from "@/components/fx/terminal-path";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

// Sized to fit the word on one line, then pushed down so the header's bottom edge crops it.
const watermarkType =
  "fx-watermark block translate-y-[0.3em] text-right text-[length:min(17rem,19vw,var(--fx-wm-fit))]";

/** Approximate advance of `text` in em, to fit the watermark to the viewport width. */
function textWidthEm(text: string) {
  return Array.from(text).reduce((sum, char) => sum + (isCjk(char) ? 1 : char === " " ? 0.3 : 0.6), 0);
}

/**
 * Shared top-of-page header for every inner page: drifting aurora, a grid and an outlined
 * watermark that light up around the cursor and a heading visible on first paint.
 */
export function PageHeader({
  eyebrow,
  title,
  accent,
  body,
  children,
  className,
  watermark,
  index,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  body?: string;
  children?: ReactNode;
  className?: string;
  /** Huge outlined word behind the header; defaults to `eyebrow`, "" hides it. */
  watermark?: string;
  /** Short HUD label shown top-right, e.g. "02 / 05". */
  index?: string;
}) {
  const mark = watermark ?? eyebrow;
  const fit = { "--fx-wm-fit": `${(94 / Math.max(1, textWidthEm(mark))).toFixed(2)}vw` } as CSSProperties;
  return (
    <SpotlightGroup as="header" className={cn("relative isolate overflow-hidden pt-32 pb-4 sm:pt-40", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundImage: "var(--hero-glow)" }}
      />
      <Aurora className="-z-10" intensity={0.9} />
      <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-70" />
      <div aria-hidden data-fx-spot="" className="fx-spot-lit fx-grid-lit pointer-events-none absolute inset-0 -z-10" />
      {mark && (
        <Parallax rest="top" speed={0.28} className="pointer-events-none absolute inset-x-0 bottom-0 -z-10">
          <div aria-hidden className="container-x relative opacity-60 sm:opacity-100" style={fit}>
            <span className={cn(watermarkType, "text-outline")}>{mark}</span>
            <span
              data-fx-spot=""
              className={cn(
                watermarkType,
                "text-outline-accent fx-spot-lit absolute inset-x-5 top-0 sm:inset-x-8 lg:inset-x-12",
              )}
            >
              {mark}
            </span>
          </div>
        </Parallax>
      )}
      <ScrollFade className="container-x relative">
        <div className="pointer-events-none absolute inset-x-5 -top-10 flex items-center justify-between gap-4 sm:inset-x-8 sm:-top-12 lg:inset-x-12">
          <TerminalPath />
          {index && <span className="fx-terminal tabular-nums">{index}</span>}
        </div>
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          accent={accent}
          body={body}
          size="xl"
          as="h1"
          animate={false}
          className="border-b border-line pb-10 sm:pb-12"
        >
          {children}
        </SectionHeading>
      </ScrollFade>
    </SpotlightGroup>
  );
}
