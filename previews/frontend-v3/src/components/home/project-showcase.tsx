"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";
import { AnimatePresence, motion, useSpring } from "motion/react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  ViewTransition,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useInViewport, usePageVisible, usePrefersReducedMotion } from "@/components/fx/hooks";
import { useIntroDone } from "@/components/fx/intro-store";
import { Parallax } from "@/components/fx/parallax";
import { ScrambleText } from "@/components/fx/scramble-text";
import { useSpotlight } from "@/components/fx/spotlight";
import { TextRoll } from "@/components/fx/text-roll";
import { ShowcaseCaption } from "@/components/home/showcase/caption";
import { RollingDigits } from "@/components/home/showcase/rolling-digits";
import { ButtonLink } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { clamp, cn } from "@/lib/utils";
import styles from "./project-showcase.module.css";

type ShowcaseProject = {
  slug: string;
  href: string;
  title: string;
  tagline: string;
  category: string;
  stack: string[];
  cover?: { src: string; alt: string; width: number; height: number };
};

type Swipe = { id: number; x: number; y: number; captured: boolean; step: number };

const CYCLE_MS = 6500;
const SCREEN_RATIO = 16 / 9;
const cycle = { "--cycle": `${CYCLE_MS}ms` } as CSSProperties;

const pad = (value: number) => String(value).padStart(2, "0");

/** The screenshot's own box inside the 16:9 screen, so the shared-element morph hugs real pixels. */
function shotSize(width: number, height: number): CSSProperties {
  const ratio = width / height;
  return ratio >= SCREEN_RATIO
    ? { width: "100%", height: `${(SCREEN_RATIO / ratio) * 100}%` }
    : { width: `${(ratio / SCREEN_RATIO) * 100}%`, height: "100%" };
}

