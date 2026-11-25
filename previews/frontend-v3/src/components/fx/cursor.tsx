"use client";

import { useEffect, useRef } from "react";
import { rafThrottle, useFinePointer, usePrefersReducedMotion } from "./hooks";

const INTERACTIVE =
  "a[href], button:not(:disabled), [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option'], [role='switch'], summary, label[for], [data-cursor]";
/** Places where the system cursor must stay: text entry, native controls, top-layer dialogs, opt-outs. */
const NATIVE =
  "input:not([type='button']):not([type='submit']):not([type='checkbox']):not([type='radio']):not([type='range']), textarea, select, iframe, video[controls], audio[controls], dialog[open], [contenteditable]:not([contenteditable='false']), [data-cursor='native']";

const IDLE_SIZE = 30;
const LABEL_SIZE = 46;
const PRESS_SHRINK = 8;
const SNAP_PAD = 12;
/** Larger elements (cards, stages) are not framed; the frame just grows around the pointer. */
const SNAP_MAX = { width: 440, height: 180 };

type Mode = "idle" | "hover" | "label" | "native";
type Target = { mode: Mode; label: string; element: HTMLElement | null };

function resolve(target: EventTarget | null): Target {
  const node = target instanceof Element ? target : null;
  if (!node) return { mode: "idle", label: "", element: null };
  if (node.closest(NATIVE)) return { mode: "native", label: "", element: null };
  // Surfaces with their own HUD use the frame without a hover label.
  const bare = node.closest<HTMLElement>("[data-cursor='bare']");
  if (bare) return { mode: "hover", label: "", element: bare };
  const labelled = node.closest<HTMLElement>("[data-cursor-text]");
  if (labelled?.dataset.cursorText) return { mode: "label", label: labelled.dataset.cursorText, element: labelled };
  const interactive = node.closest<HTMLElement>(INTERACTIVE);
  if (interactive) return { mode: "hover", label: "", element: interactive };
  return { mode: "idle", label: "", element: null };
}

/**
 * Targeting-frame cursor: a crosshair at the pointer, four corner brackets that lock onto small
 * interactive elements, and a hover label for `data-cursor-text` targets. The
 * system cursor is hidden only while the frame is live, and comes back over text fields, selects,
 * modal dialogs and `data-cursor="native"` zones. Mounts only for fine pointers without reduced motion.
 */
export function Cursor() {
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  if (!fine || reduced) return null;
  return <CursorLayer />;
}

