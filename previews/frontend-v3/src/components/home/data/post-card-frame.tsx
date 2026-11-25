"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { rafThrottle, useFinePointer, usePrefersReducedMotion } from "@/components/fx/hooks";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import styles from "./post-card.module.css";

/**
 * Card link that tilts toward the pointer and feeds the spotlight (`--mx`/`--my`, px) and cover
 * parallax (`--px`/`--py`, -0.5…0.5). CSS variables only; mouse on fine pointers, no reduced motion.
 */
export function PostCardFrame({
  href,
  prefetch,
  className,
  cursorText,
  children,
}: {
  href: string;
  prefetch?: boolean;
  className?: string;
  cursorText?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const card = ref.current;
    if (!card || !fine || reduced) return;
    // Measured at rest on entry: the card itself moves while it tilts.
    let box: DOMRect | null = null;
    const paint = rafThrottle((x: number, y: number) => {
      if (!box) return;
      card.style.setProperty("--mx", `${(x - box.left).toFixed(1)}px`);
      card.style.setProperty("--my", `${(y - box.top).toFixed(1)}px`);
      card.style.setProperty("--px", ((x - box.left) / box.width - 0.5).toFixed(3));
      card.style.setProperty("--py", ((y - box.top) / box.height - 0.5).toFixed(3));
    });
    const reset = () => {
      box = null;
      paint.cancel();
      delete card.dataset.tilt;
      delete card.dataset.fxSpotActive;
      card.style.setProperty("--px", "0");
      card.style.setProperty("--py", "0");
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      box = card.getBoundingClientRect();
      card.dataset.tilt = "";
      card.dataset.fxSpotActive = "";
      paint(event.clientX, event.clientY);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || card.dataset.tilt === undefined) return;
      box ??= card.getBoundingClientRect();
      paint(event.clientX, event.clientY);
    };
    // Scrolling moves the card under a still pointer; re-measure on the next move.
    const onScroll = () => {
      box = null;
    };
    card.addEventListener("pointerenter", onEnter);
    card.addEventListener("pointermove", onMove, { passive: true });
    card.addEventListener("pointerleave", reset);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      card.removeEventListener("pointerenter", onEnter);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", reset);
      window.removeEventListener("scroll", onScroll);
      reset();
    };
  }, [fine, reduced]);

  const Destination = href.startsWith("https://") ? "a" : Link;
  return (
    <Destination ref={ref} href={href} prefetch={Destination === Link ? prefetch : undefined} data-fx-spot="" data-cursor-text={cursorText} className={cn("fx-spotlight", styles.frame, className)}>
      {children}
    </Destination>
  );
}
