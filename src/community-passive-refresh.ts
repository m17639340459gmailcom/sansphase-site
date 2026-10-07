export type CommunityPassiveRefreshOptions = {
  document: Document;
  window: Window;
  run: (signal: AbortSignal) => Promise<boolean>;
  allowed: () => boolean;
  intervalMs?: number;
  timeoutMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};
type Timer = ReturnType<typeof setTimeout>;
type ActiveRun = { controller: AbortController; timer?: Timer };

/** Runs only passive reads; the caller guards applying results with this signal. */
export function createCommunityPassiveRefresh(options: CommunityPassiveRefreshOptions) {
  const doc = options.document, win = options.window;
  const setTimer = options.setTimer ?? globalThis.setTimeout;
  const clearTimer = options.clearTimer ?? globalThis.clearTimeout;
  const interval = options.intervalMs ?? 15000, timeout = options.timeoutMs ?? 10000;
  let started = false, failures = 0, lastCheck = -Infinity, retryAfter = 0;
  let timer: Timer | undefined, due = Infinity, active: ActiveRun | undefined;
  const delay = () => failures ? Math.min(60000, interval * 2 ** (failures - 1)) : interval;
  const failed = () => {
    failures = Math.min(3, failures + 1);
    retryAfter = Date.now() + delay();
  };
  const clearScheduled = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined; due = Infinity;
  };
  const cancel = () => {
    clearScheduled();
    const previous = active; active = undefined;
    if (!previous) return;
    if (previous.timer !== undefined) clearTimer(previous.timer);
    previous.controller.abort();
  };
  const schedule = (wait: number) => {
    if (!started || doc.hidden || active) return;
    clearScheduled(); due = Date.now() + wait;
    timer = setTimer(check, wait);
  };
  const finish = (job: ActiveRun, outcome: 'success' | 'skip' | 'failure') => {
    if (active !== job || job.controller.signal.aborted) return;
    if (job.timer !== undefined) clearTimer(job.timer);
    active = undefined;
    if (outcome === 'success') { failures = 0; retryAfter = 0; }
    else if (outcome === 'failure') failed();
    schedule(delay());
  };
  function check() {
    timer = undefined; due = Infinity;
    if (!started || doc.hidden || active) return;
    lastCheck = Date.now();
    if (!options.allowed()) { schedule(delay()); return; }
    const job: ActiveRun = { controller: new AbortController() };
    active = job;
    job.timer = setTimer(() => {
      if (active !== job) return;
      // Abort cannot force an uncooperative promise to settle. Release the slot
      // first, and ignore its eventual result independently of the next run.
      active = undefined; job.controller.abort();
      failed(); schedule(delay());
    }, timeout);
    void (async () => {
      try { finish(job, await options.run(job.controller.signal) ? 'success' : 'skip'); }
      catch { finish(job, 'failure'); }
    })();
  }
  const nudge = () => {
    if (!started || doc.hidden || active) return;
    const now = Date.now();
    // Focus and visibility cannot bypass a failed read's backoff, including
    // when hiding the page has removed its pending retry timer.
    const wait = Math.max(1000, 10000 - (now - lastCheck), retryAfter - now);
    // Repeated focus events may bring a read forward, never keep postponing it.
    if (now + wait < due) schedule(wait);
  };
  const visibility = () => { if (doc.hidden) cancel(); else nudge(); };
  return {
    start() {
      if (started) return;
      started = true; failures = 0; lastCheck = -Infinity; retryAfter = 0;
      doc.addEventListener('visibilitychange', visibility);
      win.addEventListener('focus', nudge);
      schedule(interval);
    },
    stop() {
      if (!started) return;
      started = false; cancel();
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('focus', nudge);
    },
    invalidate() {
      cancel(); failures = 0; retryAfter = 0;
      schedule(interval);
    },
  };
}
