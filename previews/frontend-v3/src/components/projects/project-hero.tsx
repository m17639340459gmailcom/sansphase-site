import { ArrowLeft, Download } from "lucide-react";
import type { ReactNode } from "react";
import Image from "next/image";
import { ViewTransition } from "react";
import { Aurora } from "@/components/fx/aurora";
import { Odometer } from "@/components/fx/odometer";
import { Parallax } from "@/components/fx/parallax";
import { ScrambleText } from "@/components/fx/scramble-text";
import { ScrollFade } from "@/components/fx/scroll-fade";
import { countUnits } from "@/components/fx/split";
import { SplitText } from "@/components/fx/split-text";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { TerminalPath } from "@/components/fx/terminal-path";
import { TextRoll } from "@/components/fx/text-roll";
import { ButtonLink } from "@/components/ui/button";
import { GenerativeCover } from "@/components/ui/generative-cover";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
import { Tag } from "@/components/ui/tag";
import type { Project } from "@/data/projects";
import { Link } from "@/i18n/navigation";
import { projectDetailImageSizes, type GalleryImage } from "./gallery-utils";
import { ProjectGallery } from "./project-gallery";
import { ProjectTitle } from "./project-title";
import { ProjectWindow } from "./project-window";
import styles from "./project-detail.module.css";

const TITLE_DELAY = 0.15;
const TITLE_STAGGER = 0.035;

/** Numbers roll like an odometer; words decode. */
function MetricValue({ value, delay }: { value: string; delay: number }) {
  return /\d/.test(value) ? (
    <Odometer value={value} delay={delay} />
  ) : (
    <ScrambleText text={value} delay={delay} duration={1.1} />
  );
}

/**
 * Case-study hero: cursor-lit grid and outlined case number behind a per-letter title that swells
 * under the pointer, staggered meta chips, decoding metrics, and the screenshot stage that the
 * project card's cover morphs into.
 */
export function ProjectHero({
  project,
  title,
  tagline,
  category,
  stage,
  kind,
  caseLabel,
  backLabel,
  metrics,
  images,
  note,
  cursorLabel,
  actions = [],
}: {
  project: Pick<Project, "slug" | "index" | "year" | "hue" | "motif">;
  title: string;
  tagline: string;
  category: string;
  stage: { label: string; tone: Project["stage"]["tone"] };
  kind: string;
  caseLabel: string;
  backLabel: string;
  metrics: { value: string; label: string }[];
  images: GalleryImage[];
  note?: string;
  cursorLabel: string;
  /** Primary outbound links (download, source, demo) shown under the tagline. */
  actions?: { href: string; label: string; kind: "article" | "download" | "source" | "demo"; icon?: ReactNode; cursor: string }[];
}) {
  const coverName = `project-cover-${project.slug}`;
  const taglineDelay = TITLE_DELAY + countUnits(title, "char") * TITLE_STAGGER + 0.1;
  const [first] = images;

  return (
    <SpotlightGroup as="header" className="relative isolate overflow-hidden pb-4 pt-28 sm:pt-36">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundImage: "var(--hero-glow)" }}
      />
      <Aurora className="-z-10" intensity={0.85} />
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-70" />
      <div aria-hidden="true" data-fx-spot="" className="fx-spot-lit fx-grid-lit pointer-events-none absolute inset-0 -z-10" />
      <Parallax rest="top" speed={0.3} className="pointer-events-none absolute right-0 top-24 -z-10">
        <div aria-hidden="true" className={styles.watermark}>
          <span className="fx-watermark text-outline block">{project.index}</span>
          <span data-fx-spot="" className="fx-watermark text-outline-accent fx-spot-lit absolute inset-0 block">
            {project.index}
          </span>
        </div>
      </Parallax>

      <ScrollFade className="container-x relative" distance={64}>
        <div className="flex items-center justify-between gap-4">
          <TerminalPath />
          <span className="fx-terminal tabular-nums">{caseLabel}</span>
        </div>
        <Link
          href="/projects"
          className="fx-roll-host group/back mt-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted transition-colors [--fx-roll-to:var(--accent)] hover:text-accent"
        >
          <ArrowLeft
            aria-hidden="true"
            className="h-3.5 w-3.5 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/back:-translate-x-1"
          />
          <TextRoll>{backLabel}</TextRoll>
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-12">
          <div className="min-w-0 lg:col-span-8">
            <Stagger className="flex flex-wrap items-center gap-2" stagger={0.07}>
              <StaggerItem variant="scale">
                <Tag tone="accent">{category}</Tag>
              </StaggerItem>
              <StaggerItem variant="scale">
                <Tag>{project.year}</Tag>
              </StaggerItem>
              <StaggerItem variant="scale">
                <Tag>
                  <span aria-hidden="true" className={styles.dot} data-tone={stage.tone} />
                  {stage.label}
                </Tag>
              </StaggerItem>
              <StaggerItem variant="scale">
                <span className="font-mono text-xs text-muted">{kind}</span>
              </StaggerItem>
            </Stagger>
            <ProjectTitle
              text={title}
              delay={TITLE_DELAY}
              className="mt-6 max-w-full font-display text-[clamp(2.9rem,9vw,6.25rem)] font-semibold tracking-[-0.045em] leading-[0.98]"
            />
            <SplitText
              as="p"
              text={tagline}
              variant="blur"
              delay={taglineDelay}
              stagger={0.03}
              duration={0.8}
              className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg"
            />
            {actions.length > 0 && (
              <Stagger className="mt-8 flex flex-wrap items-center gap-3" stagger={0.08}>
                {actions.map((action, i) => (
                  <StaggerItem key={action.href} variant="scale">
                    <ButtonLink
                      href={action.href}
                      variant={i === 0 ? "primary" : "secondary"}
                      arrow={action.kind !== "download"}
                      data-cursor-text={action.cursor}
                    >
                      <span className="inline-flex items-center gap-2">
                        {action.kind === "download" ? <Download aria-hidden="true" className="h-4 w-4 shrink-0" /> : action.icon}
                        {action.label}
                      </span>
                    </ButtonLink>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </div>
          {metrics.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-6 lg:col-span-4">
              {metrics.map((metric, i) => (
                <div key={metric.label} className="flex flex-col-reverse gap-1">
                  <dt className="text-xs text-muted">{metric.label}</dt>
                  <dd className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
                    <MetricValue value={metric.value} delay={taglineDelay + i * 0.15} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </ScrollFade>

      <div className="container-x mt-10 sm:mt-14">
        <div className={styles.media}>
          {images.length > 1 ? (
            <ProjectGallery
              key={project.slug}
              images={images}
              title={title}
              transitionName={coverName}
              cursorLabel={cursorLabel}
            />
          ) : (
            <ViewTransition name={coverName} share="morph" default="none">
              <div>
                <ProjectWindow label={title}>
                  {first ? (
                    <Image
                      src={first.src}
                      unoptimized={first.src.startsWith("/api/media/")}
                      alt={first.alt}
                      width={first.width}
                      height={first.height}
                      preload
                      sizes={projectDetailImageSizes}
                      className={styles.mediaImage}
                    />
                  ) : (
                    <div className="aspect-[16/8]">
                      <GenerativeCover hue={project.hue} motif={project.motif} index={project.index} />
                    </div>
                  )}
                </ProjectWindow>
              </div>
            </ViewTransition>
          )}
          {note && <p className="mt-4 max-w-3xl text-xs leading-6 text-muted">{note}</p>}
        </div>
      </div>
    </SpotlightGroup>
  );
}
