import React, { Component } from "react";
import type { ReactNode } from 'react';
import {
  createRoot as createFiberRoot,
  extend,
  events,
} from "@react-three/fiber";
import type { RootState, RootStore } from '@react-three/fiber';
import { animate, motionValue } from "motion";
import * as THREE from "three";
import { LibraryCosmosScene } from "./library-cosmos-scene.jsx";
import "./library-cosmos.css";
import { createTurnInput, resetTurnInput } from "./reference-rotation.mjs";
import { prepareScene } from "./scene-preparation.mjs";

extend(THREE as unknown as Parameters<typeof extend>[0]);
const finite = (v: number) => (Number.isFinite(v) ? v : 0);
export function createLibraryModel(reduced = false) {
  return {
    progress: motionValue(0),
    yaw: motionValue(0),
    turnInput: createTurnInput(),
    pitch: motionValue(0),
    entrance: motionValue(reduced ? 1 : 0),
    pointerEnabled: true,
    pointer: { x: 0, y: 0 },
    pointerActive: false,
    pointerAt: -10,
    pulse: null as { x: number; y: number; at: number } | null,
    // 1 = full black-hole detail; the frame-rate guard may lower it.
    quality: 1,
    // Set while a rail jump across several chapters is under way.
    jump: null as { from: number; to: number } | null,
    // Set when a link on the homepage is followed: the scene accelerates
    // towards that point until the next page opens over it.
    depart: null as { x: number; y: number; at: number } | null,
    gaze: { x: 0, y: 0 },
    time: 0,
    paused: false,
    interactionEpoch: 0,
    reduced,
  };
}
type LibraryModel = ReturnType<typeof createLibraryModel> & {
  preparing?: boolean;
  openingReady?: boolean;
  skiesReady?: boolean;
};
type MountOptions = {
  onReady?: () => void;
  onError?: (error: unknown) => void;
  onProgress?: (progress: number) => void;
  onLoadProgress?: (progress: number) => void;
  reducedMotion?: boolean;
};
type TweenKey = 'progress' | 'yaw' | 'pitch';
const Scene = LibraryCosmosScene as React.ComponentType<{
  model: LibraryModel;
  onFrame: (progress: number, state: RootState) => void;
}>;
// Legacy JS preparation accepts progress values even though its inferred default callback is zero-arg.
const runPreparation = prepareScene as unknown as (options: RootState & {
  signal: AbortSignal;
  nextFrame: () => Promise<void>;
  onProgress: (progress: number) => void;
}) => Promise<void>;

