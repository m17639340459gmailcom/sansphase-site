const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const COLORS = ["var(--accent)", "var(--amber)", "var(--accent-strong)"];

type BurstOptions = {
  /** Number of sparks. */
  count?: number;
  /** Travel distance in px. */
  radius?: number;
  /** Expanding ring behind the sparks. */
  ring?: boolean;
};

/**
 * Success burst from the centre of `origin`: radial sparks and dots plus a shock ring.
 * Plain DOM + WAAPI on a fixed layer that removes itself; a no-op under reduced motion.
 */
export function burst(origin: Element | null, { count = 14, radius = 46, ring = true }: BurstOptions = {}) {
  if (!origin || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { left, top, width, height } = origin.getBoundingClientRect();
  const layer = document.createElement("span");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${left + width / 2}px;top:${top + height / 2}px;z-index:90;pointer-events:none`;
  let longest = 0;

  if (ring) {
    const shock = document.createElement("span");
    shock.style.cssText =
      "position:absolute;left:-8px;top:-8px;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--accent)";
    shock.animate(
      [
        { transform: "scale(0.3)", opacity: 0.9 },
        { transform: `scale(${(radius / 8).toFixed(2)})`, opacity: 0 },
      ],
      { duration: 640, easing: EASE, fill: "forwards" },
    );
    layer.append(shock);
    longest = 640;
  }

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
    const distance = radius * (0.6 + Math.random() * 0.6);
    const streak = i % 3 !== 0;
    const w = streak ? 2 : 5;
    const h = streak ? 10 : 5;
    const spin = `rotate(${(angle + Math.PI / 2).toFixed(3)}rad)`;
    const duration = 560 + Math.random() * 280;
    const spark = document.createElement("span");
    spark.style.cssText = `position:absolute;left:${-w / 2}px;top:${-h / 2}px;width:${w}px;height:${h}px;border-radius:999px;background:${COLORS[i % COLORS.length]}`;
    spark.animate(
      [
        { transform: `translate(0, 0) ${spin} scale(1)`, opacity: 1 },
        {
          transform: `translate(${(Math.cos(angle) * distance).toFixed(1)}px, ${(Math.sin(angle) * distance).toFixed(1)}px) ${spin} scale(0.2)`,
          opacity: 0,
        },
      ],
      { duration, easing: EASE, fill: "forwards" },
    );
    layer.append(spark);
    longest = Math.max(longest, duration);
  }

  document.body.append(layer);
  window.setTimeout(() => layer.remove(), longest + 80);
}
