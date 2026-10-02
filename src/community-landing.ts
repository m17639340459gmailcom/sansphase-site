// 社区落地页：背后是一张三维的星座网络。星点分布在一个缓慢绕竖轴转动的空间里，
// 每颗星与离它最近的两颗连成细线，连线慢慢亮起又熄灭。不跟随指针。
// 点“进入社区”或某个版块时，文字散开，镜头向前穿过网络、背景星星掠过。网络和星空都在
// 全站背景层里，换页不会打断它们：飞行刚起步、画面几乎静止时就切到社区，让首次排版的
// 那一下停顿落在看不出来的时刻；社区页先藏着，飞行结束时网络淡去、社区页淡入（arriveCommunity）。
// 数据在点下去时就开始加载。不用光晕或闪白。
// 没有画布星空或开了“减少动态效果”时，网络只画一帧，链接照常跳转。
import type { CommunitySky } from './community-sky.ts';

type Sky = Pick<CommunitySky, 'warp'> | null;
type LandingOptions = { backdrop: HTMLElement; sky: () => Sky; go: (href: string) => void; prefetch?: (href: string) => void; win?: Window };
type Network = ReturnType<typeof mountConstellation>;
type Node3 = { x: number; y: number; z: number; b: number; ph: number; col: string };
type Point = { X: number; Y: number; depth: number; node: Node3 };

// The whole flight, and when within it the community page takes over (hidden until the flight ends).
export const COMMUNITY_DEPART_MS = 1250;
export const COMMUNITY_SWITCH_MS = 520;
const ARRIVE_MS = 1700;
const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeIn = (k: number) => k * k * k;

// The network: a cylinder of stars (radius 1 around the vertical axis) seen from CAMERA away,
// drawn in the page backdrop. Returns how to fly forward through it, fade it, and the cleanup.
function mountConstellation(backdrop: HTMLElement, win: Window) {
  const doc = backdrop.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.className = 'community-network';
  canvas.setAttribute('aria-hidden', 'true');
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return { fly: () => {}, fade: () => {}, stop: () => {} };
  const context = ctx;
  backdrop.append(canvas);

  const CAMERA = 2.3;
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  let w = 0, h = 0, dpr = 1, focal = 1, nodes: Node3[] = [];
  let yaw = 0, travel = 0, born = 0, last = 0, frame = 0, running = false;
  const flight = { from: 0, to: 0, t0: 0, dur: 1, speed: 0 };
  // A soft glow drawn once and reused for every star.
  const glow = doc.createElement('canvas');
  glow.width = glow.height = 64;
  const g = glow.getContext('2d');
  if (g) {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,240,215,1)'); gradient.addColorStop(1, 'rgba(255,240,215,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, 64, 64);
  }

  function resize() {
    dpr = Math.min(2, win.devicePixelRatio || 1); w = win.innerWidth; h = win.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    // The cylinder's sides reach just past the screen edges at the camera distance.
    focal = 1.1 * (w / 2) * CAMERA;
    const height = 1.15 * (h / 2) * CAMERA / focal;
    nodes = Array.from({ length: Math.min(230, Math.round(80 * (1 + height))) }, () => {
      const angle = rand(0, TAU), radius = Math.sqrt(Math.random());
      const tint = Math.random();
      return {
        x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, y: rand(-height, height),
        b: Math.random() < 0.12 ? rand(0.8, 1) : rand(0.3, 0.7), ph: rand(0, TAU),
        col: tint < 0.2 ? '255,222,180' : tint < 0.45 ? '205,220,255' : '245,245,255',
      };
    });
    if (!running) draw(0);
  }

  function draw(t: number) {
    const dt = t && last ? Math.min(50, t - last) / 1000 : 0;
    last = t;
    if (t) flight.speed = flight.from + (flight.to - flight.from) * easeIn(Math.min(1, Math.max(0, (t - flight.t0) / flight.dur)));
    const v = flight.speed;
    yaw += (0.022 + v * 0.25) * dt;
    travel += v * v * 3.4 * dt;
    // Lines draw in over the first seconds; a still frame shows them complete.
    const intro = t ? Math.min(1, (t - born) / 2600) : 1;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);

    const cos = Math.cos(yaw), sin = Math.sin(yaw), points: Point[] = [];
    for (const node of nodes) {
      const x = node.x * cos - node.z * sin;
      // Flying forward: stars that pass the camera come round again far ahead.
      const z = ((node.x * sin + node.z * cos - travel + 1) % 2 + 2) % 2 - 1;
      const depth = z + CAMERA;
      if (depth < 0.25) continue;
      points.push({ X: w / 2 + x * focal / depth, Y: h / 2 + node.y * focal / depth, depth, node });
    }

    // Constellation lines: each star to its two nearest neighbours in space, if close enough.
    const reach = 0.55 * focal / CAMERA, limit = reach * reach;
    context.lineCap = 'round';
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      let n1 = -1, d1 = Infinity, n2 = -1, d2 = Infinity;
      for (let j = 0; j < points.length; j++) {
        if (j === i) continue;
        const b = points[j];
        const d = (a.X - b.X) ** 2 + (a.Y - b.Y) ** 2 + ((a.depth - b.depth) * focal / CAMERA) ** 2;
        if (d < d1) { n2 = n1; d2 = d1; n1 = j; d1 = d; } else if (d < d2) { n2 = j; d2 = d; }
      }
      for (const [j, dd] of [[n1, d1], [n2, d2]] as const) {
        if (j < i || dd > limit) continue;
        const b = points[j];
        const pulse = t ? 0.55 + 0.45 * Math.sin(t * 0.0005 + a.node.ph + b.node.ph) : 0.8;
        const near = Math.min(1, 1.6 * CAMERA / (a.depth + b.depth));
        const alpha = (1 - Math.sqrt(dd) / reach) * 0.42 * pulse * near * intro * (1 + v * 1.5);
        context.strokeStyle = `rgba(217,196,156,${Math.min(0.9, alpha)})`;
        context.lineWidth = 0.7 + v * 0.8;
        context.beginPath(); context.moveTo(a.X, a.Y); context.lineTo(b.X, b.Y); context.stroke();
      }
    }
    for (const { X, Y, depth, node } of points) {
      const r = Math.min(6, Math.max(0.5, node.b * 2.4 * CAMERA / depth / 1.6));
      const twinkle = t ? 0.75 + 0.25 * Math.sin(t * 0.002 + node.ph) : 0.9;
      const shown = Math.min(1, intro * 1.6);
      context.globalAlpha = 0.35 * node.b * twinkle * shown;
      context.drawImage(glow, X - r * 6, Y - r * 6, r * 12, r * 12);
      context.globalAlpha = 1;
      context.fillStyle = `rgba(${node.col},${Math.min(1, node.b * twinkle * 1.1 * shown)})`;
      context.beginPath(); context.arc(X, Y, r, 0, TAU); context.fill();
    }
  }

  function loop(t: number) {
    if (!running) return;
    if (doc.hidden || !canvas.isConnected) { running = false; return; }
    born ||= t;
    draw(t);
    frame = win.requestAnimationFrame(loop);
  }
  function start() {
    if (running || doc.hidden) return;
    if (reduced()) { draw(0); return; }
    running = true; last = 0;
    frame = win.requestAnimationFrame(loop);
  }
  const onVisible = () => { if (!doc.hidden) start(); };
  win.addEventListener('resize', resize);
  doc.addEventListener('visibilitychange', onVisible);
  resize();
  start();
  return {
    fly(ms: number) {
      Object.assign(flight, { from: flight.speed, to: 1, t0: win.performance.now(), dur: Math.max(1, ms) });
    },
    fade() { canvas.classList.add('is-fading'); },
    stop() {
      running = false;
      win.cancelAnimationFrame(frame);
      win.removeEventListener('resize', resize);
      doc.removeEventListener('visibilitychange', onVisible);
      canvas.remove();
    },
  };
}

