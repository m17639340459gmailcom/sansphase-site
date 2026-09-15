import { animate } from "motion";

// Bind the reference site's published entry timing to Motion. The scene clock
// seeks this paused timeline so loading, hidden tabs and overlays cannot consume it.
export const entranceDuration = 5;
export function createEntrance(value) {
  const controls = animate(value, 1, {
    duration: entranceDuration,
    ease: [0.29, 0.05, 0.06, 0.92],
  });
  controls.pause();
  return controls;
}
const smooth = (x, low, high) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
export function referenceReveal(value = 1) {
  const v = Math.min(1, Math.max(0, value));
  return {
    particles: smooth(v, 0, 0.92),
    model: smooth(v, 0.5, 1),
    turn: ((210 * Math.PI) / 180) * Math.pow(1 - v, 1.2),
    lift: 0.6 * (1 - v),
    distance: 7 * (1 - v),
  };
}
