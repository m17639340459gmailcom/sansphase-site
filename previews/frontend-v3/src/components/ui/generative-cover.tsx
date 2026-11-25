import type { CSSProperties } from "react";
import type { Project } from "@/data/projects";
import { cn } from "@/lib/utils";

type Motif = Project["motif"];

const delay = (seconds: number) => ({ animationDelay: `${seconds.toFixed(2)}s` }) as CSSProperties;

/**
 * Procedural cover artwork: every project gets a unique, theme-aware SVG
 * composition driven by its hue + motif. No image assets to load. Each motif idles with a slow
 * CSS loop (orbiting, drifting, twinkling) under a HUD scan band; static under reduced motion,
 * and skipped entirely while off-screen.
 */
export function GenerativeCover({
  hue,
  motif,
  index,
  className,
}: {
  hue: number;
  motif: Motif;
  index: string;
  className?: string;
}) {
  const id = `cov-${motif}-${index}`;
  const c1 = `oklch(72% 0.19 ${hue + 20})`;
  const c2 = `oklch(62% 0.21 ${hue})`;
  const c3 = `oklch(80% 0.12 ${hue + 50})`;

  return (
    <div
      className={cn(
        "fx-scan relative isolate h-full w-full overflow-hidden bg-bg-elevated [content-visibility:auto] dark:bg-[#0d0f15]",
        className,
      )}
      aria-hidden
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 800 500"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id={`${id}-glow`} cx="78%" cy="18%" r="70%">
            <stop offset="0%" stopColor={c1} stopOpacity="0.9" />
            <stop offset="55%" stopColor={c2} stopOpacity="0.25" />
            <stop offset="100%" stopColor={c2} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-line`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c3} />
          </linearGradient>
          <pattern id={`${id}-grid`} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity="0.09" />
          </pattern>
        </defs>

        <rect width="800" height="500" fill={`url(#${id}-glow)`} />
        <rect width="800" height="500" fill={`url(#${id}-grid)`} className="text-fg" />

        {motif === "orbit" && (
          <g
            fill="none"
            stroke={`url(#${id}-line)`}
            strokeWidth="1.5"
            className="motion-safe:animate-[spin_64s_linear_infinite]"
            style={{ transformOrigin: "520px 250px" }}
          >
            <ellipse cx="520" cy="250" rx="240" ry="90" transform="rotate(-18 520 250)" />
            <ellipse cx="520" cy="250" rx="180" ry="66" transform="rotate(24 520 250)" opacity="0.7" />
            <ellipse cx="520" cy="250" rx="300" ry="112" transform="rotate(6 520 250)" opacity="0.4" />
            <circle cx="520" cy="250" r="34" fill={c2} stroke="none" />
            <circle cx="740" cy="180" r="7" fill={c1} stroke="none" />
            <circle cx="330" cy="330" r="5" fill={c3} stroke="none" />
          </g>
        )}

        {motif === "graph" && (
          <g>
            {[
              [160, 380], [300, 300], [420, 360], [520, 220], [640, 300], [700, 160], [360, 160], [560, 420],
            ].map(([x, y], i, arr) => (
              <g key={i}>
                {arr.slice(i + 1, i + 3).map(([x2, y2], j) => (
                  <line key={j} x1={x} y1={y} x2={x2} y2={y2} stroke={`url(#${id}-line)`} strokeWidth="1.2" opacity="0.7" />
                ))}
                <circle
                  cx={x}
                  cy={y}
                  r={i % 3 === 0 ? 10 : 6}
                  fill={i % 2 ? c1 : c3}
                  className="motion-safe:animate-pulse"
                  style={delay(i * 0.35)}
                />
              </g>
            ))}
          </g>
        )}

        {motif === "wave" && (
          <g fill="none" strokeWidth="1.6" className="motion-safe:animate-drift">
            {[0, 1, 2, 3, 4].map((i) => (
              <path
                key={i}
                d={`M-20 ${300 + i * 22} C 140 ${180 + i * 26}, 260 ${400 - i * 18}, 420 ${280 + i * 10} S 700 ${160 + i * 30}, 840 ${260 + i * 14}`}
                stroke={`url(#${id}-line)`}
                opacity={1 - i * 0.18}
              />
            ))}
          </g>
        )}

        {motif === "grid" && (
          <g>
            {Array.from({ length: 6 }).map((_, r) =>
              Array.from({ length: 9 }).map((_, c) => {
                const v = (Math.sin(r * 1.3 + c * 0.7) + 1) / 2;
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={120 + c * 64}
                    y={100 + r * 52}
                    width={44}
                    height={36}
                    rx="6"
                    fill={v > 0.6 ? c1 : v > 0.35 ? c3 : c2}
                    opacity={0.25 + v * 0.7}
                    className={v > 0.6 ? "motion-safe:animate-pulse" : undefined}
                    style={delay((r * 9 + c) * 0.13)}
                  />
                );
              }),
            )}
          </g>
        )}

        {motif === "stack" && (
          <g>
            {[0, 1, 2, 3].map((i) => (
              <path
                key={i}
                d={`M 400 ${140 + i * 58} L 620 ${230 + i * 58} L 400 ${320 + i * 58} L 180 ${230 + i * 58} Z`}
                fill={i % 2 ? c2 : c1}
                opacity={0.9 - i * 0.18}
                stroke={c3}
                strokeWidth="1"
                className="motion-safe:animate-float"
                style={delay(i * 0.45)}
              />
            ))}
          </g>
        )}

        {motif === "prism" && (
          <g>
            <polygon points="400,90 660,420 140,420" fill="none" stroke={`url(#${id}-line)`} strokeWidth="1.5" />
            <polygon points="400,170 580,400 220,400" fill={c2} opacity="0.5" />
            <polygon points="400,250 500,380 300,380" fill={c1} opacity="0.85" />
            <line x1="0" y1="330" x2="400" y2="250" stroke={c3} strokeWidth="1.2" />
            {[
              [200, c1],
              [240, c3],
              [280, c2],
            ].map(([y, color], i) => (
              <line
                key={i}
                x1="400"
                y1="250"
                x2="800"
                y2={y}
                stroke={String(color)}
                strokeWidth="1.2"
                className="motion-safe:animate-pulse"
                style={delay(i * 0.5)}
              />
            ))}
          </g>
        )}

        <text
          x="40"
          y="460"
          className="font-display"
          fontSize="120"
          fontWeight="700"
          fill="currentColor"
          fillOpacity="0.07"
        >
          {index}
        </text>
      </svg>
      <div className="noise absolute inset-0" />
    </div>
  );
}
