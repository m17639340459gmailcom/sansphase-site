import type { ReactNode } from "react";
import { Aurora } from "@/components/fx/aurora";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { TerminalPath } from "@/components/fx/terminal-path";
import { SectionHeading } from "@/components/ui/section-heading";
import { GlitchCode } from "./glitch-code";

/**
 * Shared layout for the 404 and error pages: HUD prompt, a glitching status code, a decoded
 * status line and the page's actions. Plain component, so both server and client pages can use it.
 */
export function StatusScreen({
  code,
  status,
  detail,
  title,
  accent,
  body,
  children,
}: {
  code: string;
  status: string;
  /** Mono HUD text shown top-right, e.g. an error digest. */
  detail?: string;
  title: string;
  accent: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <SpotlightGroup as="section" className="relative isolate flex min-h-[80svh] items-center overflow-hidden pt-28 pb-16 sm:pt-32">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: "var(--hero-glow)" }} />
      <Aurora className="-z-10" intensity={0.7} />
      <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden className="fx-scanlines mask-fade-b pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden data-fx-spot="" className="fx-spot-lit fx-grid-lit pointer-events-none absolute inset-0 -z-10" />
      <div className="container-x relative flex flex-col items-start gap-7">
        <div aria-hidden className="flex w-full min-w-0 items-center justify-between gap-4">
          <TerminalPath className="min-w-0 truncate" />
          {detail && <span className="fx-terminal max-w-[45%] truncate tabular-nums">{detail}</span>}
        </div>
        <GlitchCode text={code} className="-ml-[0.05em]" />
        <SectionHeading as="h1" eyebrow={status} title={title} accent={accent} body={body} size="xl" />
        {children}
      </div>
    </SpotlightGroup>
  );
}
