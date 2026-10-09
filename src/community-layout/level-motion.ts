// Only approved, same-origin level and staff artwork is enhanced. Static images remain
// the fallback; animation never changes their source or the surrounding layout.
import { communityStaffArtSource } from '../community-staff-art.mjs';

const markSelector = '.community-level-marks [data-level-icon], .community-staff-art[data-staff-art], .community-staff-frame[data-staff-art]';
const approvedSlug = /^(?:constellation-g(?:[1-9]|10)|trust-l[0-3]|vip-[1-8])$/;
const approvedStaffSlug = /^(?:badge|frame)-(?:assistant|moderator|general)$/;
const svgNamespace = 'http://www.w3.org/2000/svg';
const svgElements = new Set(['svg', 'style', 'defs', 'linearGradient', 'stop', 'radialGradient', 'clipPath', 'circle', 'g', 'ellipse', 'path', 'rect', 'filter', 'feGaussianBlur', 'feDiffuseLighting', 'feDistantLight', 'feComposite', 'feSpecularLighting', 'feTurbulence', 'feColorMatrix']);
const staffSvgElements = new Set([...svgElements, 'image', 'use', 'mask']);
const maxArtworkBytes = 128 * 1024;
const maxStaffArtworkBytes = 160 * 1024;
const warmOffscreenMax = 18;
const playbackStyle = `:host { display: block; width: 100%; height: 100%; }
svg { display: block; width: 100%; height: 100%; }
:host svg[data-level-motion-svg], :host svg[data-level-motion-svg] * { animation-play-state: var(--community-level-play-state, paused); }`;

type ArtworkKind = 'levels' | 'staff';
type Mark = { element: HTMLElement; kind: ArtworkKind; slug: string; visible: boolean; lastVisible: number; pending: boolean; template: Element | null; canvas: HTMLElement | null };
type MotionController = { pause: () => void; resume: () => void; release: () => void };

/** Compare application markup without this module's reversible enhancement. */
export function levelMotionMarkup(element: Element): string {
  if (!element.querySelector('[data-level-motion-ready]')) return element.outerHTML;
  const copy = element.cloneNode(true) as Element;
  for (const mark of copy.querySelectorAll('[data-level-motion-ready]')) {
    mark.querySelector(':scope > .community-level-motion-canvas')?.remove();
    mark.removeAttribute('data-level-motion-ready');
  }
  return copy.outerHTML;
}