// A flight that has already switched to the community page; the arrival finishes it.
let flying: { network: Network; ends: number } | null = null;

export function mountCommunityLanding(section: HTMLElement, { backdrop, sky, go, prefetch, win = window }: LandingOptions): () => void {
  const doc = section.ownerDocument;
  const reduced = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const network = mountConstellation(backdrop, win);
  let timer: ReturnType<typeof setTimeout> | undefined, handedOver = false;

  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.<HTMLAnchorElement>('a[href^="#/community/"]');
    const warp = sky()?.warp;
    if (!link || !warp || reduced() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (timer || handedOver) return;
    const href = link.getAttribute('href') || '#/community/home';
    prefetch?.(href);
    doc.body.classList.add('community-warping');
    section.classList.add('is-warping');
    network.fly(COMMUNITY_DEPART_MS);
    warp(1, COMMUNITY_DEPART_MS, { x: win.innerWidth / 2, y: win.innerHeight / 2 });
    const ends = win.performance.now() + COMMUNITY_DEPART_MS;
    timer = setTimeout(() => { timer = undefined; handedOver = true; flying = { network, ends }; go(href); }, COMMUNITY_SWITCH_MS);
  };

  section.addEventListener('click', onClick);
  return () => {
    section.removeEventListener('click', onClick);
    // The flight carries on over the community page; the arrival stops the network.
    if (handedOver) return;
    network.stop();
    // Left the landing page some other way before the switch: drop out of warp here.
    if (timer) {
      clearTimeout(timer); timer = undefined;
      doc.body.classList.remove('community-warping');
      sky()?.warp?.(0, 400);
    }
  };
}

// Called once the community page is in place (still hidden). When the flight ends, the
// network fades, the sky slows down and the page fades in. Returns false when no flight was under way.
export function arriveCommunity(doc: Document, sky: Sky, win: Window = doc.defaultView || window): boolean {
  const body = doc.body;
  if (!body.classList.contains('community-warping')) return false;
  const flight = flying;
  flying = null;
  body.classList.add('community-switched');
  setTimeout(() => {
    body.classList.remove('community-warping', 'community-switched');
    body.classList.add('community-arriving');
    flight?.network.fade();
    sky?.warp?.(0, ARRIVE_MS);
    setTimeout(() => { body.classList.remove('community-arriving'); flight?.network.stop(); }, ARRIVE_MS);
  }, Math.max(0, (flight?.ends ?? 0) - win.performance.now()));
  return true;
}
