// The loading dial is shared by the static boot screen (substituted into
// index.html at build time) and the homepage loader, so the hand-over between
// them does not show. Its tick scale is also the chapter reticle's.

// A 10° scale, longer every 30°, around the centre of a 200 × 200 view box.
export const reticleScale = Array.from({ length: 36 }, (_, i) => {
  const a = (i * Math.PI) / 18,
    inner = i % 3 ? 80 : 74,
    point = (r) => `${(100 + r * Math.sin(a)).toFixed(2)} ${(100 - r * Math.cos(a)).toFixed(2)}`;
  return `M${point(inner)}L${point(86)}`;
}).join("");

// A gold ring fills with progress (--load, 0..1, set on an ancestor) inside
// the slowly turning scale; a comet circles the orbit so the page reads as
// working even while progress waits on one large file.
export const loaderDial =
  `<span class="loader-dial" aria-hidden="true">` +
  `<svg class="dial-scale" viewBox="0 0 200 200" focusable="false"><circle cx="100" cy="100" r="93"></circle><path d="${reticleScale}"></path></svg>` +
  `<svg class="dial-arc" viewBox="0 0 200 200" focusable="false"><circle class="dial-arc-track" cx="100" cy="100" r="62" pathLength="1"></circle><circle class="dial-arc-fill" cx="100" cy="100" r="62" pathLength="1"></circle></svg>` +
  `<span class="dial-comet"></span>` +
  `<span class="dial-mark">無相<small>SANSPHASE</small></span>` +
  `</span>`;
