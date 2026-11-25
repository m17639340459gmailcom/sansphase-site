"use client";

import { useSyncExternalStore } from "react";
import { INTRO_EVENT } from "./intro-bootstrap";

/** Page motion can start as the curtains open or when the opening was skipped. */
export function getIntroDone() {
  return typeof document !== "undefined" && document.documentElement.dataset.intro !== "play";
}

function subscribeIntro(notify: () => void) {
  document.addEventListener(INTRO_EVENT, notify);
  return () => document.removeEventListener(INTRO_EVENT, notify);
}

/** False during SSR/hydration and while the intro plays; flips when the curtain opens. */
export function useIntroDone() {
  return useSyncExternalStore(subscribeIntro, getIntroDone, () => false);
}
