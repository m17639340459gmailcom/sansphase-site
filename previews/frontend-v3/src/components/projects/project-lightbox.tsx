"use client";

import { ExternalLink, Minus, Plus, Scan, X } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { usePrefersReducedMotion } from "@/components/fx/hooks";
import { ScrambleText } from "@/components/fx/scramble-text";
import { clamp, cn } from "@/lib/utils";
import { pad, type Box, type GalleryImage } from "./gallery-utils";
import styles from "./project-lightbox.module.css";

const MAX_ZOOM = 4;
const STEP = 1.6;
const TAP_ZOOM = 2.5;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_IN = "cubic-bezier(0.5, 0, 0.75, 0)";
const IDENTITY = { scale: 1, x: 0, y: 0 };

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
type Gesture = {
  mode: "pending" | "pan" | "swipe" | "dismiss" | "pinch" | "idle";
  id: number;
  pointerType: string;
  start: Point;
  time: number;
  view: View;
  /** Center of the current screenshot's frame when the gesture began. */
  center: Point;
  distance: number;
  mid: Point;
};

export type ProjectLightboxProps = {
  images: GalleryImage[];
  start: number;
  title: string;
  /** Where screenshot `index` sits on the page, for the open/close flight. */
  origin: (index: number) => Box | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

/**
 * Full-screen screenshot viewer (a modal <dialog>). The screenshot flies in from its place on the
 * page and back out on close; wheel/pinch zoom around the pointer, drag to pan, swipe or arrow
 * keys to switch, swipe down or Esc to close. Gestures write transforms directly (rAF), never
 * React state per frame.
 */
export function ProjectLightbox({ images, start, title, origin, onIndexChange, onClose }: ProjectLightboxProps) {
  const t = useTranslations("FX.projects.lightbox");
  const tg = useTranslations("Projects.gallery");
  const reduced = usePrefersReducedMotion();
  const labelId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const frames = useRef<(HTMLDivElement | null)[]>([]);
  const zoomers = useRef<(HTMLDivElement | null)[]>([]);
  const indexRef = useRef(start);
  const viewRef = useRef<View>(IDENTITY);
  const zoomedRef = useRef(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ time: number; point: Point } | null>(null);
  const closing = useRef(false);
  const frameRequest = useRef(0);
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const count = images.length;
  const current = images[index] ?? images[0];

  function render() {
    frameRequest.current = 0;
    const { scale, x, y } = viewRef.current;
    const layer = zoomers.current[indexRef.current];
    if (layer) layer.style.transform = scale > 1 ? `translate3d(${x}px, ${y}px, 0) scale(${scale})` : "";
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(scale * 100)}%`;
  }

  /** Keeps the zoomed screenshot covering the stage: no panning past its edges. */
  function limit(view: View): View {
    const frame = frames.current[indexRef.current];
    const stage = stageRef.current;
    const scale = clamp(view.scale, 1, MAX_ZOOM);
    if (!frame || !stage || scale <= 1.001) return IDENTITY;
    const maxX = Math.max(0, (frame.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (frame.offsetHeight * scale - stage.clientHeight) / 2);
    return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
  }

  function commit(next: View, smooth: boolean) {
    viewRef.current = limit(next);
    const layer = zoomers.current[indexRef.current];
    if (layer) layer.style.transition = smooth && !reduced ? `transform 0.45s ${EASE}` : "none";
    if (!frameRequest.current) frameRequest.current = requestAnimationFrame(render);
    const isZoomed = viewRef.current.scale > 1;
    if (isZoomed !== zoomedRef.current) {
      zoomedRef.current = isZoomed;
      setZoomed(isZoomed);
    }
  }

  /** Screenshots sit centered in the stage; its box is stable while slides or the flight animate. */
  function frameCenter(): Point {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  /** Scales about `point` so the pixel under it stays put. */
  function zoomAround(base: View, scale: number, point: Point, center: Point): View {
    const next = clamp(scale, 1, MAX_ZOOM);
    const k = next / base.scale;
    const qx = point.x - center.x;
    const qy = point.y - center.y;
    return { scale: next, x: qx - (qx - base.x) * k, y: qy - (qy - base.y) * k };
  }

  function zoomBy(factor: number, point?: Point) {
    const center = frameCenter();
    commit(zoomAround(viewRef.current, viewRef.current.scale * factor, point ?? center, center), true);
  }

  function toggleZoom(point: Point) {
    const center = frameCenter();
    commit(viewRef.current.scale > 1 ? IDENTITY : zoomAround(viewRef.current, TAP_ZOOM, point, center), true);
  }

  function placeTrack(offset = 0, animate = false) {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = animate && !reduced ? `transform 0.6s ${EASE}` : "none";
    track.style.transform = `translate3d(calc(${-indexRef.current * 100}% + ${offset}px), 0, 0)`;
  }

  function go(target: number, wrap = true) {
    if (closing.current) return;
    const next = wrap ? (target + count) % count : clamp(target, 0, count - 1);
    if (next === indexRef.current) return placeTrack(0, true);
    const previous = zoomers.current[indexRef.current];
    if (previous) {
      previous.style.transition = "none";
      previous.style.transform = "";
    }
    indexRef.current = next;
    viewRef.current = IDENTITY;
    zoomedRef.current = false;
    setZoomed(false);
    setIndex(next);
    onIndexChange(next);
    placeTrack(0, true);
    render();
  }

  function dragDismiss(dx: number, dy: number) {
    const frame = frames.current[indexRef.current];
    const pull = Math.max(0, dy);
    if (frame) {
      frame.style.transition = "none";
      frame.style.transform = `translate3d(${dx * 0.25}px, ${pull}px, 0) scale(${1 - Math.min(pull, 600) / 2400})`;
    }
    if (scrimRef.current) scrimRef.current.style.opacity = String(1 - Math.min(0.85, pull / 520));
  }

  function resetDismiss() {
    const frame = frames.current[indexRef.current];
    if (frame) {
      frame.style.transition = reduced ? "none" : `transform 0.45s ${EASE}`;
      frame.style.transform = "";
    }
    if (scrimRef.current) scrimRef.current.style.opacity = "";
  }

  function requestClose() {
    if (closing.current) return;
    closing.current = true;
    const i = indexRef.current;
    const frame = frames.current[i];
    const layer = zoomers.current[i];
    const scrim = scrimRef.current;
    if (dialogRef.current) dialogRef.current.dataset.state = "closing";
    if (reduced || !frame) return onClose();
    const from = frame.style.transform || "none";
    frame.style.transition = "none";
    frame.style.transform = "";
    if (layer) {
      layer.style.transition = "none";
      layer.style.transform = "";
    }
    const box = frame.getBoundingClientRect();
    const target = origin(i);
    scrim?.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], {
      duration: 420,
      easing: EASE_IN,
      fill: "forwards",
    });
    const flight = target
      ? frame.animate(
          [
            { transform: from },
            {
              transform: `translate3d(${target.left + target.width / 2 - (box.left + box.width / 2)}px, ${
                target.top + target.height / 2 - (box.top + box.height / 2)
              }px, 0) scale(${target.width / box.width})`,
            },
          ],
          { duration: 520, easing: EASE, fill: "forwards" },
        )
      : frame.animate(
          [
            { transform: from, opacity: 1 },
            { transform: `${from === "none" ? "" : from} scale(0.92)`, opacity: 0 },
          ],
          { duration: 280, easing: EASE_IN, fill: "forwards" },
        );
    flight.onfinish = () => onClose();
  }

  function tap(event: PointerEvent<HTMLDivElement>, pointerType: string) {
    const box = zoomers.current[indexRef.current]?.getBoundingClientRect();
    const point = { x: event.clientX, y: event.clientY };
    const inside = !!box && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
    if (!inside) return requestClose();
    if (pointerType === "mouse") return toggleZoom(point);
    const last = lastTap.current;
    const now = performance.now();
    if (last && now - last.time < 320 && Math.hypot(point.x - last.point.x, point.y - last.point.y) < 40) {
      lastTap.current = null;
      toggleZoom(point);
    } else {
      lastTap.current = { time: now, point };
    }
  }

  function beginPinch() {
    const [a, b] = [...pointers.current.values()];
    placeTrack(0, true);
    resetDismiss();
    gesture.current = {
      mode: "pinch",
      id: -1,
      pointerType: "touch",
      start: a,
      time: performance.now(),
      view: { ...viewRef.current },
      center: frameCenter(),
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (closing.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not an active pointer (synthetic input): track the gesture without capture.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) return beginPinch();
    if (pointers.current.size > 2) return;
    gesture.current = {
      mode: "pending",
      id: event.pointerId,
      pointerType: event.pointerType,
      start: { x: event.clientX, y: event.clientY },
      time: performance.now(),
      view: { ...viewRef.current },
      center: frameCenter(),
      distance: 0,
      mid: { x: 0, y: 0 },
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    if (!state || closing.current) return;
    if (state.mode === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / state.distance;
      const next = zoomAround(state.view, state.view.scale * ratio, state.mid, state.center);
      commit({ ...next, x: next.x + mid.x - state.mid.x, y: next.y + mid.y - state.mid.y }, false);
      return;
    }
    if (event.pointerId !== state.id) return;
    const dx = event.clientX - state.start.x;
    const dy = event.clientY - state.start.y;
    if (state.mode === "pending") {
      if (Math.hypot(dx, dy) < 6) return;
      if (state.view.scale > 1) state.mode = "pan";
      else if (Math.abs(dx) >= Math.abs(dy)) state.mode = "swipe";
      else state.mode = dy > 0 ? "dismiss" : "idle";
    }
    if (state.mode === "pan") {
      commit({ scale: state.view.scale, x: state.view.x + dx, y: state.view.y + dy }, false);
    } else if (state.mode === "swipe") {
      const edge = (indexRef.current === 0 && dx > 0) || (indexRef.current === count - 1 && dx < 0);
      placeTrack(edge ? dx * 0.3 : dx);
    } else if (state.mode === "dismiss") {
      dragDismiss(dx, dy);
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    if (!pointers.current.delete(event.pointerId)) return;
    const state = gesture.current;
    if (!state) return;
    if (state.mode === "pinch") {
      // One finger left: keep panning from where it rests.
      const rest = [...pointers.current.entries()][0];
      gesture.current = rest
        ? { ...state, mode: "pan", id: rest[0], start: rest[1], view: { ...viewRef.current }, time: performance.now() }
        : null;
      return;
    }
    if (event.pointerId !== state.id) return;
    gesture.current = null;
    const dx = event.clientX - state.start.x;
    const dy = event.clientY - state.start.y;
    const elapsed = Math.max(1, performance.now() - state.time);
    if (cancelled) {
      placeTrack(0, true);
      resetDismiss();
    } else if (state.mode === "pending") {
      tap(event, state.pointerType);
    } else if (state.mode === "swipe") {
      const width = stageRef.current?.clientWidth ?? window.innerWidth;
      const next = indexRef.current - Math.sign(dx);
      const fling = Math.abs(dx) > width * 0.18 || Math.abs(dx / elapsed) > 0.5;
      if (fling && next >= 0 && next < count) go(next);
      else placeTrack(0, true);
    } else if (state.mode === "dismiss") {
      if (dy > 120 || dy / elapsed > 0.6) requestClose();
      else resetDismiss();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const actions: Record<string, () => void> = {
      ArrowRight: () => go(indexRef.current + 1),
      ArrowLeft: () => go(indexRef.current - 1),
      Home: () => go(0, false),
      End: () => go(count - 1, false),
      "+": () => zoomBy(STEP),
      "=": () => zoomBy(STEP),
      "-": () => zoomBy(1 / STEP),
      "0": () => commit(IDENTITY, true),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    if (closing.current) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    const view = viewRef.current;
    if (!event.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
      if (view.scale > 1) commit({ ...view, x: view.x - dx }, false);
      return;
    }
    const center = frameCenter();
    const factor = Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.0025));
    // Wheel notches jump in big steps, so ease them; trackpad deltas stay direct.
    const notch = event.deltaMode !== 0 || (!event.ctrlKey && Math.abs(dy) >= 50);
    commit(zoomAround(view, view.scale * factor, { x: event.clientX, y: event.clientY }, center), notch);
  });

  const onResize = useEffectEvent(() => {
    placeTrack();
    commit(viewRef.current, false);
  });

  const mount = useEffectEvent(() => {
    const dialog = dialogRef.current;
    if (!dialog) return () => {};
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    document.dispatchEvent(new Event("site:dialog-change"));
    closeRef.current?.focus({ preventScroll: true });
    placeTrack();
    render();
    const frame = frames.current[start];
    const from = origin(start);
    if (frame && from && !reduced) {
      const box = frame.getBoundingClientRect();
      frame.animate(
        [
          {
            transform: `translate3d(${from.left + from.width / 2 - (box.left + box.width / 2)}px, ${
              from.top + from.height / 2 - (box.top + box.height / 2)
            }px, 0) scale(${from.width / box.width})`,
          },
          { transform: "none" },
        ],
        { duration: 640, easing: EASE },
      );
    }
    return () => {
      cancelAnimationFrame(frameRequest.current);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      document.dispatchEvent(new Event("site:dialog-change"));
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  });

  useEffect(() => mount(), []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => onWheel(event);
    const observer = new ResizeObserver(() => onResize());
    stage.addEventListener("wheel", wheel, { passive: false });
    observer.observe(stage);
    return () => {
      stage.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.children[index];
    if (!strip || !(thumb instanceof HTMLElement)) return;
    strip.scrollTo({
      left: thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2,
      behavior: reduced ? "instant" : "smooth",
    });
  }, [index, reduced]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={labelId}
      aria-describedby={hintId}
      data-state="open"
      data-lenis-prevent
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        // Closed natively (a repeated Esc can skip `cancel`): unmount without the flight. A stale
        // event from a close that was followed by a reopen (StrictMode remount) is ignored.
        if (closing.current || dialogRef.current?.open) return;
        closing.current = true;
        onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div ref={scrimRef} aria-hidden="true" className={styles.scrim} />
      <div className={styles.shell}>
        <div className={styles.toolbar}>
          <h2 id={labelId} className="sr-only">{`${t("label")} · ${title}`}</h2>
          <p className={styles.caption} aria-live="polite" aria-atomic="true">
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
              <span className="text-accent">{pad(index + 1)}</span>
              {` / ${pad(count)}`}
            </span>
            <ScrambleText key={current.src} text={current.caption} trigger="mount" duration={0.6} className="min-w-0 truncate" />
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <div role="group" aria-label={t("zoom")} className="hidden items-center gap-1.5 sm:flex">
              <button type="button" className={styles.tool} onClick={() => zoomBy(1 / STEP)} disabled={!zoomed} aria-label={t("zoomOut")}>
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span ref={zoomLabelRef} aria-hidden="true" className="w-11 text-center font-mono text-[11px] tabular-nums text-muted">
                100%
              </span>
              <button type="button" className={styles.tool} onClick={() => zoomBy(STEP)} aria-label={t("zoomIn")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" className={styles.tool} onClick={() => commit(IDENTITY, true)} disabled={!zoomed} aria-label={t("reset")}>
                <Scan className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <a
              href={current.src}
              target="_blank"
              rel="noopener noreferrer"
              title={tg("openLabel")}
              className={cn(styles.tool, styles.toolWide)}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              <span className="max-sm:sr-only">{tg("open")}</span>
            </a>
            <button ref={closeRef} type="button" className={styles.tool} onClick={requestClose} aria-label={t("close")}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          ref={stageRef}
          className={styles.stage}
          data-zoomed={zoomed ? "" : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finish(event, false)}
          onPointerCancel={(event) => finish(event, true)}
        >
          <div ref={trackRef} className={styles.track}>
            {images.map((image, i) => (
              <div
                key={image.src}
                role="group"
                aria-roledescription={tg("slide")}
                aria-label={`${i + 1} / ${count} — ${image.caption}`}
                aria-hidden={i !== index}
                className={styles.slide}
              >
                <div className={styles.layer}>
                  <div
                    ref={(node) => {
                      frames.current[i] = node;
                    }}
                    className={styles.frame}
                    style={{ "--r": image.width / image.height } as CSSProperties}
                  >
                    <div
                      ref={(node) => {
                        zoomers.current[i] = node;
                      }}
                      className={styles.zoomer}
                    >
                      <Image
                        src={image.src}
                        unoptimized={image.src.startsWith("/api/media/")}
                        alt={image.alt}
                        fill
                        sizes="100vw"
                        draggable={false}
                        loading={Math.abs(i - start) <= 1 ? "eager" : "lazy"}
                        className="select-none object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          {count > 1 && (
            <LayoutGroup id={labelId}>
              <div ref={stripRef} role="group" aria-label={tg("thumbnails")} className={styles.strip}>
                {images.map((image, i) => (
                  <button
                    key={image.src}
                    type="button"
                    aria-pressed={i === index}
                    aria-label={tg("show", { index: i + 1, caption: image.caption })}
                    onClick={() => go(i)}
                    className={styles.thumb}
                  >
                    {i === index && (
                      <motion.span
                        layoutId="lightbox-thumb"
                        className={styles.thumbRing}
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    )}
                    <Image src={image.src} alt="" fill unoptimized={image.src.startsWith("/api/media/")} sizes="96px" draggable={false} className="object-contain" />
                  </button>
                ))}
              </div>
            </LayoutGroup>
          )}
          <p id={hintId} className="max-w-xl text-center text-[11px] leading-5 text-muted max-sm:sr-only">
            {t("hint")}
          </p>
        </div>
      </div>
    </dialog>
  );
}