class VisualBoundary extends Component<{ onError: (error: unknown) => void; children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Preserve the existing page controller contract. Libraries own graphics and
// easing; this adapter owns only site navigation, pause, sizing and cleanup.
export function mountCosmos(
  canvas: HTMLElement,
  {
    onReady = () => {},
    onError = () => {},
    onProgress = () => {},
    onLoadProgress = () => {},
    reducedMotion = false,
  }: MountOptions = {},
) {
  const model: LibraryModel = createLibraryModel(reducedMotion),
    doc = canvas.ownerDocument,
    stage = canvas.parentElement!;
  model.preparing = true;
  const preparation = new AbortController();
  let disposed = false,
    failed = false,
    announced = false;
  let store: RootStore | undefined;
  let frameRoot: ReturnType<typeof createFiberRoot> | undefined;
  let observer: ResizeObserver | undefined;
  let target = 0,
    orbit = { x: 0, y: 0 },
    paused = false;
  const tweens = new Map<TweenKey, ReturnType<typeof animate>>();
  // R3F releases its context asynchronously. Each mount owns a draw canvas so
  // an old release cannot destroy a newly retried renderer on the same element.
  const drawCanvas = doc.createElement("canvas");
  drawCanvas.className = "universe-gl-canvas";
  drawCanvas.setAttribute("aria-hidden", "true");
  stage.insertBefore(drawCanvas, canvas);
  function fail(error: unknown) {
    if (disposed || failed) return;
    failed = true;
    preparation.abort();
    console.error("Universe renderer failed:", error);
    sync();
    onError(error);
  }
  function stop() {
    tweens.forEach((t) => t.stop());
    tweens.clear();
  }
  function sync() {
    model.paused = paused || doc.hidden || failed;
    const state = store?.getState(),
      loop = model.paused ? "never" : model.reduced ? "demand" : "always";
    if (state && state.frameloop !== loop) {
      const elapsed = state.clock.elapsedTime;
      state.setFrameloop(loop);
      state.clock.elapsedTime = elapsed;
    }
    if (model.paused) {
      stop();
      resetTurnInput(model.turnInput);
      model.pointer.x = model.pointer.y = 0;
      model.pointerActive = false;
      model.interactionEpoch++;
    } else if (Math.abs(target - model.progress.get()) > 0.0001)
      tween("progress", target, true);
    if (!model.paused) store?.getState().invalidate();
  }
  function tween(key: TweenKey, value: number, continuous = false) {
    tweens.get(key)?.stop();
    if (model.reduced || model.paused) model[key].set(value);
    else
      tweens.set(
        key,
        animate(
          model[key],
          value,
          key === "progress" && continuous
            ? {
                type: "spring",
                stiffness: 170,
                damping: 26,
                mass: 0.9,
                restDelta: 0.0001,
              }
            : key === "progress"
              ? { duration: 3, ease: [0.4, 0, 0.3, 1] }
              : continuous
                ? {
                    type: "spring",
                    stiffness: 240,
                    damping: 32,
                    mass: 1,
                    restDelta: 0.0001,
                  }
                : { duration: 1.2, ease: [0.22, 0.8, 0.22, 1] },
        ),
      );
    store?.getState().invalidate();
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || 1280),
      height = Math.max(1, bounds.height || 720);
    store?.getState().setSize(width, height, bounds.top || 0, bounds.left || 0);
  }
  const lost = (e: Event) => {
    e.preventDefault();
    fail(new Error("WebGL context lost"));
  };
  const visibility = () => sync();
  const renderError = (event: ErrorEvent) => {
    if (/cosmos\.bundle\.mjs/.test(event.filename || ""))
      fail(event.error || new Error(event.message));
  };
  // Smoothness first: after a sustained stretch below 50 fps, give up detail
  // one step at a time (ray-march budget, then canvas pixel ratio). It never
  // raises quality again, so the scene cannot oscillate between settings.
  const guard = { last: 0, frames: 0, time: 0, steps: 0 };
  function watchFrameRate(state: RootState) {
    if (model.preparing || model.paused || model.reduced || guard.steps >= 3) {
      guard.last = 0;
      return;
    }
    const now = performance.now();
    if (guard.last && now - guard.last < 250) {
      guard.time += now - guard.last;
      guard.frames++;
    }
    guard.last = now;
    if (guard.time < 2000) return;
    const fps = (guard.frames * 1000) / guard.time;
    guard.time = guard.frames = 0;
    if (fps >= 50) return;
    guard.steps++;
    if (model.quality > 0.5) model.quality = 0.5;
    else if (state.viewport.dpr > 1)
      state.setDpr(Math.max(1, state.viewport.dpr - 0.25));
    else guard.steps = 3;
  }
  const sceneContent = () => (
    <VisualBoundary onError={fail}>
      <Scene
        model={model}
        onFrame={(p, state) => {
          const entrance = model.entrance.get().toFixed(3);
          if (stage.dataset.entrance !== entrance)
            stage.dataset.entrance = entrance;
          watchFrameRate(state);
          onProgress(p);
          if (!announced) onLoadProgress(model.openingReady ? 0.35 : 0.1);
          // The black hole's sky and all three chapter photographs are loaded.
          if (
            !announced &&
            model.openingReady === true &&
            model.skiesReady === true
          ) {
            announced = true;
            runPreparation({
              ...state,
              signal: preparation.signal,
              nextFrame: () =>
                new Promise<void>((resolve, reject) => {
                  if (preparation.signal.aborted) {
                    reject(preparation.signal.reason);
                    return;
                  }
                  const abort = () => {
                    doc.defaultView!.cancelAnimationFrame(id);
                    reject(preparation.signal.reason);
                  };
                  const id = doc.defaultView!.requestAnimationFrame(() => {
                    preparation.signal.removeEventListener("abort", abort);
                    resolve();
                  });
                  preparation.signal.addEventListener("abort", abort, {
                    once: true,
                  });
                  state.invalidate();
                }),
              onProgress: (value) => onLoadProgress(0.35 + 0.65 * value),
            })
              .then(() => {
                if (!disposed && !failed) onReady();
              })
              .catch((error) => {
                if (!disposed && !failed) fail(error);
              });
          }
        }}
      />
    </VisualBoundary>
  );
  const api = {
    startPresentation() {
      if (disposed || failed) return;
      model.preparing = false;
      store?.getState().invalidate();
    },
    setPointer(x: number, y: number, { reset = false } = {}) {
      if (
        disposed ||
        model.paused ||
        (!reset && (!model.pointerEnabled || model.progress.get() >= 0.01))
      )
        return;
      model.pointer = {
        x: reset ? 0 : THREE.MathUtils.clamp(finite(x), -1, 1),
        y: reset ? 0 : THREE.MathUtils.clamp(finite(y), -1, 1),
      };
      model.pointerActive = !reset;
      model.pointerAt = model.time;
      store?.getState().invalidate();
    },
    setOrbit(x: number, y = 0, { dragging = false } = {}) {
      if (dragging && !model.reduced && !model.paused) {
        model.turnInput.pending += finite(x) - orbit.x;
        orbit.x = finite(x);
        return;
      }
      resetTurnInput(model.turnInput);
      orbit = { x: finite(x), y: 0 };
      tween("yaw", orbit.x, true);
      model.pitch.set(0);
    },
    getOrbit() {
      return { x: model.yaw.get(), y: model.pitch.get() };
    },
    beginOrbit() {
      tweens.get("yaw")?.stop();
      tweens.get("pitch")?.stop();
      orbit.x = model.yaw.get();
      model.turnInput.pending = 0;
    },
    endOrbit({ cancel = false } = {}) {
      if (cancel) resetTurnInput(model.turnInput);
    },
    pulse(x: number, y: number) {
      api.setPointer(x, y);
      if (disposed || model.paused || model.progress.get() >= 0.01) return;
      // A click on the opening sends one ripple through the lensed sky.
      model.pulse = {
        x: THREE.MathUtils.clamp(finite(x), -1, 1),
        y: THREE.MathUtils.clamp(finite(y), -1, 1),
        at: model.time,
      };
      store?.getState().invalidate();
    },
    depart(x: number | null, y = 0) {
      model.depart =
        x === null || disposed
          ? null
          : {
              x: THREE.MathUtils.clamp(finite(x), -1, 1),
              y: THREE.MathUtils.clamp(finite(y), -1, 1),
              at: performance.now(),
            };
      store?.getState().invalidate();
    },
    setChapter(value: number, { continuous = false, immediate = false, jump = null }: { continuous?: boolean; immediate?: boolean; jump?: { from: number; to: number } | null } = {}) {
      target = THREE.MathUtils.clamp(finite(value), 0, 3);
      model.jump = jump;
      const pointerEnabled = target === 0;
      if (model.pointerEnabled !== pointerEnabled) {
        model.pointerEnabled = pointerEnabled;
        model.pointer.x = model.pointer.y = 0;
        model.pointerActive = false;
        model.interactionEpoch++;
      }
      if (immediate) {
        tweens.get("progress")?.stop();
        tweens.delete("progress");
        model.progress.set(target);
        store?.getState().invalidate();
      } else tween("progress", target, continuous);
      if (immediate || model.reduced || model.paused) onProgress(target);
    },
    setPaused(value: boolean) {
      if (
        paused === !!value &&
        model.paused === (paused || doc.hidden || failed)
      )
        return;
      paused = !!value;
      sync();
    },
    setReducedMotion(value: boolean) {
      if (model.reduced === !!value) return;
      model.reduced = !!value;
      if (model.reduced) {
        stop();
        model.progress.set(target);
        onProgress(target);
      }
      if (store) frameRoot!.render(sceneContent());
      sync();
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      preparation.abort();
      stop();
      observer?.disconnect();
      doc.removeEventListener("visibilitychange", visibility);
      doc.defaultView!.removeEventListener("error", renderError);
      drawCanvas.removeEventListener("webglcontextlost", lost);
      frameRoot?.unmount();
      drawCanvas.remove();
      model.progress.destroy();
      model.yaw.destroy();
      model.pitch.destroy();
      model.entrance.destroy();
    },
  };
  drawCanvas.addEventListener("webglcontextlost", lost);
  doc.addEventListener("visibilitychange", visibility);
  doc.defaultView!.addEventListener("error", renderError);
  frameRoot = createFiberRoot(drawCanvas);
  frameRoot
    .configure({
      events,
      gl: { alpha: true, antialias: true, powerPreference: "high-performance" },
      dpr: [1, 1.5],
      camera: { fov: 42, near: 0.1, far: 180, position: [0, 0.15, 8.8] },
      frameloop: "never",
      onCreated(state) {
        state.gl.setClearColor("#02050c", 0);
        state.gl.toneMappingExposure = 1.2;
        state.gl.debug.onShaderError = (context, program, vertex, fragment) => {
          const details = [
            context.getProgramInfoLog(program),
            context.getShaderInfoLog(vertex),
            context.getShaderInfoLog(fragment),
          ]
            .filter(Boolean)
            .join("\n");
          fail(
            new Error(
              `A third-party scene shader failed to compile: ${details}`,
            ),
          );
        };
      },
    })
    .then(() => {
      if (disposed) {
        frameRoot.unmount();
        return;
      }
      store = frameRoot.render(sceneContent());
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();
      sync();
    })
    .catch(fail);
  return api;
}
