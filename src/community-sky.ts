// 社区背景：墨黑底上的星空（来自社区 demo）。星星闪烁、随鼠标轻微视差，偶尔划过一颗流星。
// 从落地页进入社区时镜头向前飞：星星从前方向四周掠过、略带拖影，到达后再减速停下。
// 系统开了“减少动态效果”时只画一帧静止星空，也没有曲速；页面隐藏时停止绘制。

type Star = { x: number; y: number; z: number; r: number; a: number; tw: number; ph: number; col: string; born: number; extra: boolean };
type Shoot = { x: number; y: number; t0: number; dur: number; ang: number };
type Point = { x: number; y: number };

// The cleanup, plus warp when the sky can animate: speed 0 (still) to 1 (full warp),
// reached over `ms`, flying out from `center` (viewport pixels).
export type CommunitySky = (() => void) & { warp?: (to: number, ms: number, center?: Point) => void };

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
// Speeding up starts gently (the landing page switches early in the flight, while it is still nearly still); slowing down ends gently.
const easeIn = (k: number) => k * k * k;
const easeOut = (k: number) => 1 - (1 - k) ** 3;

// Mounts a canvas into host (the fixed page backdrop).
export function mountCommunitySky(host: HTMLElement, win: Window = window): CommunitySky {
  const doc = host.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.className = 'community-sky';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return () => canvas.remove();
  const context = ctx;

  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  let stars: Star[] = [], w = 0, h = 0, dpr = 1;
  let shoot: Shoot | null = null, nextShoot = 2500, frame = 0, running = false, last = 0;
  // Warp: speed eases from `from` to `to` between t0 and t0 + dur; extras thicken the stream and fade out after.
  const warp = { speed: 0, from: 0, to: 0, t0: 0, dur: 1, cx: 0.5, cy: 0.45, ended: 0 };

  const star = (born = 0, extra = false): Star => {
    const depth = Math.random();
    return {
      x: Math.random(), y: Math.random(), z: depth < 0.62 ? 0.25 : depth < 0.9 ? 0.6 : 1,
      r: Math.random() < 0.93 ? rand(0.25, 1) : rand(1.1, 1.9), a: rand(0.18, 0.85), tw: rand(0.4, 1.7), ph: rand(0, TAU),
      col: Math.random() < 0.14 ? '233,216,180' : Math.random() < 0.25 ? '201,214,255' : '255,255,255', born, extra,
    };
  };
  // A star reborn far ahead while flying, anywhere once it is slowing down.
  function respawn(s: Star, t: number) {
    if (warp.to > 0) {
      const angle = rand(0, TAU), radius = rand(0.015, 0.32) * Math.min(w, h);
      s.x = warp.cx + Math.cos(angle) * radius / w; s.y = warp.cy + Math.sin(angle) * radius / h;
    } else { s.x = Math.random(); s.y = Math.random(); }
    s.born = t;
  }

  function resize() {
    dpr = Math.min(2, win.devicePixelRatio || 1); w = win.innerWidth; h = win.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    stars = Array.from({ length: Math.round(w * h / 4000) }, () => star());
    if (!running) draw(0);
  }

  function draw(t: number) {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    const dt = t && last ? Math.min(50, t - last) / 1000 : 0;
    last = t;
    if (t) warp.speed = warp.from + (warp.to - warp.from) * (warp.to > warp.from ? easeIn : easeOut)(Math.min(1, Math.max(0, (t - warp.t0) / warp.dur)));
    const v = warp.speed, cx = warp.cx * w, cy = warp.cy * h;
    // Once the warp has settled, the extra stars fade away.
    if (t && warp.to === 0 && v < 0.003 && stars.some((s) => s.extra)) {
      warp.ended ||= t;
      if (t - warp.ended > 700) { stars = stars.filter((s) => !s.extra); warp.ended = 0; }
    }
    const fadeExtra = warp.ended ? Math.max(0, 1 - (t - warp.ended) / 700) : 1;
    context.lineCap = 'round';
    const scroll = win.scrollY;
    for (const s of stars) {
      const born = s.born && t ? Math.min(1, (t - s.born) / 450) : 1;
      const fade = born * (s.extra ? fadeExtra : 1);
      if (v > 0.002) {
        // Flying forward: every star slides away from the point ahead, faster the further out it is.
        const x = s.x * w + (mouse.x - 0.5) * -26 * s.z, y = s.y * h - scroll * 0.05 * s.z + (mouse.y - 0.5) * -18 * s.z;
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
        const step = (d * (v * v * 2.8 + v * 0.3) + v * 60) * (0.45 + s.z) * dt;
        s.x += dx / d * step / w; s.y += dy / d * step / h;
        if (s.x < -0.04 || s.x > 1.04 || s.y < -0.04 || s.y > 1.04) { respawn(s, t); continue; }
        // A short trail, as a camera exposure would show it, not a drawn line.
        const length = Math.min(d * 0.3, d * v * v * 0.13 + v * 2) * (0.3 + s.z);
        const alpha = Math.min(1, s.a * (0.75 + v * 0.5)) * fade;
        // Flat strokes, no per-star gradient: cheap enough for every frame of the flight.
        context.strokeStyle = `rgba(${s.col},${alpha})`; context.lineWidth = Math.max(0.5, s.r * (1 + v * 0.6));
        context.beginPath(); context.moveTo(x, y); context.lineTo(x - dx / d * length, y - dy / d * length); context.stroke();
        continue;
      }
      const x = s.x * w + (mouse.x - 0.5) * -26 * s.z;
      const y = ((s.y * h - scroll * 0.05 * s.z) % h + h) % h + (mouse.y - 0.5) * -18 * s.z;
      const alpha = s.a * (t ? 0.55 + 0.45 * Math.sin(t * 0.001 * s.tw + s.ph) : 0.8) * fade;
      context.fillStyle = `rgba(${s.col},${alpha})`;
      context.beginPath(); context.arc(x, y, s.r, 0, TAU); context.fill();
      if (s.r > 1.2) {
        context.fillStyle = `rgba(${s.col},${alpha * 0.1})`;
        context.beginPath(); context.arc(x, y, s.r * 4.5, 0, TAU); context.fill();
      }
    }
    if (!t || v > 0.002) return;
    if (!shoot && t > nextShoot) {
      shoot = { x: rand(w * 0.35, w * 1.05), y: rand(-20, h * 0.35), t0: t, dur: rand(750, 1150), ang: rand(2.45, 2.75) };
      nextShoot = t + rand(6000, 13000);
    }
    if (shoot) {
      const k = (t - shoot.t0) / shoot.dur;
      if (k >= 1) { shoot = null; return; }
      const fade = Math.sin(Math.PI * k), px = shoot.x + Math.cos(shoot.ang) * k * 460, py = shoot.y + Math.sin(shoot.ang) * k * 460;
      const ex = px - Math.cos(shoot.ang) * 190, ey = py - Math.sin(shoot.ang) * 190;
      const tail = context.createLinearGradient(px, py, ex, ey);
      tail.addColorStop(0, `rgba(255,244,220,${0.95 * fade})`); tail.addColorStop(1, 'rgba(255,244,220,0)');
      context.strokeStyle = tail; context.lineWidth = 1.5;
      context.beginPath(); context.moveTo(px, py); context.lineTo(ex, ey); context.stroke();
    }
  }

  function loop(t: number) {
    if (!running) return;
    if (doc.hidden) { running = false; return; }
    draw(t);
    frame = win.requestAnimationFrame(loop);
  }
  function start() {
    if (running || doc.hidden) return;
    if (reduced()) { draw(0); return; }
    running = true;
    last = 0;
    frame = win.requestAnimationFrame(loop);
  }
  const onPointer = (event: PointerEvent) => { mouse.tx = event.clientX / w; mouse.ty = event.clientY / h; };
  const onVisible = () => { if (!doc.hidden) start(); };
  win.addEventListener('resize', resize);
  win.addEventListener('pointermove', onPointer, { passive: true });
  doc.addEventListener('visibilitychange', onVisible);
  resize();
  start();
  const cleanup = () => {
    running = false;
    win.cancelAnimationFrame(frame);
    win.removeEventListener('resize', resize);
    win.removeEventListener('pointermove', onPointer);
    doc.removeEventListener('visibilitychange', onVisible);
    canvas.remove();
  };
  return Object.assign(cleanup, {
    warp(to: number, ms: number, center?: Point) {
      if (reduced()) return;
      const now = win.performance.now();
      if (center && w && h) { warp.cx = center.x / w; warp.cy = center.y / h; }
      const starting = to > 0 && warp.to === 0;
      Object.assign(warp, { from: warp.speed, to: Math.max(0, Math.min(1, to)), t0: now, dur: Math.max(1, ms) });
      if (starting) {
        warp.ended = 0;
        stars.push(...Array.from({ length: Math.round(stars.length * 0.4) }, () => { const s = star(now, true); respawn(s, now); return s; }));
      }
      start();
    },
  });
}
