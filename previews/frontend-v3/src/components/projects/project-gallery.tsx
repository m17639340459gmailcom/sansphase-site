"use client";

import { ArrowLeft, ArrowRight, Maximize2 } from "lucide-react";
import { LayoutGroup, motion, useScroll, useTransform } from "motion/react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  ViewTransition,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { Odometer } from "@/components/fx/odometer";
import { ScrambleText } from "@/components/fx/scramble-text";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { containRect, pad, projectDetailImageSizes, type GalleryImage } from "./gallery-utils";
import { ProjectWindow } from "./project-window";
import styles from "./project-gallery.module.css";

const loadLightbox = () => import("./project-lightbox");
const ProjectLightbox = dynamic(() => loadLightbox().then((mod) => mod.ProjectLightbox), { ssr: false });

/**
 * Case-study screenshot stage. Native scroll snapping keeps touch swipes; mice can drag it. The
 * framed stage grows into place as it scrolls up, is the shared element the project card morphs
 * into, and opens the zoomable lightbox (loaded on demand) from the current screenshot.
 */
export function ProjectGallery({
  images,
  title,
  transitionName,
  cursorLabel,
}: {
  images: GalleryImage[];
  title: string;
  transitionName: string;
  cursorLabel: string;
}) {
  const t = useTranslations("Projects.gallery");
  const tf = useTranslations("FX.projects");
  const reduced = usePrefersReducedMotion();
  const viewportId = useId();
  const area = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const targetIndex = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressFrame = useRef(0);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [active, setActive] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);

  const { scrollYProgress } = useScroll({ target: area, offset: ["start end", "start 0.2"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let previousWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      element.scrollTo({ left: targetIndex.current * previousWidth, behavior: "instant" });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (settleTimer.current) clearTimeout(settleTimer.current);
      cancelAnimationFrame(progressFrame.current);
    };
  }, []);

  const origin = useCallback((index: number) => {
    const element = viewport.current;
    const image = images[index];
    if (!element || !image) return null;
    return containRect(element.getBoundingClientRect(), image.width / image.height);
  }, [images]);

  function select(index: number, instant = false) {
    const element = viewport.current;
    if (!element || images.length === 0) return;
    const next = (index + images.length) % images.length;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    targetIndex.current = next;
    setActive(next);
    element.scrollTo({ left: next * element.clientWidth, behavior: instant || reduced ? "instant" : "smooth" });
  }

  function onScroll() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    // Commit native swipes once they settle, not at every intermediate pixel.
    settleTimer.current = setTimeout(() => {
      const element = viewport.current;
      if (!element || element.clientWidth === 0 || drag.current) return;
      const index = Math.max(0, Math.min(images.length - 1, Math.round(element.scrollLeft / element.clientWidth)));
      delete element.dataset.dragging;
      targetIndex.current = index;
      setActive(index);
    }, 120);
    if (progressFrame.current) return;
    progressFrame.current = requestAnimationFrame(() => {
      progressFrame.current = 0;
      const element = viewport.current;
      const max = element ? element.scrollWidth - element.clientWidth : 0;
      if (element && frame.current) frame.current.style.setProperty("--progress", max > 0 ? (element.scrollLeft / max).toFixed(4) : "0");
    });
  }

  function open(index: number) {
    void loadLightbox();
    setViewer(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      open(targetIndex.current);
      return;
    }
    const destination = {
      ArrowLeft: targetIndex.current - 1,
      ArrowRight: targetIndex.current + 1,
      Home: 0,
      End: images.length - 1,
    }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    select(destination);
  }

  // Mouse drag-to-swipe; touch keeps native scrolling.
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const element = viewport.current;
    if (event.pointerType !== "mouse" || event.button !== 0 || !element) return;
    drag.current = { id: event.pointerId, x: event.clientX, left: element.scrollLeft, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const element = viewport.current;
    if (!state || !element || event.pointerId !== state.id) return;
    const dx = event.clientX - state.x;
    if (!state.moved) {
      if (Math.abs(dx) < 6) return;
      state.moved = true;
      element.setPointerCapture(state.id);
      element.dataset.dragging = "";
    }
    element.scrollLeft = state.left - dx;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const element = viewport.current;
    drag.current = null;
    if (!state?.moved || !element) return;
    suppressClick.current = true;
    const dx = event.clientX - state.x;
    const base = Math.round(state.left / element.clientWidth);
    select(Math.abs(dx) > element.clientWidth * 0.12 ? base - Math.sign(dx) : base);
  }

  function onClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    open(targetIndex.current);
  }

  const current = images[active] ?? images[0];
  if (!current) return null;
  const aspectRatio = 1 / Math.max(...images.map((image) => image.height / image.width));

  return (
    <section
      aria-label={t("label")}
      aria-roledescription={t("carousel")}
      data-project-gallery
      onPointerEnter={() => void loadLightbox()}
      onFocus={() => void loadLightbox()}
    >
      <div ref={area}>
        {/* Anchored at the bottom: the stage grows up toward the title and never covers its controls. */}
        <motion.div className="origin-bottom" style={reduced ? undefined : { scale }}>
          <ViewTransition name={transitionName} share="morph" default="none">
            <div ref={frame} style={{ "--n": images.length } as CSSProperties}>
              <ProjectWindow
                label={`${title} — ${pad(active + 1)} / ${pad(images.length)}`}
                action={<Maximize2 aria-hidden="true" className="h-3 w-3 shrink-0" />}
              >
                <div
                  ref={viewport}
                  id={viewportId}
                  tabIndex={0}
                  aria-label={t("hint")}
                  data-gallery-viewport
                  data-lenis-prevent-horizontal
                  data-cursor-text={cursorLabel}
                  onScroll={onScroll}
                  onKeyDown={onKeyDown}
                  onClick={onClick}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  className={styles.viewport}
                >
                  {images.map((image, index) => (
                    <div
                      key={image.src}
                      role="group"
                      aria-roledescription={t("slide")}
                      aria-label={`${index + 1} / ${images.length} — ${image.caption}`}
                      aria-hidden={index !== active}
                      className={styles.slide}
                      style={{ aspectRatio }}
                    >
                      <Image
                        src={image.src}
                        unoptimized={image.src.startsWith("/api/media/")}
                        alt={image.alt}
                        fill
                        preload={index === 0}
                        sizes={projectDetailImageSizes}
                        draggable={false}
                        className="select-none object-contain"
                      />
                    </div>
                  ))}
                </div>
                <span aria-hidden="true" className={styles.progress} />
              </ProjectWindow>
            </div>
          </ViewTransition>
        </motion.div>
      </div>

      <div className="flex min-h-16 items-center justify-between gap-4 px-1 pt-4">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" aria-live="polite" aria-atomic="true">
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
            <Odometer key={active} value={pad(active + 1)} trigger="mount" duration={0.8} className="text-accent" />
            {` / ${pad(images.length)}`}
          </span>
          <ScrambleText key={current.src} text={current.caption} trigger="mount" duration={0.7} />
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-11 w-11 px-0"
            aria-label={tf("expandLabel", { index: active + 1 })}
            aria-haspopup="dialog"
            data-cursor="snap"
            onClick={() => open(active)}
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          {images.length > 1 && (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="h-11 w-11 px-0"
                aria-label={t("previous")}
                aria-controls={viewportId}
                data-cursor="snap"
                onClick={() => select(targetIndex.current - 1)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-11 w-11 px-0"
                aria-label={t("next")}
                aria-controls={viewportId}
                data-cursor="snap"
                onClick={() => select(targetIndex.current + 1)}
              >
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>

      {images.length > 1 && (
        <LayoutGroup id={viewportId}>
          <div
            className={cn("grid gap-2 sm:flex sm:flex-wrap sm:gap-3", images.length > 4 ? "grid-cols-3" : "grid-cols-4")}
            role="group"
            aria-label={t("thumbnails")}
          >
            {images.map((image, index) => (
              <button
                key={image.src}
                type="button"
                aria-label={t("show", { index: index + 1, caption: image.caption })}
                aria-pressed={active === index}
                aria-controls={viewportId}
                onClick={() => select(index)}
                className={styles.thumb}
              >
                {active === index && (
                  <motion.span
                    layoutId="gallery-thumb"
                    className={styles.thumbRing}
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative block aspect-[2/1] overflow-hidden rounded bg-bg">
                  <Image
                    src={image.src}
                    unoptimized={image.src.startsWith("/api/media/")}
                    alt=""
                    fill
                    sizes={`(min-width: 640px) 134px, ${images.length > 4 ? "33" : "25"}vw`}
                    draggable={false}
                    className="object-contain"
                  />
                </span>
                <span className="relative hidden truncate px-1 pb-1 pt-2 text-[11px] text-muted sm:block">{image.caption}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
      )}

      {viewer !== null && (
        <ProjectLightbox
          images={images}
          start={viewer}
          title={title}
          origin={origin}
          onIndexChange={(index) => select(index, true)}
          onClose={() => setViewer(null)}
        />
      )}
    </section>
  );
}
