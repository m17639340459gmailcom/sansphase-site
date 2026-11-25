import { acquireLoginVerification } from './login-verification.mjs';
import type { LoginVerificationChallenge, LoginVerificationNamespace, MountLoginSliderPanel } from './login-verification.mjs';

type ControlState = 'loading' | 'ready' | 'working' | 'verified' | 'disabled' | 'error';
type ControlOptions = { english?: () => boolean; onError?: (message: string) => void; mountPanel?: MountLoginSliderPanel };
export type LoginVerificationControl = { consume(): string | null; dispose(): void; reset(): void; sync(): void; release(): void };
type ControlDependencies = { acquire?: typeof acquireLoginVerification; now?: () => number; proofLifetimeMs?: number };
const expiryBufferMs = 5_000;
const challengeFreshnessMs = 15_000;

export function loginVerificationControlHTML(english = false): string {
  return `<button type="button" class="login-verification-control" data-login-verification-control data-state="loading" disabled aria-live="polite" aria-busy="true"><svg class="login-verification-control-icon" data-login-verification-icon viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 4 4.8 7.4 8 9 3.2-1.6 8-5 8-9V6l-8-3Z"/><path data-login-verification-check d="m8 12 3 3 5-6"/></svg><span data-login-verification-label>${english ? 'Preparing verification…' : '正在准备验证…'}</span></button>`;
}

