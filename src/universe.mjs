import { escapeHTML as esc } from "./core.mjs";
import { universeScenes } from "./universe-scenes.mjs";
import { chapterArrow } from "./chapter-icons.mjs";
import { loaderDial, reticleScale } from "./loader-dial.mjs";
import { blackHoleView, descentReadout } from "./black-hole-view.mjs";
import { journeyStep } from "./journey.mjs";

export function universeMarkup(english = false) {
  const s = universeScenes[0];
  return `<section class="universe-home" aria-busy="true" data-index="0" data-scene="${s.id}">
    <div class="universe-stage" tabindex="0" role="region" aria-describedby="universe-instructions" aria-label="${english ? "Interactive universe" : "可交互的宇宙"}"><canvas class="universe-canvas" aria-hidden="true"></canvas><div class="chapter-shade" aria-hidden="true"></div><section class="chapter-copy" aria-labelledby="chapter-title" hidden></section><svg class="chapter-reticle" viewBox="0 0 200 200" aria-hidden="true"><circle class="reticle-outer" cx="100" cy="100" r="93" pathLength="1"></circle><path class="reticle-scale" d="${reticleScale}"></path><circle class="reticle-ring" cx="100" cy="100" r="62" pathLength="1"></circle><path class="reticle-ticks" d="M100 0v36M100 164v36M0 100h36M164 100h36"></path><circle class="reticle-core" cx="100" cy="100" r="1.6"></circle></svg></div>
    <h1 class="sr-only">無相</h1>
    <div class="universe-loader">${loaderDial}<p class="loader-caption"><span class="universe-load-label" role="status" aria-live="polite">${english ? "Preparing your space" : "正在准备星空"}</span><span class="universe-load-percent" aria-hidden="true">0%</span></p><div class="universe-load-track" role="progressbar" aria-label="${english ? "Page preparation" : "页面准备进度"}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div></div>
    <nav class="universe-rail" aria-label="${english ? "Scenes" : "场景"}"><ol>${universeScenes.map((scene, i) => `<li><button type="button" data-chapter="${i}"${i === 0 ? ' aria-current="step"' : ""}><span class="rail-no">${String(i + 1).padStart(2, "0")}</span><span class="rail-name">${esc(english ? scene.rail[1] : scene.rail[0])}</span></button></li>`).join("")}</ol><span class="rail-track" aria-hidden="true"><span class="rail-fill"></span></span></nav>
    <p class="universe-descent" aria-hidden="true"><span>DESCENT · ${english ? "FALLING IN" : "下潜"}</span><span class="universe-descent-value"></span></p>
    <p class="sr-only" id="universe-instructions" aria-live="polite">${esc(english ? s.ariaLabelEn : s.ariaLabel)}</p>
    <div class="universe-feedback" hidden><p class="universe-status" role="status" aria-live="polite"></p><button class="universe-retry" type="button" hidden></button><a class="universe-continue" href="#/notes">${english ? "Browse content" : "先浏览内容"}</a></div>
  </section>`;
}

