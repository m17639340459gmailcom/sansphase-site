export type LoginVerificationNamespace = 'reader' | 'author';
export type LoginVerificationStatus = 'checking' | 'verifying' | 'complete';
export type SliderLoginChallenge = {
  id: string; token: string; expiresAt: number;
  backgroundImage: string; templateImage: string;
  backgroundImageWidth: number; backgroundImageHeight: number;
  templateImageWidth: number; templateImageHeight: number;
};
export type LoginVerificationChallenge = { enabled: false } | { enabled: true; engine: 'slider'; challenge: SliderLoginChallenge };
export type MountLoginSliderPanel = (panel: HTMLElement, control: HTMLButtonElement, dismiss: () => void) => { ready: Promise<void>; unmount: () => void };
export type LoginVerificationOptions = { signal?: AbortSignal; onStatus?: (status: LoginVerificationStatus) => void; challenge?: LoginVerificationChallenge; mountPanel?: MountLoginSliderPanel };
type LoginVerificationLibrary = { solveLoginChallenge: (form: HTMLFormElement, challenge: SliderLoginChallenge, signal: AbortSignal, namespace: LoginVerificationNamespace, remainingLifetimeMs?: () => number, onProofLifetimeMs?: (remainingMs: number) => void, mountPanel?: MountLoginSliderPanel) => Promise<string> };
type AcquirerDependencies = { request?: typeof fetch; load?: () => Promise<LoginVerificationLibrary>; now?: () => number; timeoutMs?: number; interactionTimeoutMs?: number };
export const loginChallengeLifetimeMs = 120_000;
export const loginProofLifetimeMs = 90_000;
const cancelled = () => new DOMException('登录验证已取消。', 'AbortError');
const checkActive = (form: HTMLFormElement, signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? cancelled();
  if (!form.isConnected) throw cancelled();
};
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason ?? cancelled()); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function supportedChallenge(value: unknown): value is SliderLoginChallenge {
  if (!object(value)) return false;
  const dimension = (number: unknown): number is number => typeof number === 'number' && Number.isSafeInteger(number) && number > 0 && number <= 4096;
  const image = (url: unknown, transparent = false): url is string => typeof url === 'string' && url.length <= 2_000_000 && (transparent ? /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/ : /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/).test(url);
  return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128
    && typeof value.token === 'string' && value.token.length > 0 && value.token.length <= 4096 && !/\s/.test(value.token)
    && typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0
    && image(value.backgroundImage) && image(value.templateImage, true)
    && dimension(value.backgroundImageWidth) && dimension(value.backgroundImageHeight)
    && dimension(value.templateImageWidth) && dimension(value.templateImageHeight)
    && value.templateImageWidth < value.backgroundImageWidth && value.templateImageHeight === value.backgroundImageHeight;
}

function validatedChallenge(value: unknown): LoginVerificationChallenge {
  if (object(value) && value.enabled === false) return { enabled: false };
  if (!object(value) || value.enabled !== true || value.engine !== 'slider' || !supportedChallenge(value.challenge)) throw new Error('登录验证响应无效，请重试。');
  return { enabled: true, engine: 'slider', challenge: value.challenge };
}

/** UI deadlines use the server's HTTP clock and monotonic elapsed time, never the device's date. */
export function remainingLoginResponseLifetimeMs(expiresAt: number, response: Response, startedAt: number, currentTime: number, maximumMs: number): number {
  const serverTime = Date.parse(response.headers.get('Date') ?? '');
  const lifetime = Number.isFinite(serverTime) ? expiresAt * 1000 - serverTime : maximumMs;
  return Math.max(0, Math.min(maximumMs, lifetime) - Math.max(0, currentTime - startedAt));
}

async function withFormLifetime<T>(form: HTMLFormElement, signal: AbortSignal | undefined, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  checkActive(form, signal);
  const controller = new AbortController();
  const view = form.ownerDocument.defaultView;
  const originalLocation = view?.location.href;
  const cancel = () => controller.abort(signal?.reason ?? cancelled());
  // popstate and hashchange may describe the same committed route. A queued
  // notification must not cancel work mounted by the preceding route event.
  const navigate = () => { if (view?.location.href !== originalLocation) cancel(); };
  const detached = () => { if (!form.isConnected) controller.abort(cancelled()); };
  const observer = view?.MutationObserver ? new view.MutationObserver(detached) : undefined;
  observer?.observe(form.ownerDocument.documentElement, { childList: true, subtree: true });
  signal?.addEventListener('abort', cancel, { once: true });
  view?.addEventListener('hashchange', navigate);
  view?.addEventListener('pagehide', cancel);
  const timer = setTimeout(() => controller.abort(new Error('登录验证超时，请重试。')), timeoutMs);
  try { return await run(controller.signal); }
  finally {
    clearTimeout(timer); observer?.disconnect();
    signal?.removeEventListener('abort', cancel);
    view?.removeEventListener('hashchange', navigate);
    view?.removeEventListener('pagehide', cancel);
  }
}

