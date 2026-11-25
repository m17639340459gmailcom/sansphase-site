"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import type { ScenePalette } from "./palette";
import { createHeroCycle, createHeroEntrance, requestNext } from "./hero-cycle";
import { HeroEngine, type HeroFrame } from "./hero-engine";
import { createHeroTelemetry, scrollScatter, type HeroInteraction, type HeroTelemetry } from "./hero-interaction";
import { packShapeAtlasAsync, playbackShapeIds, type ShapeAtlas } from "./hero-shapes";
import { detectSimulationType, isSoftwareRenderer } from "./hero-simulation";

type SceneProps = {
  palette: ScenePalette;
  reduced: boolean;
  active: boolean;
  nextRequest: number;
  interaction: RefObject<HeroInteraction>;
  onInvalidateReady: (invalidate: (() => void) | null) => void;
  onPhaseChange: (phase: number) => void;
  onEntranceComplete: () => void;
  fallback: ReactNode;
  /** Keep particles as drifting dust until true is released (e.g. while a site intro plays). */
  holdEntrance?: boolean;
  /** Written every rendered frame for a HUD; never triggers React renders. */
  telemetry?: RefObject<HeroTelemetry | null>;
};

/** Particle grid sides: 256² = 65,536 on capable desktops, 120² = 14,400 on phones/weak devices. */
const HIGH_SIDE = 256;
const LOW_SIDE = 120;
const rendererOptions = { antialias: false, alpha: true, powerPreference: "low-power" } as const;

function requireWebGL(canvas: HTMLCanvasElement | null) {
  // Check the actual canvas before R3F's async initialization. Three reuses this context.
  if (canvas && !canvas.getContext("webgl2", rendererOptions)) {
    throw new Error("WebGL 2 is unavailable for the particle scene.");
  }
}

type Quality = { count: number; dpr: number };

function pickQuality(): Quality {
  const small = window.innerWidth < 768;
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const low = small || weak || coarse || (memory !== undefined && memory <= 4);
  const side = low ? LOW_SIDE : HIGH_SIDE;
  return {
    count: side * side,
    // Fixed for this mount; never resize the canvas for a mid-morph quality change.
    dpr: Math.min(window.devicePixelRatio || 1, 1.5),
  };
}

// Shape data is deterministic, so remounts (navigating back home) reuse it.
let atlasCache: { key: string; atlas: Promise<ShapeAtlas> } | null = null;
function loadAtlas(count: number) {
  const ids = playbackShapeIds();
  const key = `${count}:${ids.join(",")}`;
  if (atlasCache?.key !== key) atlasCache = { key, atlas: packShapeAtlasAsync(ids, count) };
  const pending = atlasCache.atlas;
  pending.catch(() => { if (atlasCache?.atlas === pending) atlasCache = null; });
  return pending;
}

