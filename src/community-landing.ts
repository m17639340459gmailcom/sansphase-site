import { mountAstral } from "./community-atlas/runtime.ts";
import { prepareCinematicBackdrop } from "./community-atlas/cinematic-backdrop.ts";

let host: HTMLElement | null = null,
  dispose: (() => void) | null = null,
  removeFailure: (() => void) | null = null;
let scene: "atlas" | undefined;
let prepared = false;
let preparation: Promise<void> | null = null;
let preparationFailed = false;
let mountGeneration = 0;

export function prepareCommunityLanding(): Promise<void> {
  if (prepared) return Promise.resolve();
  if (!preparation) preparation = prepareCinematicBackdrop().then(() => {
    prepared = true;
    preparationFailed = false;
  }, () => { preparationFailed = true; });
  return preparation;
}

function clearLanding() {
  mountGeneration++;
  removeFailure?.();
  removeFailure = null;
  const release = dispose;
  dispose = null;
  try {
    release?.();
  } catch (error) {
    console.warn("Community sky cleanup failed.", error);
  } finally {
    document.body.removeAttribute("data-orbit-experiment");
    document.body.removeAttribute("data-orbit-scene");
  }
}

function showFailure(failedHost: HTMLElement) {
  removeFailure?.();
  const alert = document.createElement("aside");
  alert.className = "community-sky-error";
  alert.setAttribute("role", "alert");
  alert.dataset.communitySkyError = "true";
  const message = document.createElement("span");
  message.textContent = "星座背景未能加载，当前显示简洁背景。社区入口仍可使用。";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.dataset.communitySkyRetry = "true";
  retry.textContent = "重试星座";
  const onRetry = () => {
    if (host !== failedHost || !failedHost.isConnected) {
      sync();
      return;
    }
    clearLanding();
    if (preparationFailed) { preparation = null; preparationFailed = false; }
    mountCurrent();
  };
  retry.addEventListener("click", onRetry);
  alert.append(message, retry);
  // Keep feedback outside the decorative host, which is aria-hidden.
  document.body.append(alert);
  removeFailure = () => {
    retry.removeEventListener("click", onRetry);
    alert.remove();
  };
}

function mountCurrent() {
  if (!host) return;
  const mountedHost = host;
  const generation = mountGeneration;
  if (!prepared && !preparationFailed) {
    void prepareCommunityLanding().then(() => {
      if (generation !== mountGeneration || host !== mountedHost || !mountedHost.isConnected) return;
      mountCurrent();
    });
    return;
  }
  if (preparationFailed) { showFailure(mountedHost); return; }
  let active = true;
  try {
    document.body.dataset.orbitExperiment = "astral";
    if (scene) document.body.dataset.orbitScene = scene;
    const release = mountAstral(mountedHost, { scene, onError() {
      if (!active || host !== mountedHost || !mountedHost.isConnected) return;
      active = false;
      clearLanding();
      showFailure(mountedHost);
    } });
    if (active) dispose = () => { active = false; release(); };
    else release();
  } catch (error) {
    active = false;
    document.body.removeAttribute("data-orbit-experiment");
    document.body.removeAttribute("data-orbit-scene");
    host.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
    showFailure(host);
    console.warn(
      "Community sky unavailable; simple background retained.",
      error,
    );
  }
}

function sync() {
  const next = document.querySelector<HTMLElement>(
        '[data-community="landing"] .community-orbits',
      );
  const nextScene = next ? "atlas" : undefined;
  if (next === host && nextScene === scene) return;
  clearLanding();
  host = next;
  scene = nextScene;
  mountCurrent();
}
// Only the landing sky host is enhanced. The observer survives route
// changes; each replaced node disposes its renderer before another is mounted.
const observer = new MutationObserver(sync);
observer.observe(document.getElementById("main") || document.body, {
  childList: true,
  subtree: true,
});
sync();
window.addEventListener("popstate", sync);
window.addEventListener("pagehide", () => {
  observer.disconnect();
  window.removeEventListener("popstate", sync);
  clearLanding();
  host = null;
  scene = undefined;
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  observer.observe(document.getElementById("main") || document.body, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", sync);
  sync();
});
