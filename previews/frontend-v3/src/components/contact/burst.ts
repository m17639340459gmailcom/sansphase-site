const COLORS = ["var(--accent)", "var(--amber)", "var(--accent-strong)", "var(--accent)", "var(--cool)"];

/**
 * One-shot particle burst from the centre of `origin` (Web Animations, no rAF loop).
 * The layer removes itself when the last particle lands. Callers skip it for reduced motion.
 */
export function burst(origin: HTMLElement, count = 30) {
  const rect = origin.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px;width:0;height:0;pointer-events:none;z-index:70`;
  document.body.append(layer);

  const flights = Array.from({ length: count }, (_, i) => {
    const particle = document.createElement("span");
    const size = 3 + Math.random() * 5;
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const distance = 46 + Math.random() * 96;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    particle.style.cssText = `position:absolute;left:${-size / 2}px;top:${-size / 2}px;width:${size}px;height:${size}px;border-radius:${i % 3 ? "50%" : "1.5px"};background:${COLORS[i % COLORS.length]}`;
    layer.append(particle);
    // Out fast, then drift down as if pulled by gravity.
    return particle.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${x * 0.85}px, ${y * 0.85}px) scale(1) rotate(${x}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${x}px, ${y + 38}px) scale(0) rotate(${x * 2}deg)`, opacity: 0 },
      ],
      { duration: 820 + Math.random() * 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
    ).finished;
  });

  Promise.allSettled(flights).then(() => layer.remove());
}
