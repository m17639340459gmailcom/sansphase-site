"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import { rafThrottle, useFinePointer } from "./hooks";

const SpotlightGroupContext = createContext(false);

/**
 * Tracks the pointer over `ref` and writes `--mx`/`--my` (px, relative to each target) on every
 * `[data-fx-spot]` descendant, or on the element itself when it carries `data-fx-spot`.
 * Sets `data-fx-spot-active` on the host while hovered. Fine pointers only; rAF-throttled.
 */
export function useSpotlight(ref: RefObject<HTMLElement | null>, enabled = true) {
  const fine = useFinePointer();

  useEffect(() => {
    const host = ref.current;
    if (!host || !fine || !enabled) return;
    let targets: HTMLElement[] = [];
    let last: [number, number] | null = null;

    const paint = rafThrottle((x: number, y: number) => {
      const rects = targets.map((target) => target.getBoundingClientRect());
      targets.forEach((target, i) => {
        target.style.setProperty("--mx", `${(x - rects[i].left).toFixed(1)}px`);
        target.style.setProperty("--my", `${(y - rects[i].top).toFixed(1)}px`);
      });
    });
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      targets = [
        ...(host.hasAttribute("data-fx-spot") ? [host] : []),
        ...host.querySelectorAll<HTMLElement>("[data-fx-spot]"),
      ];
      host.dataset.fxSpotActive = "";
      last = [event.clientX, event.clientY];
      paint(event.clientX, event.clientY);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !last) return;
      last = [event.clientX, event.clientY];
      paint(event.clientX, event.clientY);
    };
    const onLeave = () => {
      last = null;
      delete host.dataset.fxSpotActive;
    };
    // Smooth scrolling moves targets under a still pointer.
    const onScroll = () => {
      if (last) paint(last[0], last[1]);
    };

    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      paint.cancel();
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      delete host.dataset.fxSpotActive;
    };
  }, [ref, fine, enabled]);
}

type PolymorphicProps<T extends ElementType> = {
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/** One pointer listener for a set of `SpotlightCard`s (or any `[data-fx-spot]` element). */
export function SpotlightGroup<T extends ElementType = "div">({ as, className, children, ...rest }: PolymorphicProps<T>) {
  const Tag = (as ?? "div") as "div";
  const ref = useRef<HTMLDivElement>(null);
  useSpotlight(ref);
  return (
    <SpotlightGroupContext.Provider value={true}>
      <Tag ref={ref} className={className} {...rest}>
        {children}
      </Tag>
    </SpotlightGroupContext.Provider>
  );
}

/**
 * Card with a cursor-proximity border glow and a soft inner light (`fx-spotlight`).
 * Inside a `SpotlightGroup` neighbours light up as the pointer approaches; alone it tracks itself.
 */
export function SpotlightCard<T extends ElementType = "div">({ as, className, children, ...rest }: PolymorphicProps<T>) {
  const Tag = (as ?? "div") as "div";
  const ref = useRef<HTMLDivElement>(null);
  const inGroup = useContext(SpotlightGroupContext);
  useSpotlight(ref, !inGroup);
  return (
    <Tag ref={ref} data-fx-spot="" className={cn("fx-spotlight relative", className)} {...rest}>
      {children}
    </Tag>
  );
}