export function mountUniverse(
  root,
  {
    english = false,
    isBlocked = () => false,
    loadRenderer = () => import("./cosmos.bundle.mjs"),
    prepareContent,
    initiallyCovered = false,
    loadTimeoutMs = 15000,
    onPrepared = () => {},
    // Optional live facts per chapter: (sceneId, english) =>
    // { facts?: string, items?: [{ href, title, meta }] } | null
    chapterDetails = () => null,
  } = {},
) {
  const doc = root.ownerDocument,
    w = doc.defaultView;
  const stage = root.querySelector(".universe-stage"),
    canvas = root.querySelector("canvas");
  const retry = root.querySelector(".universe-retry"),
    status = root.querySelector(".universe-status");
  const feedback = root.querySelector(".universe-feedback"),
    instructions = root.querySelector("#universe-instructions");
  const copy = root.querySelector(".chapter-copy");
  const rail = root.querySelector(".universe-rail");
  // Every element of the copy carries a stagger index (--n, --i per title
  // character) so CSS can reveal it in sequence from the one continuous
  // --chapter-visibility value: forwards on arrival, backwards on leaving.
  function titleMarkup(title) {
    let i = 0;
    return title
      .split(/[\s\u3000]+/)
      .map((word) => `<span class="chapter-word">${[...word].map((char) => `<span class="chapter-char" style="--i:${i++}">${esc(char)}</span>`).join("")}</span>`)
      .join(" ");
  }
  function copyMarkup(scene) {
    const title = text(scene.title, scene.titleEn);
    const details = chapterDetails(scene.id, english) || {};
    const items = (details.items || []).slice(0, 3);
    return `<p class="chapter-label" style="--n:0"><span class="chapter-count">${String(index + 1).padStart(2, "0")} / ${String(universeScenes.length).padStart(2, "0")}</span> · ${esc(scene.label)}</p><h2 id="chapter-title" aria-label="${esc(title)}">${titleMarkup(title)}</h2><p class="chapter-description" style="--n:2">${esc(text(scene.description, scene.descriptionEn))}</p><div class="chapter-links" style="--n:3">${scene.links.map((link) => `<a href="${esc(link.href)}">${esc(text(link.zh, link.en))}${chapterArrow}</a>`).join("")}</div>${details.facts ? `<p class="chapter-facts" style="--n:4">${esc(details.facts)}</p>` : ""}${items.length ? `<ol class="chapter-latest" aria-label="${esc(text("最新文章", "Latest articles"))}">${items.map((item, n) => `<li style="--n:${5 + n}"><a href="${esc(item.href)}"><span class="chapter-latest-meta">${esc(item.meta || "")}</span><span class="chapter-latest-title">${esc(item.title)}</span></a></li>`).join("")}</ol>` : ""}`;
  }
  let copyKey = "",
    progress = 0,
    targetProgress = 0,
    scrolling = false;
  const preference = w.matchMedia?.("(prefers-reduced-motion: reduce)");
  let reduced = preference?.matches ?? false,
    covered = initiallyCovered;
  let started = false,
    preparation,
    loadPercent = 0,
    loadPhase = "scene";
  let renderer,
    disposed = false,
    ready = false,
    failed = false;
  let index = 0,
    generation = 0,
    pointer = null,
    orbitX = 0,
    orbitY = 0;
  let loadTimer, wheelTimer, returnSwapTimer, returnEndTimer;
  // Set while a rail jump across several chapters flies as one step.
  let jump = null;
  let returnState = "idle";
  const listeners = [];
  const touches = new Set();
  let multiTouch = false;
  const text = (zh, en) => (english ? en : zh);
  const listen = (target, name, fn, options) => {
    target.addEventListener(name, fn, options);
    listeners.push(() => target.removeEventListener(name, fn, options));
  };
  const paused = () => covered || doc.hidden || failed;
  const usable = () =>
    !disposed &&
    !covered &&
    !doc.hidden &&
    !isBlocked() &&
    ready &&
    !failed &&
    returnState === "idle";
  const isControl = (target) =>
    Boolean(
      target?.closest?.(
        'a,button,input,textarea,select,[contenteditable="true"],[role="dialog"]',
      ),
    );
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const resetViewPointer = () => renderer?.setPointer(0, 0, { reset: true });
  const openingInteractive = () => targetProgress === 0 && progress < 0.01;
  const readOrbit = () => {
    const current = renderer?.getOrbit?.();
    if (current) {
      orbitX = current.x;
      orbitY = 0;
    }
  };
  const point = (event) => {
    const r = stage.getBoundingClientRect();
    return [
      clamp(((event.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1),
      clamp(1 - ((event.clientY - r.top) / Math.max(1, r.height)) * 2, -1, 1),
    ];
  };
  function sync() {
    const preparing = !covered && !ready;
    doc.documentElement.classList.toggle('is-site-preparing', preparing);
    doc.querySelectorAll('#site-header, #site-footer, .skip-link').forEach(element => { element.inert = preparing; });
    const s = universeScenes[index];
    root.dataset.index = String(index);
    root.dataset.scene = universeScenes[index].id;
    root.setAttribute("aria-busy", String(!ready && !failed));
    root.setAttribute("aria-hidden", String(covered));
    root.inert = covered;
    root.classList.toggle("is-ready", ready);
    const value = ready ? 100 : Math.min(99, Math.floor(loadPercent));
    root.querySelector(".universe-load-percent").textContent = `${value}%`;
    root
      .querySelector(".universe-load-track")
      .setAttribute("aria-valuenow", String(value));
    root.querySelector(".universe-loader").style.setProperty("--load", String(value / 100));
    root.querySelector(".universe-load-label").textContent =
      loadPhase === "images"
        ? text("正在准备页面图片", "Preparing page images")
        : text("正在准备星空", "Preparing your space");
    root
      .querySelector(".universe-loader")
      .setAttribute("aria-hidden", String(ready || failed || covered));
    root.classList.toggle("has-error", failed);
    root.classList.toggle("is-covered", covered);
    root.classList.toggle("is-reduced", reduced);
    root.classList.toggle("is-returning-out", returnState === "out");
    root.classList.toggle("is-returning-in", returnState === "in");
    root.dataset.returning = returnState;
    root.dataset.interactive = String(
      openingInteractive() && !covered && returnState === "idle",
    );
    // Copy, shade and readouts follow the visual journey: during a rail jump
    // that is one virtual step, so no intermediate chapter surfaces.
    const visual = journeyStep(progress, jump).virtual;
    const distance = Math.abs(visual - Math.round(visual));
    // The copy follows the actual scene position even after the wheel stops.
    const visibility = 1 - clamp((distance - 0.08) / 0.4, 0, 1);
    root.dataset.progress = progress.toFixed(4);
    root.style.setProperty("--chapter-visibility", visibility.toFixed(3));
    root.style.setProperty("--chapter-shift", `${(visual - Math.round(visual)) * -90}px`);
    root.style.setProperty(
      "--journey-shade",
      clamp(visual / 0.6, 0, 1).toFixed(3),
    );
    // The opening copy is pulled towards the hole while the camera dives; the
    // readout only exists during the fall itself.
    const hole = blackHoleView(visual, {
      portrait: w.innerWidth / Math.max(1, w.innerHeight) < 0.85,
    });
    root.style.setProperty("--descent", hole.readout.toFixed(3));
    const readout = hole.readout > 0 ? descentReadout(hole, english) : "";
    const readoutNode = root.querySelector(".universe-descent-value");
    if (readoutNode.textContent !== readout) readoutNode.textContent = readout;
    root.querySelector(".universe-descent span").textContent = `DESCENT · ${text("下潜", "FALLING IN")}`;
    const chapterCopy = universeScenes[index];
    const nextCopyKey = `${index}:${english}`;
    if (copyKey !== nextCopyKey) {
      copyKey = nextCopyKey;
      copy.innerHTML = chapterCopy.links ? copyMarkup(chapterCopy) : "";
      rail.setAttribute("aria-label", text("场景", "Scenes"));
      rail.querySelectorAll("button").forEach((button, i) => {
        if (i === index) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
        button.querySelector(".rail-name").textContent = text(...universeScenes[i].rail);
      });
    }
    root.style.setProperty("--rail", (progress / (universeScenes.length - 1)).toFixed(4));
    // 0 while resting on a chapter, 1 halfway between two: marks that only
    // belong to the journey (the reticle) fade out once a chapter settles.
    root.style.setProperty("--transit", Math.abs(Math.sin(Math.PI * visual)).toFixed(3));
    copy.hidden = !chapterCopy.links || !ready || failed;
    copy.inert =
      covered || returnState !== "idle" || visibility < 0.5 || copy.hidden;
    copy.setAttribute("aria-hidden", String(copy.inert));
    stage.setAttribute(
      "aria-label",
      text("可交互的宇宙", "Interactive universe"),
    );
    const instructionText = `${english ? s.ariaLabelEn : s.ariaLabel}${english ? ". " : "。"}${text(
      "滚轮向下或向上滚动一次切换一幕；手机向上划进入下一幕，向下划返回上一幕。也可使用空格或上下方向键。首屏可用左右方向键调整观察角度。",
      "Scroll down or up once to change scenes. On touchscreens, swipe up for the next scene or down for the previous scene. You can also use Space or the up and down arrow keys. On the opening, use the left and right arrow keys to adjust the view.",
    )}`;
    if (instructions.textContent !== instructionText)
      instructions.textContent = instructionText;
    status.textContent = failed
      ? text(
          "部分页面资源尚未准备完成，可以重试，或通过顶部导航先浏览内容。",
          "Some page resources could not be prepared. Retry, or browse the content.",
        )
      : "";
    feedback.hidden = !failed;
    retry.hidden = !failed;
    retry.textContent = text("重新加载", "Retry loading");
    root.querySelector(".universe-continue").textContent = text(
      "先浏览内容",
      "Browse content",
    );
  }
  function syncLoadTimer() {
    if (disposed || !started || ready || failed || covered || doc.hidden) {
      w.clearTimeout(loadTimer);
      loadTimer = undefined;
    } else if (loadTimer === undefined) {
      const token = generation;
      loadTimer = w.setTimeout(() => fail(token), loadTimeoutMs);
    }
  }
  function syncMotion() {
    syncLoadTimer();
    renderer?.setReducedMotion(reduced);
    renderer?.setPaused(paused());
    if (ready && !paused()) renderer?.startPresentation?.();
  }
  function finishChapter() {
    w.clearTimeout(wheelTimer);
    wheelTimer = undefined;
    scrolling = false;
    updateProgress(targetProgress);
  }
  function finishReturn(reveal = false) {
    w.clearTimeout(returnSwapTimer);
    w.clearTimeout(returnEndTimer);
    returnSwapTimer = returnEndTimer = undefined;
    if (returnState === "idle") return;
    const needsSwap = returnState === "out";
    returnState = reveal ? "in" : "idle";
    if (needsSwap) {
      jump = null;
      renderer?.setChapter(0, { immediate: true });
      updateProgress(0);
    }
    sync();
    if (reveal)
      returnEndTimer = w.setTimeout(() => {
        returnEndTimer = undefined;
        returnState = "idle";
        sync();
      }, 700);
  }
  function updateProgress(value) {
    if (disposed || !Number.isFinite(value)) return;
    if (Math.abs(value - progress) < 0.0000001) return;
    progress = clamp(value, 0, universeScenes.length - 1);
    const journey = journeyStep(progress, jump);
    index = journey.chapterOf(Math.round(journey.virtual));
    if (Math.abs(progress - targetProgress) < 0.0002 && !wheelTimer)
      scrolling = false;
    sync();
  }
  function fail(token) {
    if (disposed || token !== generation) return;
    finishReturn();
    w.clearTimeout(loadTimer);
    loadTimer = undefined;
    failed = true;
    preparation?.abort();
    ready = false;
    renderer?.setPaused(true);
    sync();
  }
  async function start() {
    if (disposed) return;
    started = true;
    preparation?.abort();
    preparation = new AbortController();
    loadPercent = 0;
    loadPhase = "scene";
    finishReturn();
    const token = ++generation;
    [loadTimer, wheelTimer].forEach((timer) => w.clearTimeout(timer));
    loadTimer = wheelTimer = undefined;
    scrolling = false;
    clearPointer();
    touches.clear();
    multiTouch = false;
    renderer?.dispose();
    renderer = null;
    failed = false;
    ready = false;
    sync();
    syncLoadTimer();
    try {
      const { mountCosmos } = await loadRenderer();
      if (disposed || token !== generation || failed) return;
      loadPercent = 10;
      sync();
      let readySignaled = false,
        contentReady = !prepareContent,
        contentStarted = false;
      const finishReady = () => {
        if (
          ready ||
          disposed ||
          token !== generation ||
          failed ||
          !renderer ||
          !readySignaled ||
          !contentReady
        )
          return;
        w.clearTimeout(loadTimer);
        loadTimer = undefined;
        ready = true;
        sync();
        syncMotion();
        onPrepared();
      };
      const api = mountCosmos(canvas, {
        reducedMotion: reduced,
        onReady() {
          if (disposed || token !== generation || failed) return;
          readySignaled = true;
          if (prepareContent && !contentStarted) {
            contentStarted = true;
            loadPhase = "images";
            loadPercent = Math.max(loadPercent, 70);
            sync();
            const signal = preparation.signal;
            Promise.resolve()
              .then(() =>
                prepareContent({
                  signal,
                  onProgress: (value) => {
                    if (token === generation && !disposed && !failed) {
                      loadPercent = Math.max(
                        loadPercent,
                        70 + 25 * Math.max(0, Math.min(1, value)),
                      );
                      sync();
                    }
                  },
                }),
              )
              .then(() => doc.fonts?.ready)
              .then(() => {
                if (token !== generation || disposed || failed) return;
                contentReady = true;
                finishReady();
              })
              .catch(() => fail(token));
          }
          finishReady();
        },
        onLoadProgress(value) {
          if (token === generation && !disposed && !failed) {
            loadPercent = Math.max(
              loadPercent,
              10 + 60 * Math.max(0, Math.min(1, value)),
            );
            sync();
          }
        },
        onError() {
          fail(token);
        },
        onProgress(value) {
          if (token === generation && !disposed && !failed)
            updateProgress(value);
        },
      });
      if (disposed || token !== generation || failed) {
        api.dispose();
        return;
      }
      renderer = api;
      jump = null;
      renderer.setChapter(targetProgress, { continuous: true });
      renderer.setOrbit(orbitX, orbitY);
      syncMotion();
      finishReady();
    } catch {
      fail(token);
    }
  }
  function setTravel(value, continuous = false, { rail = false } = {}) {
    if (!usable()) return;
    // A rail jump owns the scene until it arrives.
    if (jump && Math.abs(progress - targetProgress) >= 0.0002) return;
    const from = Math.round(targetProgress);
    targetProgress = clamp(value, 0, universeScenes.length - 1);
    jump = rail && Math.abs(targetProgress - from) > 1 ? { from, to: targetProgress } : null;
    if (targetProgress > 0) resetViewPointer();
    scrolling = !reduced;
    renderer.setChapter(targetProgress, { continuous, jump });
    if (reduced) updateProgress(targetProgress);
    sync();
  }
  function changeChapter(direction) {
    setTravel(Math.round(targetProgress) + direction);
  }
  listen(retry, "click", start);
  listen(rail, "click", (event) => {
    const button = event.target.closest?.("button[data-chapter]");
    // Jumps start from a settled chapter, never from the middle of a flight.
    if (button && Math.abs(progress - targetProgress) < 0.0002)
      setTravel(Number(button.dataset.chapter), false, { rail: true });
  });
  listen(stage, "pointermove", (event) => {
    if (!usable() || multiTouch || (pointer && pointer.id !== event.pointerId))
      return;
    if (!pointer) {
      if (openingInteractive() && event.pointerType !== "touch")
        renderer.setPointer(...point(event));
      return;
    }
    const dx = event.clientX - pointer.x,
      dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 6) pointer.dragged = true;
    if (pointer.touch) {
      if (!pointer.axis && Math.hypot(dx, dy) >= 10) {
        if (Math.abs(dy) >= Math.abs(dx) * 1.2) pointer.axis = "vertical";
        else if (Math.abs(dx) >= Math.abs(dy) * 1.2)
          pointer.axis = "horizontal";
      }
      if (pointer.axis === "vertical") {
        // Decide a whole chapter on release, so a short or cancelled swipe
        // cannot strand the scene between chapters or interrupt its animation.
        return;
      }
      if (pointer.axis !== "horizontal") return;
    }
    if (!openingInteractive()) return;
    renderer.setPointer(...point(event));
    // Keep the reference's per-pixel response independent of viewport width.
    // Desktop travel is tuned up 1.8x for the requested more responsive turn;
    // touch already has a larger gain and retains its current behavior.
    const gain = event.pointerType === "touch" ? 0.015 : 0.009;
    orbitX += (event.clientX - pointer.lastX) * gain;
    orbitY = 0;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    renderer.setOrbit(orbitX, orbitY, { dragging: true });
  });
  listen(stage, "pointerdown", (event) => {
    if (event.pointerType === "touch") {
      touches.add(event.pointerId);
      if (touches.size > 1) {
        multiTouch = true;
        clearPointer();
        resetViewPointer();
      }
    }
    if (
      !usable() ||
      (event.pointerType === "touch" && Math.abs(progress - targetProgress) >= 0.0002) ||
      (!openingInteractive() && event.pointerType !== "touch") ||
      multiTouch ||
      pointer ||
      event.isPrimary === false ||
      event.button !== 0 ||
      isControl(event.target)
    )
      return;
    stage.focus({ preventScroll: true });
    if (openingInteractive()) {
      readOrbit();
      renderer.beginOrbit?.();
    }
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragged: false,
      touch: event.pointerType === "touch",
      axis: null,
      startProgress: targetProgress,
    };
    stage.setPointerCapture?.(event.pointerId);
    root.classList.add("is-dragging");
  });
  function clearPointer(cancel = true) {
    const id = pointer?.id;
    if (pointer) renderer?.endOrbit?.({ cancel });
    pointer = null;
    root.classList.remove("is-dragging");
    if (id !== undefined && stage.hasPointerCapture?.(id))
      stage.releasePointerCapture(id);
  }
  const endPointer = (event, cancel = false) => {
    if (event.pointerType === "touch" && event.type !== "lostpointercapture") {
      touches.delete(event.pointerId);
      if (!touches.size) multiTouch = false;
    }
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x,
      dy = event.clientY - pointer.y;
    const swipe =
      !cancel &&
      pointer.touch &&
      pointer.axis !== "horizontal" &&
      pointer.startProgress === targetProgress &&
      Math.abs(progress - targetProgress) < 0.0002 &&
      Math.abs(dy) >= 65 &&
      Math.abs(dy) >= Math.abs(dx) * 1.2;
    const click = !cancel && !pointer.dragged && Math.hypot(dx, dy) <= 6;
    const reset = cancel || pointer.touch;
    clearPointer(cancel);
    if (swipe) changeChapter(dy < 0 ? 1 : -1);
    else if (click && usable() && openingInteractive())
      renderer.pulse(...point(event));
    if (reset) resetViewPointer();
  };
  listen(w, "pointerup", (event) => endPointer(event));
  listen(w, "pointercancel", (event) => endPointer(event, true));
  listen(stage, "lostpointercapture", (event) => endPointer(event, true));
  listen(stage, "pointerleave", () => {
    if (!pointer && usable()) resetViewPointer();
  });
  listen(
    stage,
    "wheel",
    (event) => {
      if (
        !usable() ||
        pointer ||
        touches.size ||
        event.defaultPrevented ||
        event.ctrlKey ||
        !Number.isFinite(event.deltaY) ||
        event.deltaY === 0 ||
        event.target?.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"]') ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      event.preventDefault();
      const continuingGesture = wheelTimer !== undefined;
      w.clearTimeout(wheelTimer);
      wheelTimer = w.setTimeout(() => {
        wheelTimer = undefined;
        scrolling = !reduced && Math.abs(progress - targetProgress) >= 0.0002;
        sync();
      }, 230);
      // One gesture owns one complete keyboard-style transition. Keep consuming
      // its inertia even after arrival; only a fresh gesture at rest can advance.
      if (continuingGesture || Math.abs(progress - targetProgress) >= 0.0002)
        return;
      const direction = Math.sign(event.deltaY);
      if (clamp(Math.round(targetProgress) + direction, 0, universeScenes.length - 1) !== targetProgress)
        changeChapter(direction);
    },
    { passive: false },
  );
  listen(w, "keydown", (event) => {
    if (
      event.key === "Escape" &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isControl(event.target) &&
      usable()
    ) {
      const previous = Math.max(progress, targetProgress);
      if (previous > 0.01) {
        event.preventDefault();
        changeChapter(-1);
      }
      return;
    }
    if (
      !usable() ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isControl(event.target)
    )
      return;
    if (
      [" ", "ArrowDown", "PageDown", "ArrowUp", "PageUp"].includes(event.key)
    ) {
      event.preventDefault();
      changeChapter(["ArrowUp", "PageUp"].includes(event.key) ? -1 : 1);
    } else if (
      openingInteractive() &&
      ["ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      readOrbit();
      orbitX += ((event.key === "ArrowLeft" ? -1 : 1) * Math.PI) / 8;
      renderer.setOrbit(orbitX, orbitY);
    }
  });
  if (preference)
    listen(preference, "change", () => {
      reduced = preference.matches;
      if (reduced) {
        finishReturn();
        finishChapter();
      }
      syncMotion();
      sync();
    });
  listen(doc, "visibilitychange", () => {
    if (doc.hidden) {
      finishReturn();
      finishChapter();
      clearPointer();
      touches.clear();
      multiTouch = false;
      resetViewPointer();
    }
    syncMotion();
    sync();
  });
  listen(w, "blur", () => {
    clearPointer();
    touches.clear();
    multiTouch = false;
    resetViewPointer();
  });
  listen(w, "resize", () => renderer?.resize());
  function cleanup() {
    if (disposed) return;
    disposed = true;
    doc.documentElement.classList.remove('is-site-preparing');
    doc.querySelectorAll('#site-header, #site-footer, .skip-link').forEach(element => { element.inert = false; });
    preparation?.abort();
    ++generation;
    clearPointer();
    touches.clear();
    [loadTimer, wheelTimer, returnSwapTimer, returnEndTimer].forEach((timer) =>
      w.clearTimeout(timer),
    );
    listeners.splice(0).forEach((remove) => remove());
    renderer?.dispose();
    renderer = null;
  }
  // A homepage link was followed: accelerate towards it (the page itself
  // opens over the scene from app.mjs). Returns false when not possible.
  cleanup.depart = (clientX, clientY) => {
    if (!usable() || reduced || !renderer?.depart) return false;
    const r = stage.getBoundingClientRect();
    renderer.depart(
      clamp(((clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1),
      clamp(1 - ((clientY - r.top) / Math.max(1, r.height)) * 2, -1, 1),
    );
    root.classList.add("is-departing");
    return true;
  };
  const endDeparture = () => {
    root.classList.remove("is-departing");
    renderer?.depart?.(null);
  };
  cleanup.setCovered = (value) => {
    if (disposed) return;
    covered = Boolean(value);
    if (!covered) endDeparture();
    if (!covered && !started) start();
    if (covered) {
      finishReturn();
      finishChapter();
    }
    clearPointer();
    touches.clear();
    multiTouch = false;
    if (covered) resetViewPointer();
    syncMotion();
    sync();
  };
  cleanup.setLanguage = (value) => {
    if (disposed) return;
    english = Boolean(value);
    sync();
  };
  // Live facts (counts, latest articles) arrived: redraw the current copy.
  cleanup.refreshDetails = () => {
    if (disposed) return;
    copyKey = "";
    sync();
  };
  cleanup.returnToOpening = () => {
    if (
      disposed ||
      returnState !== "idle" ||
      (!covered && targetProgress === 0 && progress < 0.0001)
    )
      return;
    w.clearTimeout(wheelTimer);
    wheelTimer = undefined;
    clearPointer();
    touches.clear();
    multiTouch = false;
    targetProgress = 0;
    jump = null;
    endDeparture();
    scrolling = false;
    resetViewPointer();
    // Hide the scene before changing only its chapter. Manual rotation, sky
    // direction and the running simulation survive this visual transition.
    returnState = "out";
    sync();
    if (reduced || !ready || doc.hidden) finishReturn();
    else if (covered) finishReturn(true);
    else returnSwapTimer = w.setTimeout(() => finishReturn(true), 220);
  };
  if (!covered) start();
  else sync();
  return cleanup;
}