/** Preserve original CSS animations in an isolated tree with shared scroll control. */
export function createCommunityLevelMotion(document: Document, request?: typeof fetch): MotionController {
  const window = document.defaultView;
  const fetcher = request ?? window?.fetch?.bind(window);
  if (!window?.IntersectionObserver || !window.MutationObserver || !fetcher) return { pause() {}, resume() {}, release() {} };
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const marks = new Map<HTMLElement, Mark>();
  const templates = new Map<string, Promise<Element>>();
  const lifetime = new AbortController();
  let paused = false;
  let released = false;
  let visibilityOrder = 0;
  const eligible = (mark: Mark) => !released && mark.visible && !paused && !document.hidden && !motion?.matches && mark.element.isConnected;
  const validate = (body: string, kind: ArtworkKind): Element => {
    const parsed = new window.DOMParser().parseFromString(body, 'image/svg+xml');
    const svg = parsed.documentElement;
    if (parsed.querySelector('parsererror') || svg.localName !== 'svg' || svg.namespaceURI !== svgNamespace) throw Error('Invalid level artwork');
    const allowedElements = kind === 'staff' ? staffSvgElements : svgElements;
    const localShapes = new Map([...svg.querySelectorAll('[id]')].map(element => [element.id, element]));
    const checkStaffHref = (element: Element, attribute: Attr) => {
      if (attribute.name !== 'href' || attribute.namespaceURI !== null) throw Error('Unexpected staff artwork reference');
      if (element.localName === 'image' && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(attribute.value)) {
        const encoded = attribute.value.slice('data:image/webp;base64,'.length);
        const bitmap = window.atob(encoded);
        if (bitmap.slice(0, 4) === 'RIFF' && bitmap.slice(8, 12) === 'WEBP') return;
      }
      if (element.localName === 'use' && /^#[\w-]+$/.test(attribute.value)) {
        const target = localShapes.get(attribute.value.slice(1));
        // The submitted artwork reuses only inert image and path shapes.
        // Referencing other use/group nodes could introduce recursive trees.
        if (target?.localName === 'image' || target?.localName === 'path') return;
      }
      throw Error('External staff artwork reference');
    };
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      if (element.namespaceURI !== svgNamespace || !allowedElements.has(element.localName)) throw Error('Unexpected level artwork element');
      for (const attribute of element.attributes) {
        if (/^on/i.test(attribute.name)) throw Error('Active level artwork attribute');
        if (/href$/i.test(attribute.name)) {
          if (kind !== 'staff') throw Error('Active level artwork attribute');
          checkStaffHref(element, attribute);
        }
        checkReferences(attribute.value);
      }
      if (element.localName === 'style') checkReferences(element.textContent || '');
    }
    return svg;
  };
  const removeCanvas = (mark: Mark) => {
    mark.canvas?.remove(); mark.canvas = null;
    mark.element.removeAttribute('data-level-motion-ready');
  };
  const trimOffscreen = () => {
    if (paused || released) return;
    // Keep a small warm neighborhood, instead of retaining complex SVG trees
    // for every author ever scrolled past. Visible artwork is never evicted.
    const warm = [...marks.values()].filter(mark => !mark.visible && mark.canvas)
      .sort((a, b) => b.lastVisible - a.lastVisible);
    for (const mark of warm.slice(warmOffscreenMax)) removeCanvas(mark);
  };
  const checkReferences = (value: string) => {
    if (/@import|javascript\s*:/i.test(value)) throw Error('External level artwork reference');
    for (const match of value.matchAll(/url\s*\(\s*([^)]*)\)/gi)) {
      if (!/^#[\w-]+$/.test(match[1].trim().replace(/^(['"])(.*)\1$/, '$2'))) throw Error('External level artwork URL');
    }
  };
  const load = (kind: ArtworkKind, slug: string): Promise<Element> => {
    const source = kind === 'staff' ? communityStaffArtSource(slug, false) : `/assets/community/levels/${slug}.svg`;
    if (!source) return Promise.reject(Error('Unapproved staff artwork'));
    const key = source;
    const existing = templates.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const timeout = new AbortController();
      const timer = window.setTimeout(() => timeout.abort(), 10000);
      try {
        const response = await fetcher(source, {
          credentials: 'omit', cache: 'force-cache', redirect: 'error', signal: AbortSignal.any([lifetime.signal, timeout.signal]),
        });
        if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0].trim() !== 'image/svg+xml') throw Error('Level artwork unavailable');
        const maxBytes = kind === 'staff' ? maxStaffArtworkBytes : maxArtworkBytes;
        const statedBytes = Number(response.headers.get('content-length') || 0);
        if (statedBytes > maxBytes) throw Error('Level artwork too large');
        const body = await response.text();
        if (lifetime.signal.aborted || timeout.signal.aborted || new TextEncoder().encode(body).length > maxBytes) throw Error('Level artwork unavailable');
        return validate(body, kind);
      } finally { window.clearTimeout(timer); }
    })();
    templates.set(key, pending);
    void pending.catch(() => { if (templates.get(key) === pending) templates.delete(key); });
    return pending;
  };
  const current = (mark: Mark) => !released && mark.element.isConnected && marks.get(mark.element) === mark &&
    (mark.kind === 'staff' ? mark.element.dataset.staffArt : mark.element.dataset.levelIcon) === mark.slug;
  const mount = (mark: Mark, svg: Element) => {
    if (!current(mark) || !eligible(mark) || mark.canvas) return;
    const canvas = document.createElement('span');
    canvas.className = 'community-level-motion-canvas';
    // Shadow boundaries isolate the original IDs, selectors and keyframes.
    // Clone only at idle; scrolling parks this same canvas behind its static
    // image so transformed SVG descendants cannot paint apart from the text.
    const shadow = canvas.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = playbackStyle;
    const artwork = document.importNode(svg, true);
    artwork.setAttribute('data-level-motion-svg', '');
    shadow.append(artwork, style);
    canvas.style.setProperty('--community-level-play-state', 'running');
    mark.canvas = canvas;
    mark.element.append(canvas);
    mark.element.dataset.levelMotionReady = 'true';
  };
  const update = (mark: Mark) => {
    if (mark.kind === 'staff' && motion?.matches) {
      // Their white-light layer gets its transparent baseline from keyframes.
      // Disabling animation inside the SVG would leave that layer opaque.
      // Restore the frozen image while retaining the approved shared template.
      if (mark.canvas) removeCanvas(mark);
      return;
    }
    const state = eligible(mark) ? 'running' : 'paused';
    if (mark.canvas) {
      if (mark.canvas.style.getPropertyValue('--community-level-play-state') !== state) {
        mark.canvas.style.setProperty('--community-level-play-state', state);
        mark.canvas.hidden = state !== 'running';
        mark.element.dataset.levelMotionReady = state === 'running' ? 'true' : 'paused';
      }
      return;
    }
    if (state !== 'running' || mark.pending) return;
    if (mark.template) { mount(mark, mark.template); return; }
    mark.pending = true;
    void load(mark.kind, mark.slug).then(svg => {
      if (!current(mark)) return;
      mark.template = svg;
      mount(mark, svg);
    }).catch(() => { /* Keep the static fallback; visibility changes may retry. */ }).finally(() => { mark.pending = false; });
  };
  const refresh = () => { for (const mark of marks.values()) update(mark); trimOffscreen(); };
  const intersection = new window.IntersectionObserver(entries => {
    if (released) return;
    for (const entry of entries) {
      const mark = marks.get(entry.target as HTMLElement);
      if (!mark) continue;
      mark.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (mark.visible) mark.lastVisible = ++visibilityOrder;
      update(mark);
    }
    trimOffscreen();
  }, { threshold: 0.01 });
  const forget = (mark: Mark) => {
    intersection.unobserve(mark.element);
    removeCanvas(mark);
    marks.delete(mark.element);
  };
  const collect = (node: Node) => {
    if (!(node instanceof window.Element)) return;
    const elements = [...node.querySelectorAll<HTMLElement>(markSelector)];
    if (node.matches(markSelector)) elements.unshift(node as HTMLElement);
    for (const element of elements) {
      if (marks.has(element)) continue;
      const kind: ArtworkKind = element.hasAttribute('data-staff-art') ? 'staff' : 'levels';
      const slug = (kind === 'staff' ? element.dataset.staffArt : element.dataset.levelIcon) || '';
      const image = element.querySelector('img');
      const approved = kind === 'staff' ? approvedStaffSlug.test(slug) && element.classList.contains(slug.startsWith('frame-') ? 'community-staff-frame' : 'community-staff-art') : approvedSlug.test(slug);
      const source = kind === 'staff' ? communityStaffArtSource(slug, true) : `/assets/community/levels/compact/${slug}.webp`;
      if (!approved || !source || image?.getAttribute('src') !== source || !element.isConnected) continue;
      const mark: Mark = { element, kind, slug, visible: false, lastVisible: 0, pending: false, template: null, canvas: null };
      marks.set(element, mark); intersection.observe(element);
    }
  };
  const changes = new window.MutationObserver(records => {
    if (released) return;
    for (const record of records) for (const node of record.addedNodes) collect(node);
    for (const mark of marks.values()) if (!mark.element.isConnected) forget(mark);
  });
  changes.observe(document.body, { childList: true, subtree: true });
  collect(document.body);
  document.addEventListener('visibilitychange', refresh);
  motion?.addEventListener('change', refresh);
  return {
    pause: () => { if (!paused && !released) { paused = true; refresh(); } },
    resume: () => { if (paused && !released) { paused = false; refresh(); } },
    release: () => {
      if (released) return;
      released = true; lifetime.abort();
      changes.disconnect();
      for (const mark of marks.values()) forget(mark);
      intersection.disconnect(); templates.clear();
      document.removeEventListener('visibilitychange', refresh);
      motion?.removeEventListener('change', refresh);
    },
  };
}
