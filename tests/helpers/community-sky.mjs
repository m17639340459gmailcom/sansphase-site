import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const shared = await build({ entryPoints: ['src/community-sky.ts'], bundle: true, write: false, format: 'iife', globalName: '__sky' });

export function communitySkyFixture(t, code = shared.outputFiles[0].text, { reduced = false, parallax, skyOptions = {}, body = '', width = 400, height = 300, pixelRatio = 1 } = {}) {
  const dom = new JSDOM(`<div id="backdrop"></div>${body}`, { runScripts: 'outside-only' });
  const win = dom.window;
  const frames = new Map();
  const records = [];
  let nextFrame = 0;
  let hidden = false;
  let random = 417;
  let mediaReads = 0;
  const motionListeners = new Set();
  const motion = {
    get matches() { return reduced; },
    addEventListener(type, callback) { if (type === 'change') motionListeners.add(callback); },
    removeEventListener(type, callback) { if (type === 'change') motionListeners.delete(callback); },
  };
  win.Math.random = () => ((random = (random * 16807) % 2147483647) - 1) / 2147483646;
  Object.defineProperties(win, { innerWidth: { value: width, writable: true }, innerHeight: { value: height, writable: true }, devicePixelRatio: { value: pixelRatio, writable: true }, scrollY: { value: 0, writable: true } });
  Object.defineProperty(win.document, 'hidden', { get: () => hidden });
  win.matchMedia = () => { mediaReads++; return motion; };
  win.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  const drawingStates = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    lineWidth: 1,
    path: [],
    setTransform() {},
    clearRect() { records.push({ points: [], colors: [], strokes: 0, strokePaths: [], fillModes: [], cells: [] }); },
    save() { drawingStates.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalCompositeOperation: this.globalCompositeOperation, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, drawingStates.pop()); },
    beginPath() { this.path = []; },
    arc(x, y, radius) { records.at(-1).points.push([x, y, radius]); },
    fill() {
      records.at(-1).colors.push(typeof this.fillStyle === 'string' ? this.fillStyle : [...this.fillStyle.stops]);
      records.at(-1).fillModes.push(this.globalCompositeOperation);
    },
    fillRect(x, y, width, height) {
      records.at(-1).cells.push({ x, y, width, height, color: this.fillStyle, mode: this.globalCompositeOperation });
    },
    moveTo(x, y) { this.path.push(['move', x, y]); },
    lineTo(x, y) { this.path.push(['line', x, y]); },
    stroke() {
      records.at(-1).strokes += 1;
      records.at(-1).strokePaths.push({ path: [...this.path], width: this.lineWidth, style: typeof this.strokeStyle === 'string' ? this.strokeStyle : [...this.strokeStyle.stops] });
    },
    createLinearGradient() { return { stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } }; },
    createRadialGradient() { return { stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } }; },
  };
  win.HTMLCanvasElement.prototype.getContext = () => ctx;
  win.eval(`${code}\nwindow.__sky = __sky;`);
  const host = win.document.querySelector('#backdrop');
  const dispose = win.__sky.mountCommunitySky(host, win, { ...skyOptions, ...(parallax ? { parallax } : {}) });
  t.after(() => { dispose(); win.close(); });
  return {
    win, host, records, dispose,
    last: () => records.at(-1), queued: () => frames.size,
    motionListeners: () => motionListeners.size, mediaReads: () => mediaReads,
    motion(value) {
      reduced = value;
      const event = new win.Event('change');
      Object.defineProperty(event, 'matches', { value });
      for (const callback of motionListeners) callback.call(motion, event);
    },
    resize(nextWidth, nextHeight, nextRatio = win.devicePixelRatio) {
      win.innerWidth = nextWidth; win.innerHeight = nextHeight; win.devicePixelRatio = nextRatio;
      win.dispatchEvent(new win.Event('resize'));
    },
    step(time) { const batch = [...frames.values()]; frames.clear(); batch.forEach((cb) => cb(time)); },
    pointer(x, y) { const event = new win.Event('pointermove'); Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } }); win.dispatchEvent(event); },
    visible(value) { hidden = !value; win.document.dispatchEvent(new win.Event('visibilitychange')); },
  };
}