/** The login gate retains only the server-approved slider proof in this form's memory. */
export function createLoginVerificationControlMounter({ acquire = acquireLoginVerification, now = () => performance.now(), proofLifetimeMs = 85_000 }: ControlDependencies = {}) {
  const controls = new WeakMap<HTMLFormElement, { namespace: LoginVerificationNamespace; controller: LoginVerificationControl }>();
  return function mountLoginVerificationControl(form: HTMLFormElement, namespace: LoginVerificationNamespace, options: ControlOptions = {}): LoginVerificationControl {
    const existing = controls.get(form);
    if (existing?.namespace === namespace) { existing.controller.sync(); return existing.controller; }
    existing?.controller.dispose();
    const button = form.querySelector<HTMLButtonElement>('[data-login-verification-control]');
    const label = button?.querySelector<HTMLElement>('[data-login-verification-label]');
    if (!button || !label) throw new Error('登录验证控件缺失。');
    const view = form.ownerDocument.defaultView;
    const originalLocation = view?.location.href;
    let state: ControlState = 'loading';
    let expired = false, disposed = false, suspended = false, pending = false;
    let challenge: LoginVerificationChallenge | undefined;
    let proof: string | null = null;
    let proofDeadline = 0;
    let verifiedCredentials = '';
    let attempt: AbortController | undefined;
    let generation = 0;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const english = () => options.english?.() ?? false;
    const text = (zh: string, en: string) => english() ? en : zh;
    const credentials = () => JSON.stringify(['email', 'password'].map(name => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? ''));
    const clearExpiry = () => { if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; };
    const clearProof = () => { clearExpiry(); proof = null; proofDeadline = 0; verifiedCredentials = ''; };
    const focus = () => button.focus({ preventScroll: true });
    const render = () => {
      button.dataset.state = state;
      button.hidden = state === 'disabled';
      button.disabled = disposed || suspended || pending || state === 'loading' || state === 'working';
      button.setAttribute('aria-busy', String(pending || state === 'loading' || state === 'working'));
      label.textContent = pending ? text('正在登录…', 'Signing in…')
        : state === 'loading' ? text('正在准备验证…', 'Preparing verification…')
        : state === 'working' ? text('正在验证…', 'Verifying…')
        : state === 'verified' ? text('验证通过', 'Verified')
        : state === 'error' ? text('验证未完成，点击重试', 'Verification incomplete. Click to retry')
        : expired ? text('验证已过期，点击重新验证', 'Verification expired. Click to verify again')
        : text('点击滑块验证', 'Click for slider verification');
      const allowed = !disposed && !suspended && !pending && (state === 'disabled' || state === 'verified');
      for (const submit of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"], input[type="submit"]')) submit.disabled = !allowed;
    };
    const reset = (wasExpired = false) => {
      generation++; attempt?.abort(); attempt = undefined;
      clearProof(); expired = wasExpired;
      if (state !== 'disabled') {
        challenge = undefined;
        state = 'ready';
      }
      render();
    };
    const sync = () => {
      if (state === 'verified' && (now() >= proofDeadline || credentials() !== verifiedCredentials)) reset(now() >= proofDeadline);
      else render();
    };
    const fresh = (value: LoginVerificationChallenge | undefined) => value?.enabled === false || Boolean(value?.enabled && acquire.remainingLifetimeMs(value.challenge) > challengeFreshnessMs);
    const report = (error: unknown) => {
      if (disposed) return;
      clearProof(); challenge = undefined; state = 'error'; expired = false; render();
      options.onError?.(error instanceof Error ? error.message : text('登录验证失败，请重试。', 'Login verification failed. Please retry.'));
    };
    const start = async () => {
      if (disposed || suspended || pending || state === 'loading' || state === 'working' || state === 'disabled') return;
      if (state === 'verified') { sync(); if (state === 'verified') return; }
      const current = ++generation;
      const controller = new AbortController(); attempt = controller;
      clearProof(); state = 'working'; expired = false; render();
      const account = credentials();
      try {
        if (!fresh(challenge)) challenge = await acquire.prepare(form, namespace, { signal: controller.signal });
        if (disposed || controller.signal.aborted || current !== generation) return;
        if (!challenge) throw new Error(text('登录验证响应无效，请重试。', 'Invalid verification response. Please retry.'));
        if (!challenge.enabled) { state = 'disabled'; render(); return; }
        const activeChallenge = challenge;
        const result = await acquire(form, namespace, { signal: controller.signal, challenge: activeChallenge, mountPanel: options.mountPanel });
        if (disposed || controller.signal.aborted || current !== generation) return;
        if (account !== credentials()) { reset(); return; }
        if (!result) throw new Error(text('登录验证失败，请重试。', 'Login verification failed. Please retry.'));
        proofDeadline = now() + Math.min(proofLifetimeMs, acquire.remainingLifetimeMs(activeChallenge.challenge) - expiryBufferMs, acquire.remainingProofLifetimeMs(activeChallenge.challenge) - expiryBufferMs);
        if (proofDeadline <= now()) { reset(true); return; }
        proof = result; verifiedCredentials = account; state = 'verified'; render();
        expiryTimer = setTimeout(() => reset(true), Math.max(0, proofDeadline - now()));
      } catch (error) {
        if (!controller.signal.aborted && current === generation) {
          if (error instanceof Error && error.name === 'LoginVerificationRefreshError') { reset(); void start(); }
          else if (error instanceof Error && error.name === 'LoginVerificationCancelledError') reset();
          else report(error);
        }
      }
      finally { if (attempt === controller) attempt = undefined; }
    };
    const changed = (event: Event) => {
      const target = event.target;
      if (target && 'matches' in target && typeof target.matches === 'function' && target.matches('input[name="email"], input[name="password"]') && state !== 'loading') reset();
    };
    const click = () => { void start(); };
    const detached = () => { if (!form.isConnected) dispose(); };
    const observer = view?.MutationObserver ? new view.MutationObserver(detached) : undefined;
    const navigate = () => { if (view?.location.href !== originalLocation) dispose(); };
    const hide = (event: PageTransitionEvent) => {
      if (!event.persisted) { dispose(); return; }
      suspended = true; state = 'ready'; reset();
    };
    const show = (event: PageTransitionEvent) => {
      if (!event.persisted || disposed) return;
      if (!form.isConnected || view?.location.href !== originalLocation) { dispose(); return; }
      suspended = false;
      // A cached page may outlive its puzzle/proof. Preserve the form and any
      // in-flight login lock, but request a fresh challenge before a new login.
      if (pending) render(); else prepare();
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true; generation++; attempt?.abort(); attempt = undefined;
      clearProof(); challenge = undefined;
      button.removeEventListener('click', click);
      form.removeEventListener('input', changed); form.removeEventListener('change', changed);
      view?.removeEventListener('hashchange', navigate); view?.removeEventListener('pagehide', hide);
      view?.removeEventListener('pageshow', show);
      observer?.disconnect(); controls.delete(form); render();
    };
    const controller: LoginVerificationControl = {
      consume() {
        sync();
        if (disposed) throw new Error(text('登录验证已取消，请重新打开登录。', 'Verification cancelled. Reopen sign in.'));
        if (pending) throw new Error(text('登录验证已用于正在提交的请求，请等待。', 'A sign-in request is already pending. Please wait.'));
        if (state === 'disabled') { pending = true; render(); return null; }
        if (state !== 'verified' || !proof) { focus(); throw new Error(text('请先完成滑块验证，通过后再登录。', 'Complete slider verification before signing in.')); }
        const value = proof; pending = true; reset(); return value;
      },
      dispose, reset: () => reset(), sync,
      release() { pending = false; sync(); },
    };
    controls.set(form, { namespace, controller });
    button.addEventListener('click', click);
    form.addEventListener('input', changed); form.addEventListener('change', changed);
    view?.addEventListener('hashchange', navigate); view?.addEventListener('pagehide', hide);
    view?.addEventListener('pageshow', show);
    observer?.observe(form.ownerDocument.documentElement, { childList: true, subtree: true });
    function prepare() {
      if (disposed || suspended || pending) return;
      generation++; attempt?.abort(); clearProof(); challenge = undefined;
      state = 'loading'; expired = false; render();
      const initial = new AbortController(); attempt = initial;
      const current = generation;
      void acquire.prepare(form, namespace, { signal: initial.signal }).then(value => {
        if (disposed || initial.signal.aborted || generation !== current) return;
        challenge = value; state = value.enabled ? 'ready' : 'disabled'; render();
      }, error => { if (!initial.signal.aborted && current === generation) report(error); }).finally(() => { if (attempt === initial) attempt = undefined; });
    }
    prepare();
    return controller;
  };
}

export const mountLoginVerificationControl = createLoginVerificationControlMounter();