function Field({
  palette, reduced, active, nextRequest, interaction, onInvalidateReady, onPhaseChange, onEntranceComplete, holdEntrance = false, telemetry: telemetryRef, quality,
}: Omit<SceneProps, "fallback"> & { quality: Quality }) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const cycle = useRef(createHeroCycle(reduced));
  const entrance = useRef(createHeroEntrance(reduced));
  const skipNextDelta = useRef(true);
  const scroll = useRef(0);
  const frame = useRef<HeroFrame | null>(null);
  const renderedEngine = useRef<HeroEngine | null>(null);
  const [engine, setEngine] = useState<HeroEngine | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  // Surfaces async setup errors to the wrapper so the scene can stay on its still image.
  if (failure) throw failure;

  const initialSetup = useEffectEvent(() => ({ palette, reduced }));
  useEffect(() => {
    let cancelled = false;
    let created: HeroEngine | null = null;
    const software = isSoftwareRenderer(gl);
    const count = software ? LOW_SIDE * LOW_SIDE : quality.count;
    const type = software ? null : detectSimulationType(gl);
    (async () => {
      const atlas = await loadAtlas(count);
      if (cancelled) return;
      const setup = initialSetup();
      const instance = new HeroEngine(atlas, cycle.current, entrance.current, type, setup.palette, setup.reduced);
      try {
        await instance.prepare(gl, camera);
      } catch (error) {
        instance.dispose();
        throw error;
      }
      if (cancelled) {
        instance.dispose();
        return;
      }
      created = instance;
      setEngine(instance);
    })().catch((error: unknown) => {
      if (!cancelled) setFailure(error instanceof Error ? error : new Error(String(error)));
    });
    return () => {
      cancelled = true;
      created?.dispose();
      setEngine(null);
    };
  }, [gl, camera, quality.count]);

  useEffect(() => {
    if (!engine) return;
    engine.setPalette(palette);
    invalidate();
  }, [engine, palette, invalidate]);

  useEffect(() => {
    if (!engine) return;
    const canvas = gl.domElement;
    const restored = () => {
      engine.restoreContext();
      invalidate();
    };
    canvas.addEventListener("webglcontextrestored", restored);
    return () => canvas.removeEventListener("webglcontextrestored", restored);
  }, [engine, gl, invalidate]);

  useEffect(() => {
    if (!engine) return;
    return () => {
      renderedEngine.current = null;
      onInvalidateReady(null);
    };
  }, [engine, onInvalidateReady]);

  const handleRequest = useEffectEvent(() => {
    requestNext(cycle.current);
    const input = interaction.current;
    // Keyboard requests carry the centre; clicks and taps carry the pointer.
    const x = input.clickX ?? (input.inside ? input.x : 0);
    const y = input.clickY ?? (input.inside ? input.y : 0);
    engine?.shock(x, y, camera, reduced);
    invalidate();
  });
  useEffect(() => {
    if (nextRequest === 0) return;
    handleRequest();
  }, [nextRequest]);

  // A paused HUD should show "stopped" rather than the last running frame.
  const pause = useEffectEvent(() => {
    const target = telemetryRef?.current;
    if (engine && target && !(active && !reduced)) engine.writeTelemetry(target, interaction.current, false, reduced);
  });
  // Returning onscreen must not count time spent hidden in the next frame.
  useEffect(() => {
    skipNextDelta.current = true;
    pause();
    invalidate();
  }, [active, reduced, invalidate]);

  // Scroll dispersal: one cheap rect read per scroll event, stored in a ref.
  useEffect(() => {
    const canvas = gl.domElement;
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      scroll.current = scrollScatter(rect.top, rect.height, window.innerHeight);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [gl]);

  useFrame((state, delta) => {
    if (!engine) return;
    const input = frame.current ?? (frame.current = {
      delta: 0, resume: true, active: false, reduced: false, holdEntrance: false, interaction: interaction.current,
      camera: state.camera, width: 1, height: 1, pixelRatio: 1, scroll: 0,
    });
    input.delta = delta;
    input.resume = skipNextDelta.current;
    input.active = active;
    input.reduced = reduced;
    input.holdEntrance = holdEntrance;
    input.interaction = interaction.current;
    input.camera = state.camera;
    input.width = state.size.width;
    input.height = state.size.height;
    input.pixelRatio = state.viewport.dpr;
    input.scroll = scroll.current;
    skipNextDelta.current = false;
    const entranceWasDone = engine.entrance.done;
    const changed = engine.frame(state.gl, input);
    if (changed !== null) onPhaseChange(changed);
    if (!entranceWasDone && engine.entrance.done) onEntranceComplete();
    if (renderedEngine.current !== engine) {
      renderedEngine.current = engine;
      onInvalidateReady(invalidate);
      onPhaseChange(cycle.current.to);
    }
    if (telemetryRef) {
      if (!telemetryRef.current) telemetryRef.current = createHeroTelemetry();
      engine.writeTelemetry(telemetryRef.current, interaction.current, active && !reduced, reduced);
    }
  });

  return engine ? <primitive object={engine.object} /> : null;
}

export default function HeroScene({ fallback, ...props }: SceneProps) {
  const [quality] = useState(pickQuality);
  return (
    <Canvas
      ref={requireWebGL}
      dpr={quality.dpr}
      frameloop={props.active && !props.reduced ? "always" : "demand"}
      camera={{ position: [0, 0, 7], fov: 38 }}
      gl={rendererOptions}
      style={{ background: "transparent" }}
      fallback={fallback}
      onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; }}
    >
      <Field {...props} quality={quality} />
    </Canvas>
  );
}
