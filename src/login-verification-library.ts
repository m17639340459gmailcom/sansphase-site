import { loginChallengeLifetimeMs, loginProofLifetimeMs, remainingLoginResponseLifetimeMs } from './login-verification.mjs';
import type { LoginVerificationNamespace, MountLoginSliderPanel, SliderLoginChallenge } from './login-verification.mjs';

export type LoginSliderTrack = {
  bgImageWidth: number; bgImageHeight: number; templateImageWidth: number; templateImageHeight: number;
  startTime: number; stopTime: number; left: number; top: number;
  trackList: { x: number; y: number; t: number; type: 'DOWN' | 'MOVE' | 'UP' }[];
};
type SolverDependencies = { request?: typeof fetch; now?: () => number; imageTimeoutMs?: number; interactionTimeoutMs?: number; verifyTimeoutMs?: number };
const cancelled = () => new DOMException('登录验证已取消。', 'AbortError');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const actionError = (name: string, message: string) => { const error = new Error(message); error.name = name; return error; };

/** Custom login UX collects real input only. Tianai verifies the puzzle on the server. */
export function createLoginSliderSolver({ request = (...args: Parameters<typeof fetch>) => fetch(...args), now = () => performance.now(), imageTimeoutMs = 15_000, interactionTimeoutMs = 120_000, verifyTimeoutMs = 25_000 }: SolverDependencies = {}) {
  return function solveLoginChallenge(form: HTMLFormElement, challenge: SliderLoginChallenge, signal: AbortSignal, namespace: LoginVerificationNamespace, remainingLifetimeMs?: () => number, onProofLifetimeMs?: (remainingMs: number) => void, mountPanel?: MountLoginSliderPanel): Promise<string> {
    if (signal.aborted || !form.isConnected) return Promise.reject(signal.reason ?? cancelled());
    const document = form.ownerDocument, view = document.defaultView;
    const english = document.documentElement.lang.startsWith('en');
    const text = (zh: string, en: string) => english ? en : zh;
    const lifetimeMs = Math.min(interactionTimeoutMs, remainingLifetimeMs?.() ?? loginChallengeLifetimeMs);
    if (lifetimeMs <= 0) return Promise.reject(new Error(text('验证已过期，请重试。', 'Verification expired. Please retry.')));
    // Keep the engine's existing epoch-shaped track contract, but count movement
    // with a monotonic clock so a device clock correction cannot reverse a drag.
    const startedAt = now(), epoch = Date.now();
    const trackTime = () => epoch + Math.max(0, Math.floor(now() - startedAt));
    const panel = document.createElement('div'); panel.className = 'login-slider'; panel.setAttribute('data-login-slider', ''); panel.setAttribute('aria-busy', 'true');
    panel.innerHTML = `<div class="login-slider-toolbar"><span class="login-slider-status" data-login-slider-status aria-live="polite">${text('正在准备拼图…', 'Preparing puzzle…')}</span><div class="login-slider-actions"><button class="login-slider-action" type="button" data-login-slider-refresh>${text('刷新', 'Refresh')}</button><button class="login-slider-action" type="button" data-login-slider-cancel>${text('取消', 'Cancel')}</button></div></div><div class="login-slider-images"><img class="login-slider-background" data-login-slider-background alt="${text('拖动拼图填补空缺', 'Slide the puzzle piece into the gap')}" draggable="false"><img class="login-slider-template" data-login-slider-template alt="" aria-hidden="true" draggable="false"></div><div class="login-slider-track" data-login-slider-track><span class="login-slider-track-label">${text('按住滑块，拖动完成拼图', 'Drag the slider to complete the puzzle')}</span><button class="login-slider-thumb" data-login-slider-thumb type="button" role="slider" aria-label="${text('拼图滑块，方向键移动，回车验证', 'Puzzle slider. Arrow keys move; Enter verifies')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 6 6 6-6 6"/></svg></button></div>`;
    const background = panel.querySelector<HTMLImageElement>('[data-login-slider-background]')!;
    const piece = panel.querySelector<HTMLImageElement>('[data-login-slider-template]')!;
    const thumb = panel.querySelector<HTMLButtonElement>('[data-login-slider-thumb]')!;
    const status = panel.querySelector<HTMLElement>('[data-login-slider-status]')!;
    const refresh = panel.querySelector<HTMLButtonElement>('[data-login-slider-refresh]')!;
    const cancel = panel.querySelector<HTMLButtonElement>('[data-login-slider-cancel]')!;
    background.width = challenge.backgroundImageWidth; background.height = challenge.backgroundImageHeight;
    piece.width = challenge.templateImageWidth; piece.height = challenge.templateImageHeight;
    piece.style.width = `${challenge.templateImageWidth / challenge.backgroundImageWidth * 100}%`;
    const control = form.querySelector<HTMLButtonElement>('[data-login-verification-control]');
    const originalLocation = view?.location.href;
    const originalScroll = { x: view?.scrollX ?? 0, y: view?.scrollY ?? 0 };
    const scrollParents: { element: HTMLElement; top: number; left: number }[] = [];
    const mountFloatingPanel = control && mountPanel;
    if (!mountFloatingPanel) {
      for (let element = form.parentElement; element; element = element.parentElement) {
        if (element !== document.scrollingElement) scrollParents.push({ element, top: element.scrollTop, left: element.scrollLeft });
      }
    }
    panel.querySelector<HTMLElement>('.login-slider-images')!.style.aspectRatio = `${challenge.backgroundImageWidth} / ${challenge.backgroundImageHeight}`;
    return new Promise((resolve, reject) => {
      let settled = false, imagesReady = false, checking = false, leaving = false;
      let unmountPanel: (() => void) | undefined;
      let width = 0, height = 0, pieceWidth = 0, left = 0, captured: number | undefined;
      let drag: { mode: 'pointer' | 'keyboard'; pointerId?: number; x: number; y: number; initialLeft: number; startTime: number; points: LoginSliderTrack['trackList'] } | undefined;
      let verification: AbortController | undefined, verificationTimer: ReturnType<typeof setTimeout> | undefined;
      const imageTimer = setTimeout(() => finish(new Error(text('拼图加载超时，请重试。', 'Puzzle loading timed out. Please retry.'))), imageTimeoutMs);
      const lifetimeTimer = setTimeout(() => finish(new Error(text('登录验证超时，请重试。', 'Verification timed out. Please retry.'))), Math.max(1, lifetimeMs));
      const releaseCapture = () => {
        const id = captured; captured = undefined;
        if (id !== undefined) { try { if (thumb.hasPointerCapture?.(id)) thumb.releasePointerCapture(id); } catch { /* Detached nodes can lose capture before cleanup. */ } }
      };
      const observer = view?.MutationObserver ? new view.MutationObserver(() => { if (!form.isConnected) finish(signal.reason ?? cancelled()); }) : undefined;
      const resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(resized) : undefined;
      const cleanup = () => {
        clearTimeout(imageTimer); clearTimeout(lifetimeTimer); if (verificationTimer !== undefined) clearTimeout(verificationTimer);
        verification?.abort(); releaseCapture(); drag = undefined; observer?.disconnect(); resizeObserver?.disconnect();
        signal.removeEventListener('abort', abort);
        view?.removeEventListener('hashchange', navigate); view?.removeEventListener('pagehide', navigate);
        view?.removeEventListener('resize', resized); view?.removeEventListener('orientationchange', resized);
        view?.removeEventListener('pointermove', move); view?.removeEventListener('pointerup', up); view?.removeEventListener('pointercancel', pointerCancelled);
        thumb.removeEventListener('pointerdown', down); thumb.removeEventListener('lostpointercapture', captureLost); thumb.removeEventListener('keydown', key);
        refresh.removeEventListener('click', refreshClicked); cancel.removeEventListener('click', cancelClicked);
        for (const image of [background, piece]) { image.removeEventListener('load', loaded); image.removeEventListener('error', imageFailed); }
        const panelHadFocus = panel.contains(document.activeElement);
        panel.remove();
        unmountPanel?.();
        if (!leaving && form.isConnected && view?.location.href === originalLocation) {
          if (!mountFloatingPanel) {
            // Resolve the inline layout's scroll-anchor adjustment after removal.
            control?.getBoundingClientRect();
            for (const { element, top, left } of scrollParents) if (element.scrollTop !== top || element.scrollLeft !== left) element.scrollTo({ top, left, behavior: 'instant' });
            if (view && (view.scrollX !== originalScroll.x || view.scrollY !== originalScroll.y)) view.scrollTo({ left: originalScroll.x, top: originalScroll.y, behavior: 'instant' });
          }
          if (panelHadFocus && control) view?.requestAnimationFrame(() => {
            // The control's promise handler re-enables its button before this frame.
            if (form.isConnected && view.location.href === originalLocation && document.activeElement === document.body) control.focus({ preventScroll: true });
          });
        }
      };
      function finish(error?: unknown, proof?: string) {
        if (settled) return;
        settled = true; cleanup();
        if (error !== undefined) reject(error); else if (proof) resolve(proof); else reject(new Error(text('登录验证失败，请重试。', 'Login verification failed. Please retry.')));
      }
      const abort = () => { leaving = true; finish(signal.reason ?? cancelled()); };
      const navigate = (event: Event) => {
        if (event.type === 'hashchange' && view?.location.href === originalLocation) return;
        leaving = true; finish(cancelled());
      };
      const refreshClicked = () => finish(actionError('LoginVerificationRefreshError', text('请刷新拼图。', 'Refresh the puzzle.')));
      const cancelClicked = () => finish(actionError('LoginVerificationCancelledError', text('已取消拼图验证。', 'Puzzle verification cancelled.')));
      const imageFailed = () => finish(new Error(text('拼图加载失败，请重试。', 'Puzzle failed to load. Please retry.')));
      function measure() {
        const bounds = background.getBoundingClientRect();
        const nextWidth = Math.round(bounds.width), nextHeight = Math.round(bounds.height);
        const nextPieceWidth = Math.round(nextWidth * challenge.templateImageWidth / challenge.backgroundImageWidth);
        if (nextWidth < 100 || nextWidth > 1200 || nextHeight < 60 || nextHeight > 720 || nextPieceWidth < 1 || nextPieceWidth >= nextWidth) { imageFailed(); return; }
        return { width: nextWidth, height: nextHeight, pieceWidth: nextPieceWidth };
      }
      function resized() {
        if (!imagesReady || settled) return;
        const bounds = measure(); if (!bounds) return;
        if (bounds.width === width && bounds.height === height && bounds.pieceWidth === pieceWidth) return;
        if (drag || checking) { finish(new Error(text('页面尺寸已变化，请重新打开滑块验证。', 'The page size changed. Please reopen slider verification.'))); return; }
        width = bounds.width; height = bounds.height; pieceWidth = bounds.pieceWidth; position(0);
      }
      let loadedImages = 0;
      function loaded() {
        loadedImages++;
        if (loadedImages !== 2 || settled) return;
        clearTimeout(imageTimer);
        if (background.naturalWidth !== challenge.backgroundImageWidth || background.naturalHeight !== challenge.backgroundImageHeight || piece.naturalWidth !== challenge.templateImageWidth || piece.naturalHeight !== challenge.templateImageHeight) { imageFailed(); return; }
        const bounds = measure(); if (!bounds) return;
        width = bounds.width; height = bounds.height; pieceWidth = bounds.pieceWidth;
        imagesReady = true; thumb.disabled = false; panel.setAttribute('aria-busy', 'false');
        status.textContent = text('拖动拼图填补空缺', 'Slide the puzzle piece into the gap'); position(0); thumb.focus({ preventScroll: true });
        // Scrolling here is only needed for the inline forms.
        if (!mountFloatingPanel) panel.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      const position = (value: number) => {
        left = Math.round(Math.max(0, Math.min(width - pieceWidth, value)));
        piece.style.transform = `translateX(${left}px)`; thumb.style.transform = `translateX(${left}px)`;
        thumb.setAttribute('aria-valuenow', String(Math.round(left / (width - pieceWidth) * 100)));
      };
      const addPoint = (x: number, y: number, type: 'DOWN' | 'MOVE' | 'UP') => {
        if (!drag) return;
        if (drag.points.length >= Math.min(512, width * 5)) { finish(new Error(text('拖动时间过长，请重试。', 'The drag took too long. Please retry.'))); return; }
        drag.points.push({ x, y, t: Math.max(0, trackTime() - drag.startTime), type });
      };
      const start = (mode: 'pointer' | 'keyboard', x: number, y: number, pointerId?: number) => {
        resized();
        if (!imagesReady || checking || settled || drag) return false;
        drag = { mode, pointerId, x, y, initialLeft: left, startTime: trackTime(), points: [] }; addPoint(0, 0, 'DOWN'); panel.dataset.state = 'dragging'; return true;
      };
      const pointerPosition = (event: PointerEvent) => {
        if (!drag) return;
        position(drag.initialLeft + event.clientX - drag.x);
      };
      function down(event: PointerEvent) {
        if (event.button !== 0 || event.isPrimary === false || !start('pointer', event.clientX, event.clientY, event.pointerId)) return;
        event.preventDefault(); try { thumb.setPointerCapture?.(event.pointerId); captured = event.pointerId; } catch { /* Window listeners retain continuity if capture is unavailable. */ }
      }
      function move(event: PointerEvent) {
        if (!drag || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId || checking) return;
        resized(); if (!drag || settled) return;
        event.preventDefault(); pointerPosition(event); addPoint(event.clientX - drag.x, event.clientY - drag.y, 'MOVE');
      }
      function up(event: PointerEvent) {
        if (!drag || drag.mode !== 'pointer' || event.pointerId !== drag.pointerId || checking) return;
        resized(); if (!drag || settled) return;
        event.preventDefault(); pointerPosition(event); addPoint(event.clientX - drag.x, event.clientY - drag.y, 'UP'); void verify();
      }
      function pointerCancelled(event: PointerEvent) {
        if (drag?.mode !== 'pointer' || drag.pointerId !== event.pointerId) return;
        drag = undefined; releaseCapture(); position(0); delete panel.dataset.state;
      }
      function captureLost(event: PointerEvent) { if (drag?.pointerId === event.pointerId) pointerCancelled(event); }
      function key(event: KeyboardEvent) {
        if (event.key === 'Escape') { event.preventDefault(); cancelClicked(); return; }
        resized();
        if (!imagesReady || checking || settled) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); if (!drag) start('keyboard', 0, 0); if (drag?.mode !== 'keyboard') return;
          position(left + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 3)); addPoint(left - drag.initialLeft, 0, 'MOVE');
        } else if (event.key === 'Enter' && drag?.mode === 'keyboard') { event.preventDefault(); addPoint(left - drag.initialLeft, 0, 'UP'); void verify(); }
      }
      async function verify() {
        resized();
        if (!drag || checking || settled) return;
        const movement = drag; drag = undefined; releaseCapture(); checking = true; thumb.disabled = true; panel.dataset.state = 'checking'; panel.setAttribute('aria-busy', 'true');
        status.textContent = text('正在检查拼图…', 'Checking the puzzle…');
        const track: LoginSliderTrack = { bgImageWidth: width, bgImageHeight: height, templateImageWidth: pieceWidth, templateImageHeight: height, startTime: movement.startTime, stopTime: trackTime(), left, top: 0, trackList: movement.points };
        const controller = new AbortController(); verification = controller;
        verificationTimer = setTimeout(() => { const error = new Error(text('登录验证请求超时，请重试。', 'Verification request timed out. Please retry.')); controller.abort(error); finish(error); }, verifyTimeoutMs);
        try {
          const requestStartedAt = now();
          const response = await request(`/api/${namespace}/login-challenge/verify`, { method: 'POST', credentials: 'same-origin', headers: { [namespace === 'author' ? 'X-Author-Request' : 'X-Reader-Request']: '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: challenge.token, track }), signal: controller.signal });
          resized();
          if (settled || controller.signal.aborted) return;
          if (!response.ok) throw new Error(text('拼图未通过验证，请重新拖动。', 'Puzzle verification failed. Please try again.'));
          const value: unknown = await response.json(); resized(); if (settled || controller.signal.aborted) return;
          if (!object(value) || typeof value.proof !== 'string' || value.proof.length < 1 || value.proof.length > 2048 || /\s/.test(value.proof) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)
            || value.expiresAt <= Math.max(0, challenge.expiresAt - loginChallengeLifetimeMs / 1000) || value.expiresAt > challenge.expiresAt) throw new Error(text('登录验证响应无效，请重试。', 'Invalid verification response. Please retry.'));
          const proofLifetimeMs = remainingLoginResponseLifetimeMs(value.expiresAt, response, requestStartedAt, now(), loginProofLifetimeMs);
          if (proofLifetimeMs <= 0) throw new Error(text('登录验证响应无效，请重试。', 'Invalid verification response. Please retry.'));
          onProofLifetimeMs?.(proofLifetimeMs);
          finish(undefined, value.proof);
        } catch (error) { if (!settled) finish(error); }
      }
      signal.addEventListener('abort', abort, { once: true }); view?.addEventListener('hashchange', navigate); view?.addEventListener('pagehide', navigate);
      view?.addEventListener('resize', resized); view?.addEventListener('orientationchange', resized); resizeObserver?.observe(background);
      view?.addEventListener('pointermove', move, { passive: false }); view?.addEventListener('pointerup', up, { passive: false }); view?.addEventListener('pointercancel', pointerCancelled);
      thumb.addEventListener('pointerdown', down); thumb.addEventListener('lostpointercapture', captureLost); thumb.addEventListener('keydown', key);
      refresh.addEventListener('click', refreshClicked); cancel.addEventListener('click', cancelClicked);
      observer?.observe(document.documentElement, { childList: true, subtree: true });
      for (const image of [background, piece]) { image.addEventListener('load', loaded, { once: true }); image.addEventListener('error', imageFailed, { once: true }); }
      const loadImages = () => {
        if (settled) return;
        if (signal.aborted || !form.isConnected) { finish(signal.reason ?? cancelled()); return; }
        background.src = challenge.backgroundImage; piece.src = challenge.templateImage;
      };
      try {
        if (control && mountFloatingPanel) {
          const mounted = mountFloatingPanel(panel, control, cancelClicked);
          unmountPanel = mounted.unmount;
          void mounted.ready.then(loadImages, error => finish(error));
        } else {
          if (control) control.after(panel); else form.append(panel);
          loadImages();
        }
      } catch (error) {
        finish(error);
      }
    });
  };
}
export const solveLoginChallenge = createLoginSliderSolver();
