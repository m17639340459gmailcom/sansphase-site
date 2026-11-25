import { REDUCED_MOTION_QUERY } from "@/components/fx/hooks";

/**
 * Easter-egg fireworks on a throwaway canvas: a burst from the viewport centre whose particles
 * swirl into the TDX mark, shimmer, then fall away as glitter while more shells pop around it.
 * Colors are read from the theme tokens at launch. Loaded on demand; skipped under reduced motion.
 */

// Same geometry as the preloader's TDX mark (viewBox 300 × 100).
const MARK = [
  "M8 8H94V27H61V92H41V27H8Z",
  "M112 8H150C184 8 204 26 204 50C204 74 184 92 150 92H112ZM131 27V73H148C171 73 184 64 184 50C184 36 171 27 148 27Z",
  "M216 8H239L256 35L273 8H296L268 50L296 92H273L256 65L239 92H216L244 50Z",
];
/** Approximate filled area of the mark in viewBox units², for an even particle density. */
const MARK_AREA = 11600;
const TAU = Math.PI * 2;
/** Share of the previous frame erased per 60 Hz frame (trail length). */
const TRAIL_FADE = 0.28;

type Spark = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
  flicker: boolean;
};

type Dust = {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  x: number;
  y: number;
  px: number;
  py: number;
  delay: number;
  flight: number;
  swirl: number;
  release: number;
  size: number;
  color: string;
  seed: number;
};

type Ring = { x: number; y: number; age: number; ttl: number; radius: number; color: string };
type Shell = { at: number; x: number; y: number; count: number; colors: string[]; power: number };

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pickFrom = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

let running = false;

