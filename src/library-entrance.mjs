import { animate } from "motion";

// Bind the staged black-hole formation timing to Motion. The scene clock
// seeks this paused timeline so loading, hidden tabs and overlays cannot consume it.
export const entranceDuration = 6;
export function createEntrance(value) {
  const controls = animate(value, 1, {
    duration: entranceDuration,
    ease: 'linear',
  });
  controls.pause();
  return controls;
}
