import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";

export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const noopSubscribe = () => () => {};

/** Live `matchMedia` result; `serverValue` is used during SSR and hydration. */
export function useMediaQuery(query: string, serverValue = false) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}

/** True for a mouse/trackpad that can hover. Pointer-driven effects gate on this. */
export function useFinePointer() {
  return useMediaQuery(FINE_POINTER_QUERY);
}

/** True when the user asked the OS for reduced motion. */
export function usePrefersReducedMotion() {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

function subscribeVisibility(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

/** False while the tab is in the background; pause loops on it. */
export function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

/** False during SSR and the hydration render, true afterwards (and on client-only mounts). */
export function useHydrated() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export type InViewportOptions = {
  /** Skip observing entirely (no IntersectionObserver is created). */
  enabled?: boolean;
  /** Stay true after the first hit. */
  once?: boolean;
  /** Visible fraction (0-1) of the element, or of the viewport for very tall elements. */
  amount?: number;
  /** IntersectionObserver rootMargin. */
  margin?: string;
};

/** IntersectionObserver visibility that also fires for elements taller than the viewport. */
export function useInViewport(
  ref: RefObject<Element | null>,
  { enabled = true, once = true, amount = 0.2, margin = "0px" }: InViewportOptions = {},
) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const rootHeight = entry.rootBounds?.height ?? window.innerHeight;
        const visible =
          entry.isIntersecting &&
          (entry.intersectionRatio >= amount ||
            entry.intersectionRect.height >= rootHeight * Math.min(amount, 0.5));
        if (visible) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold: [0, 0.02, 0.05, 0.1, amount], rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled, once, amount, margin]);

  return inView;
}

/** Coalesces calls into one per animation frame (latest arguments win). */
export function rafThrottle<Args extends unknown[]>(callback: (...args: Args) => void) {
  let frame = 0;
  let latest: Args;
  const run = (...args: Args) => {
    latest = args;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      callback(...latest);
    });
  };
  run.cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  return run;
}
