// 社区背景：墨黑底上的星空（来自社区 demo）。星星闪烁、随鼠标轻微视差，偶尔划过一颗流星。
// 系统开了“减少动态效果”时只画一帧静止星空；页面隐藏时停止绘制。

type Star = { x: number; y: number; z: number; r: number; a: number; tw: number; ph: number; col: string };
type Shoot = { x: number; y: number; t0: number; dur: number; ang: number };

export interface CommunitySkyPoint {
  x: number; y: number; radius: number; opacity: number; color: string; seed: number;
}
export type CommunityStarPainter = (ctx: CanvasRenderingContext2D, point: CommunitySkyPoint, seconds: number) => void;
export interface CommunitySkyFrame {
  width: number; height: number; seconds: number;
}
export type CommunityMeteorPainter = (ctx: CanvasRenderingContext2D, frame: CommunitySkyFrame) => void;

export interface CommunitySkyOptions {
  /** Evaluate per frame so a local preview can switch candidates without remounting. */
  parallax?: () => boolean;
  /** Optional point-source renderer. Omission preserves the original sky. */
  starPainter?: () => CommunityStarPainter | undefined;
  /** Optional meteor layer. Omission preserves the original timing and drawing. */
  meteorPainter?: () => CommunityMeteorPainter | undefined;
}

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Mounts a canvas into host (the fixed page backdrop); returns the cleanup.
export function mountCommunitySky(host: HTMLElement, win: Window = window, options: CommunitySkyOptions = {}): () => void {
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
  const parallax = () => options.parallax?.() ?? true;
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  let stars: Star[] = [], w = 0, h = 0, dpr = 1;
  let shoot: Shoot | null = null, nextShoot = 2500, frame = 0, running = false;

  function resize() {
    dpr = Math.min(2, win.devicePixelRatio || 1); w = win.innerWidth; h = win.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    stars = Array.from({ length: Math.round(w * h / 4000) }, () => {
      const depth = Math.random();
      return {
        x: Math.random(), y: Math.random(), z: depth < 0.62 ? 0.25 : depth < 0.9 ? 0.6 : 1,
        r: Math.random() < 0.93 ? rand(0.25, 1) : rand(1.1, 1.9), a: rand(0.18, 0.85), tw: rand(0.4, 1.7), ph: rand(0, TAU),
        col: Math.random() < 0.14 ? '233,216,180' : Math.random() < 0.25 ? '201,214,255' : '255,255,255',
      };
    });
    if (!running) draw(0);
  }

  function draw(t: number) {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    const moving = parallax();
    if (moving) {
      mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
    } else {
      mouse.x = mouse.y = mouse.tx = mouse.ty = 0.5;
    }
    const scroll = moving ? win.scrollY : 0;
    const paintStar = options.starPainter?.();
    for (const s of stars) {
      const x = s.x * w + (mouse.x - 0.5) * -26 * s.z;
      const y = ((s.y * h - scroll * 0.05 * s.z) % h + h) % h + (mouse.y - 0.5) * -18 * s.z;
      if (paintStar) {
        paintStar(context, { x, y, radius: s.r, opacity: s.a, color: s.col, seed: s.ph * 173 + s.tw * 37 }, t * 0.001);
        continue;
      }
      const alpha = s.a * (t ? 0.55 + 0.45 * Math.sin(t * 0.001 * s.tw + s.ph) : 0.8);
      context.fillStyle = `rgba(${s.col},${alpha})`;
      context.beginPath(); context.arc(x, y, s.r, 0, TAU); context.fill();
      if (s.r > 1.2) {
        context.fillStyle = `rgba(${s.col},${alpha * 0.1})`;
        context.beginPath(); context.arc(x, y, s.r * 4.5, 0, TAU); context.fill();
      }
    }
    const paintMeteors = options.meteorPainter?.();
    if (paintMeteors) {
      paintMeteors(context, { width: w, height: h, seconds: t * 0.001 });
      return;
    }
    if (!t) return;
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
    frame = win.requestAnimationFrame(loop);
  }
  const onPointer = (event: PointerEvent) => {
    if (!parallax()) return;
    mouse.tx = event.clientX / w; mouse.ty = event.clientY / h;
  };
  const onVisible = () => { if (!doc.hidden) start(); };
  win.addEventListener('resize', resize);
  win.addEventListener('pointermove', onPointer, { passive: true });
  doc.addEventListener('visibilitychange', onVisible);
  resize();
  start();
  return () => {
    running = false;
    win.cancelAnimationFrame(frame);
    win.removeEventListener('resize', resize);
    win.removeEventListener('pointermove', onPointer);
    doc.removeEventListener('visibilitychange', onVisible);
    canvas.remove();
  };
}
