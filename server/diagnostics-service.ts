import type { IncomingMessage, ServerResponse } from 'node:http';
import { LRUCache } from 'lru-cache';
import { diagnosticLimits, normalizeDiagnosticEvent } from '../src/site-diagnostics-policy.ts';
import type { DiagnosticEvent, DiagnosticVitalName } from '../src/site-diagnostics-policy.ts';

export type DiagnosticsEndpoint = 'config' | 'events' | 'report';
type Options = {
  release: string;
  sampleRate: number;
  allowRequest: (req: IncomingMessage, endpoint: DiagnosticsEndpoint) => boolean;
  now?: () => number;
  random?: () => number;
};
type StoredEvent = DiagnosticEvent & { receivedAt: number };
type Budget = { start: number; count: number };
type VitalSummary = { count: number; mean: number; max: number };
const minute = 60_000;
const bodyReadMs = 3_000;
const maxReading = 8;
const errorText = 'Diagnostics request rejected.';

function json(res: ServerResponse, status: number, value: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(status >= 400 ? { Connection: 'close' } : {}),
    ...(status === 429 ? { 'Retry-After': '60' } : {}),
  });
  res.end(JSON.stringify(value));
}

class RequestRejected extends Error {
  status: number;
  constructor(status: number) { super(errorText); this.status = status; }
}

/** Same byte limit pattern as the existing HTTP services, with an absolute deadline. */
function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > diagnosticLimits.bodyBytes))
    return Promise.reject(new RequestRejected(413));
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('aborted', aborted);
      req.off('error', aborted);
    };
    const fail = (status: number) => { cleanup(); req.pause(); reject(new RequestRejected(status)); };
    const data = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > diagnosticLimits.bodyBytes) { fail(413); return; }
      chunks.push(buffer);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown); }
      catch { reject(new RequestRejected(400)); }
    };
    const aborted = () => fail(400);
    const timer = setTimeout(() => fail(408), bodyReadMs);
    timer.unref();
    req.on('data', data);
    req.once('end', end);
    req.once('aborted', aborted);
    req.once('error', aborted);
  });
}

function batchOf(value: unknown): DiagnosticEvent[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !Array.isArray(body.events) || body.events.length < 1 ||
    body.events.length > diagnosticLimits.batchEvents) return null;
  const batch: DiagnosticEvent[] = [];
  for (const entry of body.events) {
    const event = normalizeDiagnosticEvent(entry);
    if (!event) return null;
    batch.push(event);
  }
  return batch;
}

function aggregate(events: StoredEvent[]) {
  const vitals: Partial<Record<DiagnosticVitalName, VitalSummary>> = {};
  const longtasks = { count: 0, total: 0, max: 0 };
  const errors: { count: number; byType: Record<string, number> } = { count: 0, byType: {} };
  for (const event of events) {
    if (event.kind === 'vital') {
      const summary = vitals[event.name] ?? { count: 0, mean: 0, max: 0 };
      summary.count++;
      summary.mean += (event.value - summary.mean) / summary.count;
      summary.max = Math.max(summary.max, event.value);
      vitals[event.name] = summary;
    } else if (event.kind === 'longtask') {
      longtasks.count++;
      longtasks.total += event.duration;
      longtasks.max = Math.max(longtasks.max, event.duration);
    } else {
      errors.count++;
      const name = `${event.source}:${event.name}`;
      errors.byType[name] = (errors.byType[name] ?? 0) + 1;
    }
  }
  return { vitals, longtasks, errors };
}

/** Shared bounded receiver. Runtime-specific wrappers supply a strict access policy. */
export function createDiagnosticsService({ release, sampleRate, allowRequest, now = Date.now, random = Math.random }: Options) {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(release) || !Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 1)
    throw Error('Diagnostics configuration rejected.');
  // LRU only evicts; entries are never "get"-accessed, so retention order stays FIFO.
  const events = new LRUCache<number, StoredEvent>({
    max: diagnosticLimits.maxEvents, ttl: diagnosticLimits.retentionMs,
    ttlResolution: 0, perf: { now },
  });
  const budgets = new LRUCache<string, Budget>({ max: 2 });
  let sequence = 0;
  let reading = 0;
  const consume = (kind: 'events' | 'report', maximum: number) => {
    // Reuse the tea-room service's bounded fixed-window budget, without account/IP keys.
    const time = now();
    const budget = budgets.get(kind) ?? { start: time, count: 0 };
    if (time - budget.start >= minute) { budget.start = time; budget.count = 0; }
    if (budget.count >= maximum) return false;
    budget.count++;
    budgets.set(kind, budget);
    return true;
  };
  return Object.freeze({
    sampleRate,
    bootstrap(req: IncomingMessage): { enabled: true } | undefined {
      const optedOut = (value: string | string[] | undefined) =>
        (Array.isArray(value) ? value : [value || '']).some(entry => entry.split(',').some(part => part.trim() === '1'));
      if (optedOut(req.headers.dnt) || optedOut(req.headers['sec-gpc'])) return undefined;
      const sample = random();
      return Number.isFinite(sample) && sample >= 0 && sample < sampleRate ? { enabled: true } : undefined;
    },
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const route = /^\/api\/diagnostics\/(config|events|report)(\?.*)?$/.exec(req.url || '');
      if (!route) return false;
      const kind = route[1] as DiagnosticsEndpoint;
      try {
        if (!allowRequest(req, kind)) throw new RequestRejected(403);
        if (route[2]) throw new RequestRejected(400);
        if (req.method !== (kind === 'events' ? 'POST' : 'GET')) throw new RequestRejected(405);
        if (kind === 'config') {
          json(res, 200, { enabled: true, release, sampleRate, limits: diagnosticLimits });
        } else if (kind === 'report') {
          if (!consume('report', 30)) throw new RequestRejected(429);
          events.purgeStale();
          const retained = [...events.rvalues()].filter((event): event is StoredEvent => event !== undefined);
          json(res, 200, {
            release, sampleRate, retentionMs: diagnosticLimits.retentionMs, maxEvents: diagnosticLimits.maxEvents,
            count: retained.length, events: retained, summary: aggregate(retained),
          });
        } else {
          if (!consume('events', 120) || reading >= maxReading) throw new RequestRejected(429);
          if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') ||
            req.headers['content-encoding'] !== undefined) throw new RequestRejected(415);
          reading++;
          let value: unknown;
          try { value = await readJson(req); } finally { reading--; }
          const batch = batchOf(value);
          if (!batch) throw new RequestRejected(400);
          const receivedAt = now();
          for (const event of batch) events.set(sequence++, { ...event, receivedAt });
          json(res, 202, { accepted: batch.length });
        }
      } catch (error) {
        json(res, error instanceof RequestRejected ? error.status : 500, { error: errorText });
      }
      return true;
    },
  });
}
