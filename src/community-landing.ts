import { mountAstral } from "./community-atlas/runtime.ts";

let host: HTMLElement | null = null,
  dispose: (() => void) | null = null,
  removeFailure: (() => void) | null = null;
let scene: "atlas" | undefined;
function clearLanding() {
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
  message.textContent = "星座组件未能加载，当前保留原始背景。";
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
      "Community sky unavailable; original background retained.",
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