function CursorLayer() {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const cross = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rootEl = root.current;
    const boxEl = box.current;
    const crossEl = cross.current;
    const chipEl = chip.current;
    if (!rootEl || !boxEl || !crossEl || !chipEl) return;

    const html = document.documentElement;
    const state = { x: -100, y: -100, down: false, mode: "idle" as Mode, label: "", element: null as HTMLElement | null };
    const frame = { x: 0, y: 0, w: IDLE_SIZE, h: IDLE_SIZE };
    let shown = false;
    let raf = 0;
    let last = 0;
    let chipWidth = 0;
    let refreshTimer = 0;
    let settleTimer = 0;

    const setNative = (native: boolean) => {
      html.dataset.fxCursor = native ? "native" : "on";
    };

    const apply = (next: Target) => {
      const labelChanged = next.label !== state.label;
      state.mode = next.mode;
      state.label = next.label;
      state.element = next.element;
      rootEl.dataset.mode = next.mode;
      if (shown) setNative(next.mode === "native");
      if (labelChanged) {
        chipEl.textContent = next.label;
        chipEl.hidden = !next.label;
        chipWidth = next.label ? chipEl.offsetWidth : 0;
      }
    };

    const refresh = () => {
      if (shown) apply(resolve(document.elementFromPoint(state.x, state.y)));
    };

    const paint = (now: number) => {
      const dt = Math.min(Math.max((now - last) / 1000, 0.001), 0.05);
      last = now;

      let tx = state.x;
      let ty = state.y;
      let tw = state.down ? IDLE_SIZE - PRESS_SHRINK : IDLE_SIZE;
      let th = tw;
      let snapped = false;
      if ((state.mode === "hover" || state.mode === "label") && state.element) {
        if (!state.element.isConnected) refresh();
        const rect = state.element?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.width <= SNAP_MAX.width && rect.height <= SNAP_MAX.height) {
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          // A slight pull towards the pointer keeps the frame feeling alive on the target.
          tx = cx + (state.x - cx) * 0.08;
          ty = cy + (state.y - cy) * 0.08;
          const shrink = state.down ? PRESS_SHRINK : 0;
          tw = rect.width + SNAP_PAD - shrink;
          th = rect.height + SNAP_PAD - shrink;
          snapped = true;
        } else {
          const size = state.mode === "label" ? LABEL_SIZE : LABEL_SIZE - 6;
          tw = th = state.down ? size - PRESS_SHRINK : size;
        }
      }
      const k = 1 - Math.exp(-dt * (snapped ? 16 : 24));
      frame.x += (tx - frame.x) * k;
      frame.y += (ty - frame.y) * k;
      frame.w += (tw - frame.w) * k;
      frame.h += (th - frame.h) * k;

      boxEl.style.width = `${frame.w}px`;
      boxEl.style.height = `${frame.h}px`;
      boxEl.style.transform = `translate3d(${frame.x}px,${frame.y}px,0) translate(-50%,-50%)`;
      crossEl.style.transform = `translate3d(${state.x}px,${state.y}px,0) translate(-50%,-50%)`;

      if (state.label) {
        // Flip the label to the other side of the pointer near the viewport edges.
        const flipX = state.x + 18 + chipWidth > window.innerWidth - 8;
        const flipY = state.y + 40 > window.innerHeight - 8;
        const cx = flipX ? state.x - 18 - chipWidth : state.x + 18;
        const cy = flipY ? state.y - 34 : state.y + 22;
        chipEl.style.transform = `translate3d(${cx}px,${cy}px,0)`;
      }

      raf = shown ? requestAnimationFrame(paint) : 0;
    };

    const show = (x: number, y: number) => {
      shown = true;
      // Appear in place instead of flying in from the corner.
      frame.x = x;
      frame.y = y;
      rootEl.setAttribute("data-visible", "");
      setNative(state.mode === "native");
      last = performance.now();
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      state.x = event.clientX;
      state.y = event.clientY;
      if (!shown) {
        apply(resolve(event.target));
        show(event.clientX, event.clientY);
      }
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "mouse") apply(resolve(event.target));
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      state.down = true;
      rootEl.setAttribute("data-pressed", "");
    };
    const onUp = () => {
      state.down = false;
      rootEl.removeAttribute("data-pressed");
    };
    // Content can change under a still pointer (route changes, menus closing, scrolling).
    const onClick = () => {
      window.clearTimeout(refreshTimer);
      window.clearTimeout(settleTimer);
      refreshTimer = window.setTimeout(refresh, 150);
      settleTimer = window.setTimeout(refresh, 700);
    };
    // A modal <dialog> opening or closing under a still pointer changes who owns the cursor.
    const onDialog = () => window.setTimeout(refresh, 0);
    const onScroll = rafThrottle(refresh);
    const onOut = (event: MouseEvent) => {
      if (event.relatedTarget) return;
      shown = false;
      rootEl.removeAttribute("data-visible");
      rootEl.removeAttribute("data-pressed");
      state.down = false;
      delete html.dataset.fxCursor;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("click", onClick, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mouseout", onOut);
    document.addEventListener("site:dialog-change", onDialog);
    return () => {
      shown = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(refreshTimer);
      window.clearTimeout(settleTimer);
      onScroll.cancel();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("site:dialog-change", onDialog);
      delete html.dataset.fxCursor;
    };
  }, []);

  return (
    <div ref={root} aria-hidden="true" className="fx-cursor" data-mode="idle">
      <div ref={box} className="fx-cursor-box">
        <i className="fx-cursor-corner" data-c="tl" />
        <i className="fx-cursor-corner" data-c="tr" />
        <i className="fx-cursor-corner" data-c="bl" />
        <i className="fx-cursor-corner" data-c="br" />
      </div>
      <div ref={cross} className="fx-cursor-cross">
        <span className="fx-cursor-mark">
          <i />
        </span>
      </div>
      <div ref={chip} className="fx-cursor-chip" hidden />
    </div>
  );
}
