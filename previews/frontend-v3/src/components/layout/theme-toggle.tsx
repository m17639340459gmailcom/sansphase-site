"use client";

import { useTheme } from "next-themes";
import { useId, useRef, type MouseEvent } from "react";
import { REDUCED_MOTION_QUERY } from "@/components/fx/hooks";
import { startThemeReveal, themeRevealOrigin, type ThemeName } from "@/components/fx/theme-reveal";
import { cn } from "@/lib/utils";
import styles from "./theme-toggle.module.css";

// Clockwise from 12 o'clock, so the rays burst out in order.
const RAYS = [
  [12, 5, 12, 2.5],
  [16.95, 7.05, 18.72, 5.28],
  [19, 12, 21.5, 12],
  [16.95, 16.95, 18.72, 18.72],
  [12, 19, 12, 21.5],
  [7.05, 16.95, 5.28, 18.72],
  [5, 12, 2.5, 12],
  [7.05, 7.05, 5.28, 5.28],
];

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_IN = "cubic-bezier(0.5, 0, 0.75, 0)";
const SWING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const timing = (duration: number, delay: number, easing: string): KeyframeAnimationOptions => ({
  duration,
  delay,
  easing,
  fill: "backwards",
});

/** Rays retract and the crescent bite slides in (or the reverse); ends on the CSS resting state. */
function morph(svg: SVGSVGElement, theme: ThemeName) {
  svg.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
  const core = svg.querySelector("[data-part='core']");
  const bite = svg.querySelector("[data-part='bite']");
  const rays = svg.querySelectorAll("[data-part='ray']");
  if (theme === "dark") {
    rays.forEach((ray, i) =>
      ray.animate(
        [
          { opacity: 1, scale: 1, rotate: "0deg" },
          { opacity: 0, scale: 0.4, rotate: "-30deg" },
        ],
        timing(260, i * 18, EASE_IN),
      ),
    );
    core?.animate([{ scale: 0.5 }, { scale: 1 }], timing(640, 110, SWING));
    bite?.animate([{ translate: "8px -8px" }, { translate: "0px 0px" }], timing(640, 170, EASE));
    return;
  }
  bite?.animate([{ translate: "0px 0px" }, { translate: "8px -8px" }], timing(480, 0, EASE));
  core?.animate([{ scale: 1 }, { scale: 0.5 }], timing(480, 40, EASE));
  rays.forEach((ray, i) =>
    ray.animate(
      [
        { opacity: 0, scale: 0.3, rotate: "-30deg" },
        { opacity: 1, scale: 1, rotate: "0deg" },
      ],
      timing(520, 200 + i * 40, SWING),
    ),
  );
}

/** Sun/moon morph plus a circular theme reveal that grows from the pointer (or the button). */
export function ThemeToggle({ label, className }: { label: string; className?: string }) {
  const { setTheme } = useTheme();
  const maskId = useId();
  const icon = useRef<SVGSVGElement>(null);

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const next: ThemeName = document.documentElement.classList.contains("dark") ? "light" : "dark";
    const { x, y } = themeRevealOrigin(event);
    if (icon.current && !window.matchMedia(REDUCED_MOTION_QUERY).matches) morph(icon.current, next);
    startThemeReveal(x, y, next, setTheme);
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-cursor="snap"
      onClick={onClick}
      className={cn(
        styles.toggle,
        "relative grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-fg transition-[color,border-color,scale] duration-300 hover:border-accent hover:text-accent active:scale-90 lg:h-10 lg:w-10",
        className,
      )}
    >
      <svg ref={icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={styles.icon}>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" />
          <circle data-part="bite" className={styles.bite} cx="15.5" cy="8.5" r="8" fill="black" />
        </mask>
        <g className={styles.body} mask={`url(#${maskId})`}>
          <circle data-part="core" className={styles.core} cx="12" cy="12" r="9" fill="currentColor" />
        </g>
        <g className={styles.rays} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {RAYS.map(([x1, y1, x2, y2], i) => (
            <line key={i} data-part="ray" className={styles.ray} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
      </svg>
    </button>
  );
}
