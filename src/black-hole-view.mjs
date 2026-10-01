// Chapter 0 is a black hole; the first scroll dives through its horizon into
// chapter 1. Every value is a pure function of the shared 0..3 progress, so
// the renderer, the page copy and the descent readout stay in step forwards
// and in reverse. Distances are in Schwarzschild radii (Rs).
const smooth = (low, high, x) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

export function blackHoleView(progress = 0, { portrait = false } = {}) {
  const p = Math.min(1, Math.max(0, finite(progress)));
  const approach = smooth(0, 0.35, p),
    plunge = smooth(0.35, 0.86, p);
  // Formation takes place at the final framing; scrolling owns the dolly.
  const distance = 14 - 6 * approach - 6 * plunge;
  // A dolly zoom: the lens widens while the camera closes in.
  // Leave a little more sky around the opening without changing its orbit.
  // Rejoin the existing lens before the plunge, in either scroll direction.
  const openingFraming = 0.9 + 0.1 * approach;
  const focal = ((1.8 * (14 - 6 * approach)) / 14) * openingFraming;
  const centre = smooth(0.1, 0.6, p);
  return {
    progress: p,
    distance,
    focal,
    fov: (2 * Math.atan(1.6 / focal) * 180) / Math.PI,
    tilt: ((4.3 + 24 * smooth(0.05, 0.6, p)) * Math.PI) / 180,
    azimuth: 0.42 + 0.6 * plunge,
    // Gravitational time dilation for a static observer at this radius.
    timeRate: Math.sqrt(Math.max(0.05, 1 - 1 / distance)),
    blackout: smooth(0.78, 0.9, p),
    emerge: smooth(0.88, 1, p),
    readout: smooth(0.01, 0.08, p) * (1 - smooth(0.86, 0.95, p)),
    centerX: portrait ? 0.5 : 0.68 - 0.18 * centre,
    centerY: portrait ? 0.64 - 0.14 * centre : 0.5,
    visible: finite(progress) < 1,
  };
}

export function descentReadout(view, english = false) {
  const r = view.distance.toFixed(1),
    rate = view.timeRate.toFixed(2),
    fov = Math.round(view.fov);
  return english
    ? `r ${r} Rs · time rate ${rate}× · FOV ${fov}°`
    : `r ${r} Rs · 时间流速 ${rate}× · 视场 ${fov}°`;
}
