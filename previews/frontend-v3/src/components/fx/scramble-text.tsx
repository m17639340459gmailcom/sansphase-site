"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "./hooks";
import { isCjk } from "./split";
import { useFxPlay, useFxState, type FxTriggerMode, type FxPlayOptions } from "./trigger";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/_";
const BLANK = "\u00a0";
const CJK_BLANK = "\u3000";

type ScrambleOptions = { delay?: number; duration: number };

/** Decodes `text` into the text node of `element` over `duration`; returns a cancel function. */
function scramble(element: HTMLElement | null, text: string, { delay = 0, duration }: ScrambleOptions) {
  if (!element) return () => {};
  if (!element.firstChild) element.textContent = text;
  const node = element.firstChild as Text;
  const chars = Array.from(text);
  // CJK glyphs cycle through the string's own glyphs: same width, already-loaded font slices.
  const cjkPool = chars.filter(isCjk);
  const scrambles = chars.map((char) => /[\p{L}\p{N}]/u.test(char));
  const count = Math.max(1, chars.length - 1);
  const start = performance.now() + delay * 1000;
  let frame = 0;
  let tick = 0;
  let current: string[] = chars.map((char) => (isCjk(char) ? CJK_BLANK : char === " " ? " " : BLANK));

  const render = (now: number) => {
    const progress = Math.min(1, Math.max(0, (now - start) / (duration * 1000)));
    const refresh = tick++ % 3 === 0;
    current = chars.map((char, i) => {
      if (!scrambles[i]) return char;
      const order = i / count;
      if (progress >= 0.35 + order * 0.65) return char;
      if (progress < order * 0.3) return isCjk(char) ? CJK_BLANK : BLANK;
      if (!refresh && current[i] !== BLANK && current[i] !== CJK_BLANK) return current[i];
      const pool = isCjk(char) ? cjkPool : GLYPHS;
      return pool[Math.floor(Math.random() * pool.length)];
    });
    node.nodeValue = current.join("");
    if (progress < 1) frame = requestAnimationFrame(render);
  };

  node.nodeValue = current.join("");
  frame = requestAnimationFrame(render);
  return () => {
    cancelAnimationFrame(frame);
    node.nodeValue = text;
  };
}

export type ScrambleTextProps = Omit<FxPlayOptions, "trigger"> & {
  text: string;
  /** "hover" re-decodes when the nearest link/button (or `[data-scramble-host]`) is hovered or focused. */
  trigger?: FxTriggerMode | "hover";
  as?: "span" | "p" | "div";
  delay?: number;
  /** Seconds. */
  duration?: number;
  className?: string;
};

/** Mono "decoding" text. Writes the text node inside rAF (no React state per frame). */
export function ScrambleText({
  text,
  trigger,
  as = "span",
  delay = 0,
  duration = 0.9,
  className,
  ...playOptions
}: ScrambleTextProps) {
  const Tag = as as "span";
  const ref = useRef<HTMLSpanElement>(null);
  const visual = useRef<HTMLSpanElement>(null);
  const hover = trigger === "hover";
  const reduced = usePrefersReducedMotion();
  const active = useFxPlay(ref, { ...playOptions, trigger: hover ? "mount" : trigger });
  const state = useFxState(active);

  // Layout effect: the first scrambled frame must replace the final text before paint.
  useLayoutEffect(() => {
    if (hover || !active || reduced) return;
    return scramble(visual.current, text, { delay, duration });
  }, [hover, active, reduced, text, delay, duration]);

  useEffect(() => {
    const element = ref.current;
    if (!hover || reduced || !element) return;
    const host = element.closest<HTMLElement>("a, button, [role='button'], [data-scramble-host]") ?? element;
    let cancel = () => {};
    const run = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType !== "mouse") return;
      cancel();
      cancel = scramble(visual.current, text, { duration: duration * 0.7 });
    };
    host.addEventListener("pointerenter", run);
    host.addEventListener("focusin", run);
    return () => {
      cancel();
      host.removeEventListener("pointerenter", run);
      host.removeEventListener("focusin", run);
    };
  }, [hover, reduced, text, duration]);

  return (
    <Tag
      ref={ref}
      className={cn("fx-scramble", className)}
      data-fx-state={hover ? "play" : state}
    >
      <span className="sr-only select-none">{text}</span>
      {/* Keyed: a new text gets a fresh node, so a cancelled run only ever restores its own. */}
      <span key={text} ref={visual} aria-hidden="true" className="fx-scramble-vis">
        {text}
      </span>
    </Tag>
  );
}
