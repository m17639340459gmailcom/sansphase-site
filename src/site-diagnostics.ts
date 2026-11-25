import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals';
import { validateSceneCdnOrigin } from './scene-delivery.mjs';
import {
  classifyDiagnosticRoute, diagnosticErrorNames, diagnosticLimits, normalizeDiagnosticEvent,
} from './site-diagnostics-policy.ts';
import type { DiagnosticErrorName, DiagnosticEvent, DiagnosticVitalName } from './site-diagnostics-policy.ts';

export type DiagnosticMetric = { name: DiagnosticVitalName; value: number };
type MetricHook = (report: (metric: DiagnosticMetric) => void, options: { reportAllChanges: boolean; reportSoftNavs: boolean }) => void;
export type DiagnosticMetricHooks = { onCLS: MetricHook; onINP: MetricHook; onLCP: MetricHook; onFCP: MetricHook; onTTFB: MetricHook };
export type SiteDiagnosticsOptions = {
  window?: Window;
  fetch?: typeof fetch;
  metricLoader?: () => Promise<DiagnosticMetricHooks>;
};
export type SiteDiagnosticsControl = { readonly enabled: boolean; flush: () => void; destroy: () => void };

const instances = new WeakMap<Window, SiteDiagnosticsControl>();
const errorNames = new Set<string>(diagnosticErrorNames);
const nativeErrorName = (value: unknown): DiagnosticErrorName => {
  try {
    const name = value && typeof value === 'object' && 'name' in value ? value.name : undefined;
    return typeof name === 'string' && errorNames.has(name) ? name as DiagnosticErrorName : 'UnknownError';
  } catch { return 'UnknownError'; }
};
const rounded = (value: number, digits = 1) => Number(value.toFixed(digits));

