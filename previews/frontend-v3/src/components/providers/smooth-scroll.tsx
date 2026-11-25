"use client";

import Lenis from "lenis";
import { useEffect } from "react";
import { INTRO_EVENT } from "@/components/fx/intro-bootstrap";
import { lockScroll, setLenis, unlockScroll } from "@/components/fx/lenis";

const MODAL_OPEN = "dialog[open], [aria-modal='true']";

/**
 * Buttery wheel scrolling on desktop. Disabled for touch devices and users
 * who prefer reduced motion — native scrolling is used in those cases.
 * The instance is shared through `fx/lenis` (`getLenis`, `lockScroll`).
 */
export function SmoothScroll() {
  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!finePointer || reduced) return;

    const lenis = new Lenis({
      // Navigation can change the scroll range without resizing the viewport-height root.
      // Read the current range on each scroll request so the first wheel event uses it too.
      naiveDimensions: true,
      lerp: 0.09,
      smoothWheel: true,
      wheelMultiplier: 0.9,
      anchors: true,
    });
    setLenis(lenis);

    // A modal must also stop inertia that began before it opened.
    const syncDialogState = () => {
      if (document.querySelector(MODAL_OPEN)) lockScroll("dialog");
      else unlockScroll("dialog");
    };
    document.addEventListener("site:dialog-change", syncDialogState);
    syncDialogState();

    const syncIntroState = () => {
      const phase = document.documentElement.dataset.intro;
      if (phase === "play" || phase === "opening") lockScroll("intro");
      else unlockScroll("intro");
    };
    document.addEventListener(INTRO_EVENT, syncIntroState);
    syncIntroState();

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("site:dialog-change", syncDialogState);
      document.removeEventListener(INTRO_EVENT, syncIntroState);
      unlockScroll("dialog");
      unlockScroll("intro");
      setLenis(null);
      lenis.destroy();
    };
  }, []);

  return null;
}
