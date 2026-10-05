import { paintConstellation, resetConstellationFocus } from "./constellation-field.ts";
import { createCinematicBackdrop } from "./cinematic-backdrop.ts";
import type { AstralState } from "./types.ts";

/** The retained transparent constellation field; page content and sky stay intact. */
export function mountAstral(host: HTMLElement, options: { scene?: "atlas"; onError?: () => void } = {}): () => void {
  const scene = options.scene === "atlas" ? "atlas" : undefined;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable on this device.");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.astralCanvas = "true";
  canvas.style.pointerEvents = "none";
  const cleanups: Array<() => void> = [];
  let backdrop: ReturnType<typeof createCinematicBackdrop> | null = null;
  let disposed = false;
  let renderFailed = false;
  let frame = 0;

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    backdrop?.dispose();
    backdrop = null;
    resetConstellationFocus(ctx!);
    for (const cleanup of cleanups.reverse()) cleanup();
    canvas.remove();
    delete host.dataset.orbitTime;
    delete host.dataset.astralComponent;
  }

  try {
    host.dataset.astralComponent = "constellation";
    host.append(canvas);
    resetConstellationFocus(ctx);
    const landing = host.closest<HTMLElement>(".community-landing") ?? host.parentElement ?? host;
    const quietElements = ["h1", "p", ".community-landing-actions"]
      .map((selector) => landing.querySelector<HTMLElement>(selector))
      .filter((element): element is HTMLElement => element !== null);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let visible = true;
    let width = 0;
    let height = 0;
    let ratio = 1;
    let time = 0;
    let lastTime = performance.now();
    let clockActive = false;
    let lastDraw = -Infinity;
    let hover = 0;
    let pointerX: number | undefined;
    let pointerY: number | undefined;
    let pointerActive = 0;
    let touchActivationTimer: number | undefined;
    let touchCandidate: { id: number; x: number; y: number; started: number } | null = null;
    const touchPointers = new Set<number>();
    let quietDirty = true;
    let quietRects: AstralState["quietRects"] = [];

    function clearPointer() {
      if (touchActivationTimer !== undefined) window.clearTimeout(touchActivationTimer);
      touchActivationTimer = undefined;
      touchCandidate = null;
      touchPointers.clear();
      pointerX = pointerY = undefined;
      pointerActive = hover = 0;
    }
    cleanups.push(clearPointer);

    function advanceClock(now: number) {
      const elapsed = Number.isFinite(now) ? Math.max(0, (now - lastTime) / 1000) : 0;
      if (Number.isFinite(now)) lastTime = Math.max(lastTime, now);
      // Sky phase follows visible elapsed time even on a slow device. Only the
      // interaction integrator needs a bounded step to avoid abrupt hover changes.
      if (clockActive) time += elapsed;
      return Math.min(elapsed, .05);
    }
    function syncClock() {
      // Settle the previous active interval before changing its running state.
      // Frozen, hidden, offscreen and zero-sized intervals never enter sky time.
      advanceClock(performance.now());
      clockActive = !renderFailed && !reduced && visible && !document.hidden && width > 0 && height > 0;
    }

    function wake() {
      if (!disposed && !renderFailed && !frame && visible && !document.hidden && width > 0 && height > 0) {
        frame = requestAnimationFrame(draw);
      }
    }
    function measureQuietRects() {
      const base = host.getBoundingClientRect();
      quietRects = quietElements.map((element) => {
        const rect = element.getBoundingClientRect();
        const padding = element.tagName === "H1" ? 12 : 8;
        return { left: rect.left - base.left - padding, top: rect.top - base.top - padding,
          right: rect.right - base.left + padding, bottom: rect.bottom - base.top + padding };
      });
      quietDirty = false;
    }
    function resize() {
      if (disposed) return;
      const rect = host.getBoundingClientRect();
      width = Math.max(0, rect.width);
      height = Math.max(0, rect.height);
      if (!width || !height) { suspend(); return; }
      ratio = Math.min(devicePixelRatio || 1, 1.6, Math.sqrt(2_000_000 / (width * height)));
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      measureQuietRects();
      syncClock();
      lastDraw = -Infinity;
      wake();
    }
    function draw(now: number) {
      frame = 0;
      if (disposed || renderFailed || !visible || document.hidden || !width || !height) return;
      if (!reduced && now - lastDraw < 1000 / 30 - 0.6) { wake(); return; }
      const dt = advanceClock(now);
      lastDraw = now;
      const frozen = reduced;
      hover += (pointerActive - hover) * (frozen ? 1 : 1 - Math.exp(-dt * 5));
      if (quietDirty) measureQuietRects();
      const state: AstralState = {
        scene,
        width, height, time, deltaSeconds: frozen ? 0 : dt, reducedMotion: reduced,
        hover, pointerX, pointerY,
        quietRects,
      };
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx!.save();
      try {
        paintConstellation(ctx!, state);
        if (backdrop) {
          ctx!.save();
          try {
            ctx!.globalCompositeOperation = "destination-over";
            backdrop.paint(width, height, time);
          } finally {
            ctx!.restore();
          }
        }
      } catch (error) {
        renderFailed = true;
        syncClock();
        console.warn("Community sky stopped rendering.", error);
        options.onError?.();
        return;
      } finally {
        ctx!.restore();
      }
      host.dataset.orbitTime = time.toFixed(3);
      if (!reduced) wake();
    }
    if (scene === "atlas") {
      backdrop = createCinematicBackdrop(ctx, {
        onReady() { lastDraw = -Infinity; wake(); },
      });
    }
    function suspend() {
      cancelAnimationFrame(frame);
      frame = 0;
      syncClock();
      clearPointer();
    }
    function resume() {
      if (!visible || document.hidden) { suspend(); return; }
      syncClock();
      lastDraw = -Infinity;
      quietDirty = true;
      wake();
    }
    const onMotion = () => {
      reduced = motion.matches;
      resume();
    };
    function constellationPoint(event: PointerEvent) {
      if (disposed || !visible || document.hidden || !(event.target instanceof Element)) return null;
      if (event.target.closest(
        "button, a, input, textarea, select, label, summary, h1, h2, h3, h4, h5, h6, p, text, tspan, .eyebrow, [contenteditable], [role=button], [role=link], .community-landing-actions",
      )) return null;
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!rect.width || !rect.height || x < 0 || x > rect.width || y < 0 || y > rect.height) return null;
      return { x, y };
    }
    const onTouchStart = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (touchPointers.size) { touchPointers.add(event.pointerId); touchCandidate = null; return; }
      clearPointer();
      const point = constellationPoint(event);
      touchPointers.add(event.pointerId);
      if (point) touchCandidate = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now() };
      wake();
    };
    const onTouchEnd = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touchPointers.delete(event.pointerId);
      const candidate = touchCandidate;
      if (!candidate || candidate.id !== event.pointerId) return;
      touchCandidate = null;
      const point = constellationPoint(event);
      if (!point || performance.now() - candidate.started > 500 ||
        Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 8) return;
      pointerX = point.x;
      pointerY = point.y;
      pointerActive = 1;
      touchActivationTimer = window.setTimeout(() => { clearPointer(); wake(); }, 1800);
      wake();
    };
    const resetPointer = () => { clearPointer(); wake(); };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        if (touchCandidate?.id === event.pointerId &&
          Math.hypot(event.clientX - touchCandidate.x, event.clientY - touchCandidate.y) > 8) touchCandidate = null;
        return;
      }
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      const point = event.pointerType === "pen" && event.buttons > 0 ? null : constellationPoint(event);
      const previousHover = hover;
      clearPointer();
      if (point) {
        pointerX = point.x;
        pointerY = point.y;
        pointerActive = 1;
        hover = previousHover;
      }
      wake();
    };
    const onScroll = () => { quietDirty = true; clearPointer(); wake(); };
    // CSS transforms do not notify ResizeObserver; refresh hover bounds after the entrance.
    const onContentAnimationEnd = (event: Event) => {
      if (!quietElements.some(element => element === event.target)) return;
      quietDirty = true;
      wake();
    };
    landing.addEventListener("animationend", onContentAnimationEnd);
    landing.addEventListener("animationcancel", onContentAnimationEnd);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onTouchStart, { passive: true });
    window.addEventListener("pointerup", onTouchEnd, { passive: true });
    window.addEventListener("pointercancel", resetPointer, { passive: true });
    window.addEventListener("blur", resetPointer);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("pointerleave", resetPointer);
    document.addEventListener("visibilitychange", resume);
    motion.addEventListener("change", onMotion);
    cleanups.push(() => {
      landing.removeEventListener("animationend", onContentAnimationEnd);
      landing.removeEventListener("animationcancel", onContentAnimationEnd);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onTouchStart);
      window.removeEventListener("pointerup", onTouchEnd);
      window.removeEventListener("pointercancel", resetPointer);
      window.removeEventListener("blur", resetPointer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointerleave", resetPointer);
      document.removeEventListener("visibilitychange", resume);
      motion.removeEventListener("change", onMotion);
    });
    const sizes = new ResizeObserver(resize);
    cleanups.push(() => sizes.disconnect());
    sizes.observe(host);
    quietElements.forEach((element) => sizes.observe(element));
    const viewport = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? false; resume(); });
    cleanups.push(() => viewport.disconnect());
    viewport.observe(host);
    void document.fonts.ready.then(() => { if (!disposed) resize(); });
    resize();
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
