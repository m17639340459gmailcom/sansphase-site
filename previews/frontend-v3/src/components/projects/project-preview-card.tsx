"use client";

import { ArrowUpRight, Images } from "lucide-react";
import Image from "next/image";
import { ViewTransition, useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { rafThrottle, useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { ScrambleText } from "@/components/fx/scramble-text";
import { TextRoll } from "@/components/fx/text-roll";
import { GenerativeCover } from "@/components/ui/generative-cover";
import type { ProjectListItem } from "@/data/projects";
import { pick } from "@/data/types";
import { Link } from "@/i18n/navigation";
import { clamp, cn } from "@/lib/utils";
import { ProjectWindow } from "./project-window";
import styles from "./project-preview-card.module.css";

export type CardVariant = "default" | "lead" | "wide";

const coverSizes = {
  default: "(min-width: 1024px) 432px, (min-width: 768px) calc(50vw - 5rem), (min-width: 640px) 432px, calc(100vw - 5.5rem)",
  wide: "(min-width: 640px) 432px, calc(100vw - 5.5rem)",
  lead: "(min-width: 1024px) 496px, (min-width: 640px) 432px, calc(100vw - 5.5rem)",
};
const sheetSizes = "(min-width: 1280px) 432px, (min-width: 768px) 40vw, 1px";

/**
 * Project card whose cover sits on a 3D deck of the case's screenshots: the deck tilts toward the
 * pointer (CSS variables, rAF-throttled), fans the other screens out on hover, and the cover
 * window is the shared element that morphs into the case-study hero.
 */
export function ProjectPreviewCard({
  project,
  locale,
  category,
  cta,
  featuredLabel,
  screensLabel,
  cursorLabel,
  variant = "default",
}: {
  project: ProjectListItem;
  locale: string;
  category: string;
  cta: string;
  featuredLabel: string;
  screensLabel: string;
  cursorLabel: string;
  variant?: CardVariant;
}) {
  const card = useRef<HTMLAnchorElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const shot = useRef<HTMLDivElement>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  const lead = variant === "lead";
  const title = pick(project.title, locale);
  const sheets = (project.gallery ?? []).slice(0, 2);
  const screens = (project.cover ? 1 : 0) + (project.gallery?.length ?? 0);

  useEffect(() => {
    const host = card.current;
    const deck = stage.current;
    const lens = shot.current;
    if (!host || !deck || !lens || !fine || reduced) return;
    const paint = rafThrottle((x: number, y: number) => {
      const box = host.getBoundingClientRect();
      const glass = lens.getBoundingClientRect();
      deck.style.setProperty("--px", clamp(((x - box.left) / box.width) * 2 - 1, -1, 1).toFixed(3));
      deck.style.setProperty("--py", clamp(((y - box.top) / box.height) * 2 - 1, -1, 1).toFixed(3));
      lens.style.setProperty("--gx", `${(((x - glass.left) / glass.width) * 100).toFixed(1)}%`);
      lens.style.setProperty("--gy", `${(((y - glass.top) / glass.height) * 100).toFixed(1)}%`);
    });
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") paint(event.clientX, event.clientY);
    };
    const onLeave = () => {
      paint.cancel();
      deck.style.setProperty("--px", "0");
      deck.style.setProperty("--py", "0");
      delete host.dataset.leaving;
    };
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      onLeave();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [fine, reduced]);

  // Flatten the 3D deck before the route's view transition snapshots the cover.
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.currentTarget.dataset.leaving = "";
  }

  return (
    <Link
      ref={card}
      href={`/projects/${project.slug}`}
      prefetch={false}
      onClick={onClick}
      className={cn(
        styles.card,
        "fx-spotlight fx-roll-host",
        variant !== "default" && styles.wide,
        variant === "wide" && styles.mirror,
      )}
      style={{ "--project-hue": project.hue } as CSSProperties}
      data-fx-spot=""
      data-cursor-text={cursorLabel}
      data-project-card={project.slug}
      data-project-lead={lead || undefined}
    >
      <div ref={stage} className={styles.visual}>
        <span aria-hidden="true" className={styles.index}>
          {project.index}
        </span>
        <div className={styles.deck}>
          {sheets.map((sheet, i) => (
            <div key={sheet.src} aria-hidden="true" className={styles.sheet} data-depth={i + 1}>
              <ProjectWindow label={pick(sheet.caption ?? sheet.alt, locale)} className={styles.sheetWindow}>
                <div className={styles.sheetShot}>
                  <Image src={sheet.src} alt="" fill unoptimized={sheet.src.startsWith("/api/media/")} sizes={sheetSizes} className={styles.sheetImage} />
                </div>
              </ProjectWindow>
            </div>
          ))}
          <ViewTransition name={`project-cover-${project.slug}`} share="morph" default="none">
            <div ref={shot} className={styles.shot}>
              <ProjectWindow label={title} action={<ArrowUpRight aria-hidden="true" className="h-3 w-3 shrink-0" />}>
                {project.cover ? (
                  <Image
                    src={project.cover.src}
                    unoptimized={project.cover.src.startsWith("/api/media/")}
                    alt={pick(project.cover.alt, locale)}
                    width={project.cover.width}
                    height={project.cover.height}
                    sizes={coverSizes[variant]}
                    loading={lead ? "eager" : "lazy"}
                    className={styles.screenshot}
                  />
                ) : (
                  <div className="aspect-[16/9]">
                    <GenerativeCover hue={project.hue} motif={project.motif} index={project.index} />
                  </div>
                )}
              </ProjectWindow>
            </div>
          </ViewTransition>
        </div>
        {screens > 1 && (
          <span aria-hidden="true" className={cn(styles.screens, "glass")}>
            <Images className="h-3 w-3" />
            {screensLabel}
          </span>
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.meta}>
          <ScrambleText
            text={lead ? featuredLabel : category}
            trigger="hover"
            className="font-mono text-[10px] uppercase tracking-[.12em] text-accent"
          />
          <span className={styles.status} data-tone={project.stage.tone}>
            <span aria-hidden="true" className={styles.dot} />
            {pick(project.stage.label, locale)}
          </span>
        </div>
        <h2 className={styles.title}>
          <span className={styles.titleText}>{title}</span>
        </h2>
        <p className="text-xs leading-6 text-muted">
          {pick(project.kind, locale)}
          <span className="mx-2" aria-hidden="true">
            /
          </span>
          {project.year}
        </p>
        <p className={styles.description}>{pick(project.tagline, locale)}</p>
        {lead && (
          <ul className={styles.highlights}>
            {project.highlights.slice(0, 2).map((item) => (
              <li key={item.en}>
                <span aria-hidden="true" />
                {pick(item, locale)}
              </li>
            ))}
          </ul>
        )}
        <ul className={styles.stack}>
          {project.stack.slice(0, 4).map((tech) => (
            <li key={tech}>{tech}</li>
          ))}
          {project.stack.length > 4 && <li>+{project.stack.length - 4}</li>}
        </ul>
        <div className={styles.action}>
          <TextRoll>{cta}</TextRoll>
          <span aria-hidden="true" className={styles.arrow}>
            <ArrowUpRight className="h-4 w-4" />
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}
