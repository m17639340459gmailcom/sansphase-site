"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import { useHydrated, useInViewport } from "./hooks";
import { useIntroDone } from "./intro-store";

export type FxTriggerMode = "mount" | "inView";
/** SSR/hydration render, mounted but waiting, or playing. Mirrors `data-fx-state`. */
export type FxState = "ssr" | "idle" | "play";

export type FxPlayOptions = {
  /** Own trigger; omit to follow the nearest <FxTrigger> (or "inView" when there is none). */
  trigger?: FxTriggerMode;
  /** Explicit gate (e.g. `play={introDone}`); overrides `trigger` and any group. */
  play?: boolean;
  once?: boolean;
  amount?: number;
  margin?: string;
};

const FxGroupContext = createContext<boolean | null>(null);

/** Resolves true after a two-frame delay, so the hidden state is painted before CSS takes over. */
function useArmed(ready: boolean) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [ready]);
  return ready && armed;
}

/**
 * Shared trigger logic for every FX primitive: waits for the intro curtain,
 * then plays on mount, when scrolled into view, with its group, or when `play` flips.
 */
export function useFxPlay(ref: RefObject<Element | null>, options: FxPlayOptions = {}, inherit = true) {
  // No negative bottom margin: content resting at the very end of a page must still trigger.
  const { trigger, play, once = true, amount = 0.2, margin = "0px" } = options;
  const group = useContext(FxGroupContext);
  const introDone = useIntroDone();
  const followGroup = inherit && play === undefined && trigger === undefined && group !== null;
  const mode = trigger ?? "inView";
  const observe = play === undefined && !followGroup && mode === "inView";
  const inView = useInViewport(ref, { enabled: observe, once, amount, margin });

  const ready = play ?? (mode === "mount" || inView);
  const armed = useArmed(introDone && ready && !followGroup);
  // The group is already armed and intro-gated.
  return followGroup ? group === true : armed;
}

/** `data-fx-state` value for a primitive. */
export function useFxState(active: boolean): FxState {
  const hydrated = useHydrated();
  if (!hydrated) return "ssr";
  return active ? "play" : "idle";
}

type FxTriggerProps<T extends ElementType> = FxPlayOptions & {
  as?: T;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children" | keyof FxPlayOptions>;

/**
 * Plays every FX primitive inside it together (one observer for the whole group) and exposes
 * `data-fx-state` plus the Tailwind group name `group/fx` for custom CSS, e.g.
 * `group-data-[fx-state=play]/fx:opacity-100`.
 */
export function FxTrigger<T extends ElementType = "div">({
  as,
  className,
  children,
  trigger = "inView",
  play,
  once,
  amount,
  margin,
  ...rest
}: FxTriggerProps<T>) {
  // Typed as div for JSX; the rendered tag is whatever `as` names.
  const Tag = (as ?? "div") as "div";
  const ref = useRef<HTMLDivElement>(null);
  const active = useFxPlay(ref, { trigger, play, once, amount, margin }, false);
  const state = useFxState(active);
  return (
    <FxGroupContext.Provider value={active}>
      <Tag ref={ref} className={cn("group/fx", className)} data-fx-state={state} {...rest}>
        {children}
      </Tag>
    </FxGroupContext.Provider>
  );
}
