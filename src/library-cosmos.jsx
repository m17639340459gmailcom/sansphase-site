import React, { Component } from "react";
import {
  createRoot as createFiberRoot,
  extend,
  events,
} from "@react-three/fiber";
import { animate, motionValue } from "motion";
import * as THREE from "three";
import { LibraryCosmosScene } from "./library-cosmos-scene.jsx";
import "./library-cosmos.css";
import { createTurnInput, resetTurnInput } from "./reference-rotation.mjs";

extend(THREE);
const finite = (v) => (Number.isFinite(v) ? v : 0);
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
    gaze: { x: 0, y: 0 },
    time: 0,
    paused: false,
    interactionEpoch: 0,
    reduced,
  };
}
class VisualBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Preserve the existing page controller contract. Libraries own graphics and
// easing; this adapter owns only site navigation, pause, sizing and cleanup.
export function mountCosmos(
  canvas,
  {
    onReady = () => {},
    onError = () => {},
    onProgress = () => {},
    reducedMotion = false,
  } = {},
) {
  const model = createLibraryModel(reducedMotion),
    doc = canvas.ownerDocument,
    stage = canvas.parentElement;
  let disposed = false,
    failed = false,
    announced = false,
    store,
    frameRoot,
    observer;
  let target = 0,
    orbit = { x: 0, y: 0 },
    paused = false;
  const tweens = new Map();
  // R3F releases its context asynchronously. Each mount owns a draw canvas so
  // an old release cannot destroy a newly retried renderer on the same element.
  const drawCanvas = doc.createElement("canvas");
  drawCanvas.className = "universe-gl-canvas";
  drawCanvas.setAttribute("aria-hidden", "true");
  stage.insertBefore(drawCanvas, canvas);
  function fail(error) {
    if (disposed || failed) return;
    failed = true;
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
  function tween(key, value, continuous = false) {
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
  const lost = (e) => {
    e.preventDefault();
    fail(new Error("WebGL context lost"));
  };
  const visibility = () => sync();
  const renderError = (event) => {
    if (/cosmos\.bundle\.mjs/.test(event.filename || ""))
      fail(event.error || new Error(event.message));
  };
  const sceneContent = () => (
    <VisualBoundary onError={fail}>
      <LibraryCosmosScene
        model={model}
        onFrame={(p) => {
          stage.dataset.entrance = model.entrance.get().toFixed(3);
          onProgress(p);
          if (!announced) {
            announced = true;
            queueMicrotask(() => {
              if (!disposed && !failed) onReady();
            });
          }
        }}
      />
    </VisualBoundary>
  );
  const api = {
    setPointer(x, y, { reset = false } = {}) {
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
    setOrbit(x, y = 0, { dragging = false } = {}) {
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
    pulse(x, y) {
      api.setPointer(x, y);
    },
    setChapter(value, { continuous = false, immediate = false } = {}) {
      target = THREE.MathUtils.clamp(finite(value), 0, 3);
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
    setPaused(value) {
      if (
        paused === !!value &&
        model.paused === (paused || doc.hidden || failed)
      )
        return;
      paused = !!value;
      sync();
    },
    setReducedMotion(value) {
      if (model.reduced === !!value) return;
      model.reduced = !!value;
      if (model.reduced) {
        stop();
        model.progress.set(target);
        onProgress(target);
      }
      if (store) frameRoot.render(sceneContent());
      sync();
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      observer?.disconnect();
      doc.removeEventListener("visibilitychange", visibility);
      doc.defaultView.removeEventListener("error", renderError);
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
  doc.defaultView.addEventListener("error", renderError);
  frameRoot = createFiberRoot(drawCanvas);
  frameRoot
    .configure({
      events,
      gl: { alpha: true, antialias: true, powerPreference: "high-performance" },
      dpr: [1, 2],
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
