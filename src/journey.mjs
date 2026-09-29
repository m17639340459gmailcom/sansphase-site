// A rail jump across several chapters plays as one flight, not a chain of
// them: the journey is mapped onto a single virtual step (0↔1 when the
// opening is involved, otherwise from↔from±1) and the photographs shown at
// the two virtual ends are those of the real ends. `chapterOf` converts a
// virtual chapter back to the real one; outside a jump it is the identity.
// Shared by the page controller and the WebGL layers, so it has no imports.
export function journeyStep(progress = 0, jump = null) {
  const p = Number.isFinite(progress) ? progress : 0;
  if (!jump || Math.abs(jump.to - jump.from) <= 1)
    return { virtual: p, chapterOf: (chapter) => chapter };
  const direction = Math.sign(jump.to - jump.from);
  const opening = Math.min(jump.from, jump.to) === 0;
  const from = opening ? (jump.from === 0 ? 0 : 1) : jump.from;
  const to = opening ? (jump.to === 0 ? 0 : 1) : jump.from + direction;
  const s = Math.min(1, Math.max(0, (p - jump.from) / (jump.to - jump.from)));
  return {
    virtual: from + (to - from) * s,
    chapterOf: (chapter) => (chapter === to ? jump.to : chapter === from ? jump.from : chapter),
  };
}

// Following a homepage link: the scene accelerates for DEPART_MS and sinks
// to near black, and the page opens out of that dark (any stall while the
// new page is built falls on the dark frame). 0 before, ease-in to 1.
export const DEPART_MS = 420;
export function departure(depart, now) {
  if (!depart) return 0;
  const t = Math.min(1, Math.max(0, (now - depart.at) / DEPART_MS));
  return t * t * t;
}
