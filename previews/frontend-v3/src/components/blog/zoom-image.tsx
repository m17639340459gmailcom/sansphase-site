"use client";

import { ArrowUpRight, Maximize2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_IN_OUT = "cubic-bezier(0.76, 0, 0.24, 1)";

type Box = { left: number; top: number; width: number; height: number };
type Zoom = { preview: string; ratio: number; width: number; height: number };

/** Largest box with the image's ratio that fits the (full-viewport) dialog, never upscaled past its pixels. */
function fitBox(area: HTMLElement, ratio: number, natural: number): Box {
  const vw = area.clientWidth;
  const vh = area.clientHeight;
  const padX = vw < 640 ? 12 : 56;
  const padY = vw < 640 ? 68 : 80;
  const width = Math.max(1, Math.min(vw - padX * 2, (vh - padY * 2) * ratio, natural || Infinity));
  const height = width / ratio;
  return { left: (vw - width) / 2, top: (vh - height) / 2, width, height };
}

/** Transform that makes `to` look like `from` (transform-origin 0 0). */
function invert(from: Box, to: Box) {
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

function applyBox(element: HTMLElement, box: Box) {
  element.style.left = `${box.left}px`;
  element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
}

/**
 * Click-to-zoom for an inline image: the picture flies (FLIP) from its place in the article to a
 * fitted, uncropped lightbox in a modal <dialog>, then back on Esc / click / scroll. Modified
 * clicks still open the original file, which is also the no-JS fallback.
 */
export function ZoomImage({
  src,
  alt,
  caption,
  children,
  className,
}: {
  /** The original file, shown at full resolution once zoomed. */
  src: string;
  alt: string;
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("FX.blog");
  const cursor = useTranslations("FX.common.cursor");
  const trigger = useRef<HTMLAnchorElement>(null);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const onClosed = useCallback(() => setZoom(null), []);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const image = trigger.current?.querySelector("img");
    if (!image) return;
    event.preventDefault();
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || rect.width;
    const height = image.naturalHeight || rect.height;
    setZoom({ preview: image.currentSrc || src, ratio: width / height, width, height });
  };

  return (
    <>
      <a
        ref={trigger}
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        aria-haspopup="dialog"
        aria-label={alt ? `${alt} · ${t("zoomImage")}` : t("zoomImage")}
        data-cursor-text={cursor("view")}
        className={cn("group/zoom relative block cursor-zoom-in", className)}
      >
        {children}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-3 grid h-9 w-9 scale-75 place-items-center rounded-full border border-line bg-bg-elevated/85 text-fg opacity-0 shadow-soft backdrop-blur transition-[opacity,scale] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-focus-visible/zoom:scale-100 group-focus-visible/zoom:opacity-100 pointer-fine:group-hover/zoom:scale-100 pointer-fine:group-hover/zoom:opacity-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </a>
      {zoom &&
        createPortal(
          <ZoomDialog trigger={trigger} zoom={zoom} src={src} alt={alt} caption={caption} onClosed={onClosed} />,
          document.body,
        )}
    </>
  );
}

function ZoomDialog({
  trigger,
  zoom,
  src,
  alt,
  caption,
  onClosed,
}: {
  trigger: RefObject<HTMLAnchorElement | null>;
  zoom: Zoom;
  src: string;
  alt: string;
  caption?: string;
  onClosed: () => void;
}) {
  const t = useTranslations("FX.blog");
  const dialog = useRef<HTMLDialogElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const node = dialog.current;
    const img = image.current;
    const back = scrim.current;
    const hud = chrome.current;
    const origin = trigger.current?.querySelector("img");
    if (!node || !img || !back || !hud || !origin) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    const saved = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    let closing = false;
    let finished = false;

    const start = origin.getBoundingClientRect();
    // Stable gutter: locking scroll must not shift the page under the flying image.
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    node.showModal();
    let box = fitBox(node, zoom.ratio, zoom.width);
    applyBox(img, box);
    closeButton.current?.focus({ preventScroll: true });
    origin.style.visibility = "hidden";
    document.dispatchEvent(new Event("site:dialog-change"));

    if (!reduced) {
      img.animate([{ transform: invert(start, box) }, { transform: "none" }], { duration: 620, easing: EASE });
      back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
      hud.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
        duration: 480,
        delay: 260,
        easing: EASE,
        fill: "backwards",
      });
    }

    if (zoom.preview !== src) {
      const full = new Image();
      full.src = src;
      full.decode().then(
        () => {
          if (!closing) img.src = src;
        },
        () => {},
      );
    }

    const restore = () => {
      if (finished) return;
      finished = true;
      origin.style.visibility = "";
      if (node.open) node.close();
      root.style.overflow = saved.overflow;
      root.style.scrollbarGutter = saved.gutter;
      document.dispatchEvent(new Event("site:dialog-change"));
    };

    const finish = () => {
      const hadFocus = node.contains(document.activeElement);
      restore();
      if (hadFocus) trigger.current?.focus({ preventScroll: true });
      onClosed();
    };

    const close = () => {
      if (closing) return;
      closing = true;
      if (reduced) {
        finish();
        return;
      }
      // Reverse from wherever the opening flight currently is.
      const current = getComputedStyle(img).transform;
      img.getAnimations().forEach((animation) => animation.cancel());
      const flight = img.animate(
        [{ transform: current === "none" ? "none" : current }, { transform: invert(origin.getBoundingClientRect(), box) }],
        { duration: 460, easing: EASE_IN_OUT, fill: "forwards" },
      );
      back.animate([{ opacity: getComputedStyle(back).opacity }, { opacity: 0 }], {
        duration: 400,
        easing: "ease-in",
        fill: "forwards",
      });
      hud.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
      flight.finished.then(finish, finish);
    };

    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    const onResize = () => {
      if (closing) return;
      box = fitBox(node, zoom.ratio, zoom.width);
      applyBox(img, box);
    };

    node.addEventListener("cancel", onCancel);
    node.addEventListener("click", close);
    node.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      node.removeEventListener("cancel", onCancel);
      node.removeEventListener("click", close);
      node.removeEventListener("wheel", close);
      window.removeEventListener("resize", onResize);
      img.getAnimations().forEach((animation) => animation.cancel());
      restore();
    };
  }, [trigger, zoom, src, onClosed]);

  return (
    <dialog
      ref={dialog}
      aria-label={alt || t("zoomImage")}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none cursor-zoom-out overflow-hidden border-0 bg-transparent p-0 text-fg backdrop:bg-transparent"
    >
      <div ref={scrim} className="absolute inset-0 bg-bg/95" />
      {/* The original file (already cached from the article preview first); next/image would re-request it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={zoom.preview}
        alt={alt}
        draggable={false}
        className="absolute left-0 top-0 max-w-none origin-top-left select-none rounded-lg border border-line shadow-[0_40px_120px_-40px_var(--accent-glow)]"
      />
      <div ref={chrome} className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 p-3 sm:p-5">
          <p className="fx-terminal flex items-center gap-2 uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {zoom.width} × {zoom.height}
          </p>
          <div className="pointer-events-auto flex items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-bg-elevated/80 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted backdrop-blur transition-colors hover:border-accent hover:text-accent"
            >
              {t("openOriginal")}
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
            <button
              ref={closeButton}
              type="button"
              aria-label={t("closeImage")}
              data-cursor="snap"
              className="grid h-11 w-11 place-items-center rounded-full border border-line bg-bg-elevated/80 text-fg backdrop-blur transition-[color,border-color,rotate] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:rotate-90 hover:border-accent hover:text-accent"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-5 pb-4 text-center sm:pb-6">
          {caption && <p className="max-w-3xl text-sm leading-6 text-muted">{caption}</p>}
          <p className="fx-terminal hidden pointer-fine:block">{t("zoomHint")}</p>
        </div>
      </div>
    </dialog>
  );
}
