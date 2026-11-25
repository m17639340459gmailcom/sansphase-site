"use client";

import { motion, useMotionValue, useScroll, useSpring, useTransform, useVelocity, wrap } from "motion/react";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useInViewport, usePageVisible, usePrefersReducedMotion } from "./hooks";

export type VelocityMarqueeProps = {
  children: ReactNode;
  /** px per second at rest. */
  baseVelocity?: number;
  /** Start moving right instead of left. */
  reverse?: boolean;
  className?: string;
  itemClassName?: string;
  /** Ease to a stop while hovered (fine pointers). */
  pauseOnHover?: boolean;
};

/**
 * Infinite row whose speed and skew follow scroll velocity; scrolling up flips its direction.
 * Loop is seamless (extra copies are aria-hidden); pauses off-screen; static wrapped row under
 * reduced motion.
 */
export function VelocityMarquee({
  children,
  baseVelocity = 48,
  reverse = false,
  className,
  itemClassName,
  pauseOnHover = true,
}: VelocityMarqueeProps) {
  const items = Children.toArray(children);
  const root = useRef<HTMLDivElement>(null);
  const firstCopy = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(2);
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const inView = useInViewport(root, { once: false, amount: 0 });
  const running = inView && visible && !reduced;

  const { scrollY } = useScroll();
  const velocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const factor = useTransform(velocity, [0, 1000], [0, 4], { clamp: false });
  const skewX = useTransform(velocity, [-2400, 2400], [-7, 7]);
  const offset = useMotionValue(0);
  const width = useMotionValue(0);
  const x = useTransform(() => (width.get() ? wrap(-width.get(), 0, offset.get()) : 0));

  useEffect(() => {
    const container = root.current;
    const copy = firstCopy.current;
    if (!container || !copy || reduced) return;
    // ResizeObserver also reports once right after observe(), which covers the initial measure.
    const observer = new ResizeObserver(() => {
      const copyWidth = copy.getBoundingClientRect().width;
      width.set(copyWidth);
      if (copyWidth > 0) setCopies(Math.max(2, Math.ceil(container.clientWidth / copyWidth) + 1));
    });
    observer.observe(container);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [reduced, width]);

  useEffect(() => {
    const container = root.current;
    if (!running || !container) return;
    let direction = reverse ? -1 : 1;
    let speed = 1;
    let hovered = false;
    let frame = 0;
    let last = performance.now();
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") hovered = pauseOnHover;
    };
    const onLeave = () => {
      hovered = false;
    };
    const loop = (now: number) => {
      const delta = Math.min(now - last, 64);
      last = now;
      const boost = factor.get();
      if (boost < 0) direction = reverse ? 1 : -1;
      else if (boost > 0) direction = reverse ? -1 : 1;
      speed += ((hovered ? 0 : 1) - speed) * Math.min(1, delta / 180);
      const move = direction * baseVelocity * (delta / 1000) * (1 + Math.abs(boost)) * speed;
      offset.set(offset.get() - move);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    container.addEventListener("pointerenter", onEnter);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("pointerenter", onEnter);
      container.removeEventListener("pointerleave", onLeave);
    };
  }, [running, reverse, baseVelocity, pauseOnHover, factor, offset]);

  const row = (copy: number) => (
    <div
      key={copy}
      ref={copy === 0 ? firstCopy : undefined}
      className="flex shrink-0 items-center"
      aria-hidden={copy > 0 ? true : undefined}
      inert={copy > 0 ? true : undefined}
    >
      {items.map((item, i) => (
        <div key={i} className={cn("flex items-center", itemClassName)}>
          {item}
        </div>
      ))}
    </div>
  );

  if (reduced) {
    return (
      <div className={cn("relative flex w-full flex-wrap items-center justify-center", className)}>
        {items.map((item, i) => (
          <div key={i} className={cn("flex items-center", itemClassName)}>
            {item}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={root} className={cn("mask-fade-x relative flex w-full overflow-hidden", className)}>
      <motion.div className="flex w-max shrink-0 items-center will-change-transform" style={{ x, skewX }}>
        {Array.from({ length: copies }, (_, copy) => row(copy))}
      </motion.div>
    </div>
  );
}