/** Only login acquires proof. Passwords and account fields never enter the CAPTCHA request or storage. */
export function createLoginVerificationAcquirer({ request = (...args: Parameters<typeof fetch>) => fetch(...args), load = () => import('./login-verification-library.mjs'), now = () => performance.now(), timeoutMs = 30_000, interactionTimeoutMs = 120_000 }: AcquirerDependencies = {}) {
  let library: Promise<LoginVerificationLibrary> | undefined;
  const deadlines = new WeakMap<SliderLoginChallenge, number>();
  const proofDeadlines = new WeakMap<SliderLoginChallenge, number>();
  const remainingProofLifetimeMs = (challenge: SliderLoginChallenge) => {
    const currentTime = now();
    return Math.max(0, (proofDeadlines.get(challenge) ?? currentTime + loginProofLifetimeMs) - currentTime);
  };
  const remainingLifetimeMs = (challenge: SliderLoginChallenge) => {
    const currentTime = now();
    let deadline = deadlines.get(challenge);
    // A supplied challenge without transport metadata still has a bounded UI life.
    // The server remains authoritative for actual expiry and one-time consumption.
    if (deadline === undefined) { deadline = currentTime + Math.min(interactionTimeoutMs, loginChallengeLifetimeMs); deadlines.set(challenge, deadline); }
    return Math.max(0, deadline - currentTime);
  };
  const getLibrary = () => {
    if (!library) {
      const attempt = Promise.resolve().then(load);
      library = attempt;
      void attempt.catch(() => { if (library === attempt) library = undefined; });
    }
    return library;
  };
  const requestChallenge = async (form: HTMLFormElement, namespace: LoginVerificationNamespace, signal: AbortSignal): Promise<LoginVerificationChallenge> => {
    const startedAt = now();
    const response = await abortable(request(`/api/${namespace}/login-challenge`, {
      method: 'POST', credentials: 'same-origin',
      headers: { [namespace === 'author' ? 'X-Author-Request' : 'X-Reader-Request']: '1', 'Content-Type': 'application/json' },
      body: '{}', signal,
    }), signal);
    checkActive(form, signal);
    if (!response.ok) throw new Error('登录验证暂时无法完成，请稍后重试。');
    const value: unknown = await abortable(response.json(), signal);
    checkActive(form, signal);
    const validated = validatedChallenge(value);
    if (validated.enabled) {
      const currentTime = now();
      deadlines.set(validated.challenge, currentTime + remainingLoginResponseLifetimeMs(validated.challenge.expiresAt, response, startedAt, currentTime, Math.min(interactionTimeoutMs, loginChallengeLifetimeMs)));
    }
    return validated;
  };
  const prepare = (form: HTMLFormElement, namespace: LoginVerificationNamespace, options: Pick<LoginVerificationOptions, 'signal'> = {}) =>
    withFormLifetime(form, options.signal, timeoutMs, signal => requestChallenge(form, namespace, signal));
  const acquire = async (form: HTMLFormElement, namespace: LoginVerificationNamespace, options: LoginVerificationOptions = {}): Promise<string | null> =>
    withFormLifetime(form, options.signal, interactionTimeoutMs, async signal => {
      const update = (status: LoginVerificationStatus) => { checkActive(form, signal); options.onStatus?.(status); };
      update('checking');
      const value = options.challenge === undefined ? await prepare(form, namespace, { signal }) : validatedChallenge(options.challenge);
      if (!value.enabled) return null;
      update('verifying');
      const solver = await abortable(getLibrary(), signal);
      checkActive(form, signal);
      proofDeadlines.delete(value.challenge);
      const proof = await abortable(solver.solveLoginChallenge(form, value.challenge, signal, namespace, () => remainingLifetimeMs(value.challenge), remainingMs => {
        if (Number.isFinite(remainingMs) && remainingMs >= 0) proofDeadlines.set(value.challenge, now() + Math.min(loginProofLifetimeMs, remainingMs));
      }, options.mountPanel), signal);
      checkActive(form, signal);
      if (!proof || typeof proof !== 'string') throw new Error('登录验证失败，请重试。');
      update('complete');
      return proof;
    });
  return Object.assign(acquire, { prepare, remainingLifetimeMs, remainingProofLifetimeMs });
}

export const acquireLoginVerification = createLoginVerificationAcquirer();