export function launchFireworks() {
  if (running || window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  running = true;

  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  const accent = token("--accent");
  const amber = token("--amber") || accent;
  const cool = token("--cool") || accent;
  const strong = token("--accent-strong") || accent;
  const dark = document.documentElement.classList.contains("dark");

  // The fixed canvas box excludes a classic scrollbar; innerWidth would not.
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70";
  document.body.append(canvas);

  const cx = width / 2;
  const cy = height / 2;
  const markWidth = Math.min(width * 0.64, 580);
  const scale = markWidth / 300;
  const left = cx - markWidth / 2;
  const top = cy - (markWidth / 3) / 2;
  const unit = markWidth / 580;
  const grain = dark ? 1 : 1.15;

  // Sample the mark on a jittered grid, before any transform is set, so path and point share viewBox units.
  const paths = MARK.map((d) => new Path2D(d));
  const step = Math.sqrt(MARK_AREA / (markWidth > 420 ? 480 : 280));
  const dust: Dust[] = [];
  for (let y = 8; y <= 92; y += step) {
    for (let x = 8; x <= 296; x += step) {
      const px = x + random(-0.35, 0.35) * step;
      const py = y + random(-0.35, 0.35) * step;
      if (!paths.some((path) => ctx.isPointInPath(path, px, py, "evenodd"))) continue;
      const tx = left + px * scale;
      const ty = top + py * scale;
      const sx = cx + random(-6, 6);
      const sy = cy + random(-6, 6);
      const length = Math.hypot(tx - sx, ty - sy) || 1;
      // Dithered version of the site's accent → amber → accent-strong text gradient.
      const u = (px - 8) / 288;
      const color = Math.random() < Math.max(0, 1 - Math.abs(u - 0.6) / 0.45) ? amber : u < 0.6 ? accent : strong;
      dust.push({
        sx,
        sy,
        tx,
        ty,
        nx: -(ty - sy) / length,
        ny: (tx - sx) / length,
        x: sx,
        y: sy,
        px: sx,
        py: sy,
        delay: random(0, 0.14),
        flight: random(0.7, 0.95),
        swirl: random(40, 110) * unit * (Math.random() < 0.5 ? -1 : 1),
        release: 1.65 + u * 0.4 + random(0, 0.08),
        size: Math.max(1.3, Math.min(3, 1.6 * scale)) * grain,
        color: Math.random() < 0.04 ? cool : color,
        seed: random(0, TAU),
      });
    }
  }

  const spread = Math.min(width * 0.3, 360);
  const lift = Math.min(height * 0.24, 220);
  const shells: Shell[] = [
    { at: 0, x: cx, y: cy, count: 110, colors: [accent, amber, amber], power: 1 },
    { at: 0.42, x: cx - spread, y: cy - lift * 0.7, count: 80, colors: [amber, accent], power: 0.8 },
    { at: 0.7, x: cx + spread * 0.95, y: cy - lift, count: 80, colors: [cool, amber], power: 0.8 },
    { at: 1.2, x: cx - spread * 0.35, y: cy - lift * 1.3, count: 70, colors: [accent, cool], power: 0.7 },
    { at: 1.75, x: cx + spread * 0.55, y: cy + lift * 0.55, count: 70, colors: [amber, strong], power: 0.7 },
  ];
  const sparks: Spark[] = [];
  const rings: Ring[] = [];

  const explode = (shell: Shell) => {
    rings.push({ x: shell.x, y: shell.y, age: 0, ttl: 0.55, radius: 130 * shell.power * unit + 40, color: shell.colors[0] });
    for (let i = 0; i < shell.count; i++) {
      const angle = (i / shell.count) * TAU + random(-0.08, 0.08);
      const speed = random(140, 470) * shell.power * (0.55 + unit * 0.45);
      sparks.push({
        x: shell.x,
        y: shell.y,
        px: shell.x,
        py: shell.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        ttl: random(0.9, 1.5),
        size: random(1.4, 2.6) * grain,
        color: pickFrom(shell.colors),
        gravity: 260,
        drag: 1.9,
        flicker: Math.random() < 0.18,
      });
    }
  };

  const release = (d: Dust) =>
    sparks.push({
      x: d.x,
      y: d.y,
      px: d.x,
      py: d.y,
      vx: random(-45, 45) + (d.x - cx) * 0.35,
      vy: random(-230, -60),
      age: 0,
      ttl: random(1, 1.5),
      size: d.size,
      color: d.color,
      gravity: 560,
      drag: 1.2,
      flicker: Math.random() < 0.5,
    });

  const line = (x1: number, y1: number, x2: number, y2: number, size: number) => {
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  let frame = 0;
  const start = performance.now();
  let last = start;
  let idleSince = 0;

  const finish = () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.remove();
    running = false;
  };
  const onVisibility = () => {
    if (document.hidden) finish();
  };

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;
    while (shells.length && shells[0].at <= t) explode(shells.shift()!);

    // Erase a share of the last frame instead of clearing it: trails on a transparent canvas.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1 - Math.pow(1 - TRAIL_FADE, dt * 60);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    ctx.lineCap = "round";

    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      ring.age += dt;
      const p = ring.age / ring.ttl;
      if (p >= 1) {
        rings.splice(i, 1);
        continue;
      }
      // Thin and faint: the trail fade already smears each ring into a soft shock front.
      ctx.globalAlpha = (1 - p) * 0.4;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1.2 * (1 - p) + 0.3;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius * (0.18 + 0.82 * (1 - Math.pow(1 - p, 3))), 0, TAU);
      ctx.stroke();
    }

    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      if (t >= d.release) {
        release(d);
        dust[i] = dust[dust.length - 1];
        dust.pop();
        continue;
      }
      const local = t - d.delay;
      if (local <= 0) continue;
      const p = Math.min(1, local / d.flight);
      const eased = 1 - Math.pow(1 - p, 4);
      const arc = Math.sin(p * Math.PI) * d.swirl;
      d.px = d.x;
      d.py = d.y;
      d.x = d.sx + (d.tx - d.sx) * eased + d.nx * arc;
      d.y = d.sy + (d.ty - d.sy) * eased + d.ny * arc;
      ctx.globalAlpha = p < 1 ? 1 : 0.7 + 0.3 * Math.sin(t * 16 + d.seed);
      ctx.strokeStyle = d.color;
      ctx.fillStyle = d.color;
      if (Math.hypot(d.x - d.px, d.y - d.py) > 1) line(d.px, d.py, d.x, d.y, d.size);
      else ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age >= s.ttl) {
        sparks[i] = sparks[sparks.length - 1];
        sparks.pop();
        continue;
      }
      const damping = Math.exp(-s.drag * dt);
      s.vx *= damping;
      s.vy = s.vy * damping + s.gravity * dt;
      s.px = s.x;
      s.py = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const life = 1 - s.age / s.ttl;
      ctx.globalAlpha = life * life * (s.flicker && life < 0.55 && Math.random() < 0.45 ? 0.15 : 1);
      ctx.strokeStyle = s.color;
      line(s.px, s.py, s.x, s.y, s.size * (0.55 + 0.45 * life));
    }

    if (!shells.length && !dust.length && !sparks.length && !rings.length) {
      // Let the last trails fade out before the canvas goes.
      idleSince ||= t;
      if (t - idleSince > 0.35) return finish();
    }
    frame = requestAnimationFrame(tick);
  };

  document.addEventListener("visibilitychange", onVisibility);
  frame = requestAnimationFrame(tick);
}
