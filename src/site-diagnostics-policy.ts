import { parseRoute } from './core.mjs';

export const diagnosticLimits = Object.freeze({
  batchEvents: 20, bodyBytes: 8192, pageEvents: 100, retentionMs: 86400000, maxEvents: 5000,
});

export const diagnosticRoutes = [
  'home', 'works', 'work', 'notes', 'note', 'resources', 'software', 'resource-center',
  'support', 'contact', 'account', 'verify', 'reset', 'admin', 'share', 'other',
  'community-home', 'community-board', 'community-post', 'community-compose', 'community-profile',
  'community-stardust', 'community-shop', 'community-rank', 'community-management', 'community-teahouse',
  'community-checkin', 'community-inbox', 'community-rules', 'community-bookmarks', 'community-tag',
] as const;
export type DiagnosticRoute = typeof diagnosticRoutes[number];
export const diagnosticErrorNames = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'UnknownError'] as const;
export type DiagnosticErrorName = typeof diagnosticErrorNames[number];
export const diagnosticVitalNames = ['CLS', 'INP', 'LCP', 'FCP', 'TTFB'] as const;
export type DiagnosticVitalName = typeof diagnosticVitalNames[number];
type RouteField = { route: DiagnosticRoute };
export type DiagnosticEvent = RouteField & (
  | { kind: 'vital'; name: DiagnosticVitalName; value: number }
  | { kind: 'longtask'; duration: number }
  | { kind: 'error'; source: 'script' | 'promise' | 'resource'; name: DiagnosticErrorName; line?: number }
);

const routeSet = new Set<string>(diagnosticRoutes);
const errorSet = new Set<string>(diagnosticErrorNames);
const vitalSet = new Set<string>(diagnosticVitalNames);
const communityRoutes: Readonly<Record<string, DiagnosticRoute>> = {
  home: 'community-home', boards: 'community-board', new: 'community-compose', edit: 'community-compose',
  u: 'community-profile', profile: 'community-profile', stardust: 'community-stardust', shop: 'community-shop',
  rank: 'community-rank', manage: 'community-management', checkin: 'community-checkin', inbox: 'community-inbox',
  rules: 'community-rules', bookmarks: 'community-bookmarks', tag: 'community-tag',
};

/** Only fixed page categories escape this boundary; never identifiers or URL parameters. */
export function classifyDiagnosticRoute({ pathname, hash }: { pathname: string; hash: string }): DiagnosticRoute {
  if (/^\/admin-console(?:\/|$)/.test(pathname)) return 'admin';
  if (/^\/share(?:\/|$)/.test(pathname)) return 'share';
  if (/^\/member-teahouse(?:\/|$)|^\/teahouse(?:\/|$)/.test(pathname)) return 'community-teahouse';
  if (/^\/blog\//.test(pathname) && !hash.startsWith('#/')) return 'note';
  if (pathname !== '/' && pathname !== '/index.html' && !hash.startsWith('#/')) return 'other';
  const parsed = parseRoute(hash);
  if (parsed.page === 'post') return 'community-post';
  if (parsed.page === 'community') return !parsed.id ? 'community-home' : Object.hasOwn(communityRoutes, parsed.id) ? communityRoutes[parsed.id] : 'other';
  return routeSet.has(parsed.page) ? parsed.page as DiagnosticRoute : 'other';
}

const bounded = (value: unknown, maximum: number, minimum = 0): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Fail closed on unknown fields, including content accidentally added by a future caller. */
export function normalizeDiagnosticEvent(input: unknown): DiagnosticEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.route !== 'string' || !routeSet.has(value.route)) return null;
  const route = value.route as DiagnosticRoute;
  if (value.kind === 'vital' && exactKeys(value, ['kind', 'name', 'value', 'route']) &&
    typeof value.name === 'string' && vitalSet.has(value.name) && bounded(value.value, value.name === 'CLS' ? 100 : 3_600_000)) {
    return { kind: 'vital', name: value.name as DiagnosticVitalName, value: value.value, route };
  }
  if (value.kind === 'longtask' && exactKeys(value, ['kind', 'duration', 'route']) && bounded(value.duration, 3_600_000, 50)) {
    return { kind: 'longtask', duration: value.duration, route };
  }
  if (value.kind === 'error' && exactKeys(value, ['kind', 'source', 'name', 'line', 'route']) &&
    typeof value.source === 'string' && ['script', 'promise', 'resource'].includes(value.source) && typeof value.name === 'string' && errorSet.has(value.name) &&
    (value.line === undefined || bounded(value.line, 1_000_000, 1) && Number.isSafeInteger(value.line))) {
    return { kind: 'error', source: value.source as 'script' | 'promise' | 'resource', name: value.name as DiagnosticErrorName, route,
      ...(typeof value.line === 'number' ? { line: value.line } : {}) };
  }
  return null;
}
