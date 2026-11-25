"use client";

import { useRef, type CSSProperties } from "react";
import { useInViewport, usePageVisible } from "@/components/fx/hooks";
import { cn } from "@/lib/utils";
import styles from "./skills.module.css";

/**
 * Process rail above the workflow cards (desktop): the line draws in, the step nodes light up
 * in order, then a signal pulse keeps travelling along it. The loop pauses off-screen.
 */
export function FlowRail({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInViewport(ref, { once: false, amount: 0 });
  const visible = usePageVisible();

  return (
    <div
      ref={ref}
      aria-hidden
      data-paused={inView && visible ? undefined : ""}
      className={cn(styles.rail, "mb-5 hidden lg:grid")}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span className={styles.railTrack} />
      <span className={cn(styles.railFill, "fx-line")} />
      <span className={styles.packetTrack}>
        <span className={styles.packet} />
      </span>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={styles.railNode} style={{ "--i": i } as CSSProperties}>
          {String(i + 1).padStart(2, "0")}
        </span>
      ))}
    </div>
  );
}