/** Explicit opt-in only. This controller owns no UI, identity, storage, router or fetch patches. */
export function startSiteDiagnostics(options: SiteDiagnosticsOptions = {}): SiteDiagnosticsControl {
  const win = options.window ?? (typeof window === 'undefined' ? undefined : window);
  const inactive: SiteDiagnosticsControl = { enabled: false, flush() {}, destroy() {} };
  if (!win) return inactive;
  const existing = instances.get(win);
  if (existing) return existing;
  const privacy = win.navigator as Navigator & { globalPrivacyControl?: boolean };
  const request = options.fetch ?? win.fetch?.bind(win);
  if (privacy.doNotTrack === '1' || privacy.globalPrivacyControl === true || !request) {
    instances.set(win, inactive);
    return inactive;
  }

  let active = true, accepted = 0;
  let queue: DiagnosticEvent[] = [];
  const seen = new Set<string>();
  const route = () => classifyDiagnosticRoute(win.location);
  // The standard vitals describe the document navigation, not arbitrary hash changes.
  const navigationRoute = route();
  const currentStaticBase = (() => {
    const declared = win.document.documentElement.dataset.staticBase;
    if (!declared) return undefined;
    try {
      const base = new URL(declared);
      if (validateSceneCdnOrigin(base.origin) !== 'https://static.sansphase.com' || base.username || base.password ||
        base.search || base.hash || declared !== base.href || !/^\/assets\/site\/[a-f0-9]{24}\/$/.test(base.pathname)) return undefined;
      return base;
    } catch { return undefined; }
  })();
  const flush = () => {
    if (!active || !queue.length) return;
    const batch = queue;
    queue = [];
    const body = JSON.stringify({ events: batch });
    if (new TextEncoder().encode(body).byteLength > diagnosticLimits.bodyBytes) return;
    try {
      void Promise.resolve(request('/api/diagnostics/events', {
        method: 'POST', credentials: 'omit', keepalive: true, referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' }, body,
      })).catch(() => {});
    } catch { /* Diagnostics never affect the user's operation or retry failed requests. */ }
  };
  const record = (input: unknown, deduplicate = false) => {
    if (!active || accepted >= diagnosticLimits.pageEvents) return;
    const event = normalizeDiagnosticEvent(input);
    if (!event) return;
    const key = deduplicate ? JSON.stringify(event) : '';
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    accepted++;
    queue.push(event);
    if (queue.length >= diagnosticLimits.batchEvents) flush();
  };
  const siteStaticAsset = (value: string): boolean => {
    try {
      const url = new URL(value, win.location.href);
      if (url.origin === win.location.origin)
        return !/^\/(?:api|uploads|media)(?:\/|$)/i.test(url.pathname) && /\.(?:m?js|css)$/i.test(url.pathname);
      // Production modules/styles come from this document's immutable package.
      // Admit only its approved CDN prefix; addresses never enter event payloads.
      return Boolean(currentStaticBase && url.origin === currentStaticBase.origin && url.pathname.startsWith(currentStaticBase.pathname) &&
        /^(?:[\w.-]+\.(?:m?js|css)|chunks\/[\w.-]+\.mjs)$/.test(url.pathname.slice(currentStaticBase.pathname.length)));
    } catch { return false; }
  };
  const error = (event: Event) => {
    if (!active) return;
    const target = event.target;
    if (target && target !== win && target !== win.document) {
      const element = target as Element;
      const tag = element.tagName;
      if (tag !== 'SCRIPT' && tag !== 'LINK') return;
      if (tag === 'LINK' && element.getAttribute('rel') !== 'stylesheet') return;
      const address = element.getAttribute(tag === 'SCRIPT' ? 'src' : 'href');
      if (!address || !siteStaticAsset(address)) return;
      record({ kind: 'error', source: 'resource', name: 'UnknownError', route: route() }, true);
      return;
    }
    const script = event as ErrorEvent;
    if (script.filename && !siteStaticAsset(script.filename)) return;
    const line = Number.isSafeInteger(script.lineno) && script.lineno > 0 && script.lineno <= 1_000_000 ? script.lineno : undefined;
    record({ kind: 'error', source: 'script', name: nativeErrorName(script.error), route: route(), ...(line ? { line } : {}) }, true);
  };
  const rejection = (event: Event) => {
    record({ kind: 'error', source: 'promise', name: nativeErrorName((event as PromiseRejectionEvent).reason), route: route() }, true);
  };
  // Let web-vitals' own hidden/pagehide callbacks enqueue their final values first.
  const onPageHide = () => { queueMicrotask(flush); };
  const onVisibility = () => { if (win.document.visibilityState === 'hidden') onPageHide(); };
  win.addEventListener('error', error, true);
  win.addEventListener('unhandledrejection', rejection);
  win.addEventListener('pagehide', onPageHide);
  win.document.addEventListener('visibilitychange', onVisibility);
  const timer = win.setInterval(flush, 30_000);
  let observer: PerformanceObserver | undefined;
  const Observer = (win as Window & { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
  if (Observer?.supportedEntryTypes?.includes('longtask')) {
    try {
      observer = new Observer(list => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') record({ kind: 'longtask', duration: rounded(entry.duration), route: route() });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch { observer?.disconnect(); observer = undefined; }
  }
  const control: SiteDiagnosticsControl = {
    get enabled() { return active; }, flush,
    destroy() {
      if (!active) return;
      active = false;
      queue = [];
      seen.clear();
      win.clearInterval(timer);
      observer?.disconnect();
      win.removeEventListener('error', error, true);
      win.removeEventListener('unhandledrejection', rejection);
      win.removeEventListener('pagehide', onPageHide);
      win.document.removeEventListener('visibilitychange', onVisibility);
    },
  };
  // web-vitals owns lifetime observers without an unsubscribe API. Keep this
  // terminal controller registered after destroy, preventing duplicate observers.
  instances.set(win, control);
  const load = options.metricLoader ?? (async () => ({ onCLS, onINP, onLCP, onFCP, onTTFB }));
  try {
    void load().then(hooks => {
      if (!active) return;
      const report = (metric: DiagnosticMetric) => {
        record({ kind: 'vital', name: metric.name, value: rounded(metric.value, metric.name === 'CLS' ? 4 : 1), route: navigationRoute }, true);
      };
      for (const hook of [hooks.onCLS, hooks.onINP, hooks.onLCP, hooks.onFCP, hooks.onTTFB]) {
        try { hook(report, { reportAllChanges: false, reportSoftNavs: false }); } catch { /* Unsupported browser APIs are optional. */ }
      }
    }).catch(() => {});
  } catch { /* A failed optional loader must not interfere with the application. */ }
  return control;
}