export function ProjectShowcase({ projects, prefetch }: { projects: ShowcaseProject[]; prefetch?: boolean }) {
  const t = useTranslations("Home.featured.carousel");
  const cursor = useTranslations("FX.common.cursor");
  const fx = useTranslations("FX.home");
  const viewportId = useId();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef<Swipe | null>(null);
  const scrubFrame = useRef(0);
  const refocus = useRef(false);
  const suppressClickUntil = useRef(0);
  const reduced = usePrefersReducedMotion();
  const pageVisible = usePageVisible();
  const introDone = useIntroDone();
  const inView = useInViewport(root, { once: false, amount: 0.35 });
  const seen = useInViewport(root, { amount: 0.2 });
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const tiltX = useSpring(0, { stiffness: 130, damping: 22 });
  const tiltY = useSpring(0, { stiffness: 130, damping: 22 });
  const count = projects.length;
  const autoplay = !reduced && count > 1;
  const rotating = autoplay && playing && !hovered && !focused && !dragging && inView && pageVisible && introDone;
  // The autoplay clock is the progress bar itself: it pauses with the carousel and advances on animationend.
  const progress = !autoplay ? "full" : rotating ? "run" : "hold";
  const live = seen && introDone;
  useSpotlight(root);

  // The front card's link becomes a button once it moves aside; hand keyboard focus to the new front card.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    stage.current?.querySelector<HTMLElement>("[data-active='true'] a")?.focus({ preventScroll: true });
  }, [active]);

  function select(index: number) {
    setActive(((index % count) + count) % count);
    tiltX.set(0);
    tiltY.set(0);
  }

  function advance() {
    setActive((index) => (index + 1) % count);
  }

  // One CSS-variable write per frame while a drag scrubs the carousel.
  function scrub(element: HTMLElement, shift: number) {
    cancelAnimationFrame(scrubFrame.current);
    scrubFrame.current = requestAnimationFrame(() => element.style.setProperty("--shift", shift.toFixed(4)));
  }

  function endScrub() {
    cancelAnimationFrame(scrubFrame.current);
    const element = stage.current;
    if (!element) return;
    element.style.removeProperty("--shift");
    delete element.dataset.scrub;
  }

  function cancelSwipe() {
    pointer.current = null;
    setDragging(false);
    endScrub();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const destination = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: count - 1 }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    refocus.current = stage.current?.contains(event.target as Node) ?? false;
    select(destination);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current;
    if (start && start.id === event.pointerId) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.captured && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        const element = event.currentTarget;
        element.setPointerCapture(event.pointerId);
        start.captured = true;
        if (!reduced) {
          // Scrub in card steps: the same fraction of a card width the CSS offsets use.
          const card = element.querySelector<HTMLElement>("[data-active='true']");
          const step = parseFloat(getComputedStyle(element).getPropertyValue("--step")) / 100 || 0.67;
          start.step = (card?.offsetWidth ?? 0) * step;
          element.dataset.scrub = "";
          tiltX.set(0);
          tiltY.set(0);
        }
      }
      if (start.captured && start.step > 0) {
        scrub(event.currentTarget, clamp((dx - Math.sign(dx) * 10) / start.step, -1, 1));
      }
      return;
    }
    if (reduced || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    tiltX.set(-((event.clientY - bounds.top) / bounds.height - 0.5) * 4);
    tiltY.set(((event.clientX - bounds.left) / bounds.width - 0.5) * 6);
  }

  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current;
    cancelSwipe();
    if (!start || start.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      suppressClickUntil.current = performance.now() + 350;
      select(active + (dx < 0 ? 1 : -1));
    }
  }

  const current = projects[active];
  if (!current) return null;

  return (
    <div
      ref={root}
      role="region"
      aria-roledescription={t("role")}
      aria-label={t("label")}
      data-project-showcase
      className={cn(styles.root, "mt-8 sm:mt-10")}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        tiltX.set(0);
        tiltY.set(0);
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div aria-hidden className={styles.backdrop}>
        <Parallax speed={0.1} className={styles.numeral}>
          <RollingDigits value={pad(active + 1)} className="text-outline" />
          <span data-fx-spot="" className={cn("fx-spot-lit", styles.numeralLit)}>
            <RollingDigits value={pad(active + 1)} className="text-outline-accent" />
          </span>
        </Parallax>
      </div>

      <div
        ref={stage}
        id={viewportId}
        className={styles.stage}
        data-live={live ? "" : undefined}
        data-cursor-text={cursor("drag")}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, captured: false, step: 0 };
          setDragging(true);
        }}
        onPointerMove={onPointerMove}
        onPointerLeave={(event) => {
          tiltX.set(0);
          tiltY.set(0);
          if (pointer.current && !event.currentTarget.hasPointerCapture(pointer.current.id)) cancelSwipe();
        }}
        onPointerUp={finishSwipe}
        onPointerCancel={cancelSwipe}
        onLostPointerCapture={(event) => {
          // Touch starts captured by the card under the finger; that capture moving to the stage is not a cancel.
          if (event.target === event.currentTarget) cancelSwipe();
        }}
        onClickCapture={(event) => {
          if (performance.now() < suppressClickUntil.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div className={styles.glow} aria-hidden />
        {projects.map((project, index) => {
          let offset = (index - active + count) % count;
          if (offset > count / 2) offset -= count;
          const selected = offset === 0;
          const distant = Math.abs(offset) > 1;
          return (
            <div
              key={project.slug}
              className={styles.card}
              data-active={selected}
              data-distant={distant}
              role="group"
              aria-roledescription={t("slide")}
              aria-label={t("position", { index: index + 1, count, name: project.title })}
              aria-hidden={distant}
              inert={distant}
              style={{ "--offset": offset } as CSSProperties}
            >
              <motion.div className={styles.frame} style={{ rotateX: selected && !reduced ? tiltX : 0, rotateY: selected && !reduced ? tiltY : 0 }}>
                <div className={styles.chrome} aria-hidden>
                  <span className="flex gap-1.5"><i /><i /><i /></span>
                  <span className="truncate font-mono text-[10px] sm:text-[11px]">{project.title}</span>
                  <ArrowUpRight className="h-3 w-3" />
                </div>
                <div className={styles.screen}>
                  {project.cover ? (
                    <>
                      <div className={styles.shot} style={shotSize(project.cover.width, project.cover.height)}>
                        <Image
                          src={project.cover.src}
                          alt={project.cover.alt}
                          fill
                          unoptimized={project.cover.src.startsWith("/api/media/") || project.cover.src === "/share/cover.jpg"}
                          sizes="(min-width: 1280px) 780px, (min-width: 640px) 66vw, 84vw"
                          draggable={false}
                          className="object-contain"
                        />
                      </div>
                      {/* Only the front card mounts a named copy, so it morphs into the project page hero.
                          Mounting (not renaming) keeps the real shot steady and React's name tracking exact. */}
                      {selected && (
                        <ViewTransition name={`project-cover-${project.slug}`} share="morph" default="none">
                          <div
                            aria-hidden
                            className={cn(styles.shot, styles.clone)}
                            style={shotSize(project.cover.width, project.cover.height)}
                          >
                            <Image
                              src={project.cover.src}
                              alt=""
                              fill
                              unoptimized={project.cover.src.startsWith("/api/media/") || project.cover.src === "/share/cover.jpg"}
                              sizes="(min-width: 1280px) 780px, (min-width: 640px) 66vw, 84vw"
                              draggable={false}
                              className="object-contain"
                            />
                          </div>
                        </ViewTransition>
                      )}
                    </>
                  ) : <span className="font-display text-3xl">{project.title}</span>}
                  <span className={styles.gloss} aria-hidden />
                  <span className={styles.glare} data-fx-spot="" aria-hidden />
                </div>
                <span className={styles.fog} aria-hidden />
                {selected ? (
                  <Link
                    href={project.href}
                    prefetch={prefetch}
                    draggable={false}
                    className={styles.hitArea}
                    aria-label={t("open", { name: project.title })}
                    data-cursor-text={cursor("view")}
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.hitArea}
                    tabIndex={-1}
                    onClick={() => select(index)}
                    aria-label={t("select", { name: project.title })}
                    data-cursor-text={offset < 0 ? fx("showcaseCursorPrev") : fx("showcaseCursorNext")}
                  />
                )}
              </motion.div>
            </div>
          );
        })}
      </div>

      <div className="relative grid gap-6 border-t border-line pt-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8 sm:pt-8">
        <div className="min-w-0 sm:min-h-40">
          <p className="mb-3 flex items-center gap-3 text-xs text-muted">
            <span className="font-mono tabular-nums text-accent">
              <span className="sr-only">{pad(active + 1)}</span>
              <RollingDigits value={pad(active + 1)} /> / {pad(count)}
            </span>
            <span className="h-3 w-px bg-line-strong" aria-hidden />
            <ScrambleText key={current.slug} text={current.category} play={seen} duration={0.6} />
          </p>
          <div className="grid" aria-live={rotating ? "off" : "polite"} aria-atomic="true">
            <AnimatePresence initial={false}>
              <ShowcaseCaption key={current.slug} title={current.title} tagline={current.tagline} play={seen} />
            </AnimatePresence>
          </div>
          <ul key={current.slug} className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] text-muted">
            {current.stack.map((item, index) => (
              <li key={item}>
                <ScrambleText text={item} play={seen} delay={0.2 + index * 0.06} duration={0.5} />
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-col sm:flex-nowrap sm:items-end sm:justify-start sm:gap-6">
          <ButtonLink href={current.href} arrow variant="secondary">{t("read")}</ButtonLink>
          {count > 1 && (
            <div className="flex items-center gap-1.5">
              {autoplay && (
                <button
                  type="button"
                  className={cn(styles.control, "mr-1 text-muted")}
                  aria-label={t(playing ? "pause" : "play")}
                  data-cursor="snap"
                  onClick={() => setPlaying((value) => !value)}
                >
                  <svg className={styles.ring} viewBox="0 0 44 44" aria-hidden>
                    <circle key={active} className={styles.ringFill} data-mode={progress} style={cycle} cx="22" cy="22" r="21" pathLength={1} />
                  </svg>
                  {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                </button>
              )}
              <button type="button" className={cn(styles.control, styles.prev)} aria-label={t("previous")} aria-controls={viewportId} data-cursor="snap" onClick={() => select(active - 1)}><ArrowLeft className="h-4 w-4" aria-hidden /></button>
              <button type="button" className={cn(styles.control, styles.next)} aria-label={t("next")} aria-controls={viewportId} data-cursor="snap" onClick={() => select(active + 1)}><ArrowRight className="h-4 w-4" aria-hidden /></button>
            </div>
          )}
        </div>
      </div>

      {count > 1 && (
        <div className="mt-7 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-4 sm:mt-6 sm:gap-x-7" role="group" aria-label={t("choose")}>
          {projects.map((project, index) => {
            const isActive = active === index;
            return (
              <button
                key={project.slug}
                type="button"
                className={cn(
                  styles.tab,
                  "fx-roll-host flex min-h-11 items-center gap-2 text-xs transition-colors [--fx-roll-to:var(--accent)] sm:text-[13px]",
                  isActive ? "text-fg" : "text-muted hover:text-fg",
                )}
                aria-label={t("select", { name: project.title })}
                aria-pressed={isActive}
                aria-controls={viewportId}
                onClick={() => select(index)}
              >
                <span className={cn("font-mono text-[10px]", isActive && "text-accent")}>{pad(index + 1)}</span>
                <TextRoll>{project.title}</TextRoll>
                <span className={styles.track} aria-hidden>
                  {isActive && <span className={styles.fill} data-mode={progress} style={cycle} onAnimationEnd={advance} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
