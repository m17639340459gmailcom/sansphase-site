"use client";

import { useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref, type RefObject } from "react";
import { rafThrottle } from "@/components/fx/hooks";
import { ScrambleText } from "@/components/fx/scramble-text";
import { FxTrigger } from "@/components/fx/trigger";
import type { HeroInteraction, HeroTelemetry } from "@/components/three/hero-interaction";
import { cn } from "@/lib/utils";
import styles from "./hud.module.css";

/** Class for the element that hosts the HUD (the particle `<figure>`): hover lock-on and pausing key off it. */
export const heroHudHost = styles.host;

export type HeroHudHandle = {
  /** Pointer over the particle surface in client px, or null once it leaves. */
  track: (point: { x: number; y: number } | null) => void;
};

export type HeroHudLabels = {
  shape: string;
  engine: string;
  morphing: string;
  stable: string;
  hint: string;
  hintTouch: string;
};

type HeroHudProps = {
  ref?: Ref<HeroHudHandle>;
  interaction: RefObject<HeroInteraction>;
  /** Written by the particle scene every frame; drives the live count / fps readout. */
  telemetry?: RefObject<HeroTelemetry>;
  /** e.g. "01/03". */
  index: string;
  name: string;
  /** Changes with every new shape; restarts the cycle meter. */
  cycleKey: number;
  /** Seconds of morphing at the start of this cycle, and of the whole cycle. */
  morph: number;
  duration: number;
  statusLabel?: string;
  labels: HeroHudLabels;
};

const CORNERS = ["tl", "tr", "bl", "br"] as const;

const count = new Intl.NumberFormat("en-US");
const MODES = { gpgpu: "GPGPU", shader: "SHADER", static: "STATIC" } as const;

const signed = (value: number) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}`;

/**
 * Instrument frame around the particle stage: corner brackets that lock on while the surface is
 * hovered, rulers whose markers follow the pointer, the live shape with its morph/hold meter, and
 * the pointer coordinates read from the scene's interaction ref. Decorative and pointer-transparent.
 */
export function HeroHud({ ref, interaction, telemetry, index, name, cycleKey, morph, duration, statusLabel, labels }: HeroHudProps) {
  const root = useRef<HTMLDivElement>(null);
  const xText = useRef<HTMLSpanElement>(null);
  const yText = useRef<HTMLSpanElement>(null);
  const statsText = useRef<HTMLSpanElement>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const paint = useRef<(() => void) | null>(null);
  // The first decode waits for the scan line to uncover the top edge; later shapes decode at once.
  const lead = cycleKey > 1 ? 0 : 0.45;

  useEffect(() => {
    const run = rafThrottle(() => {
      const element = root.current;
      const input = interaction.current;
      if (!element) return;
      if (!point.current || !input.inside) {
        delete element.dataset.tracking;
        return;
      }
      const rect = element.getBoundingClientRect();
      const x = (point.current.x - rect.left) / rect.width;
      const y = (point.current.y - rect.top) / rect.height;
      element.dataset.tracking = "";
      element.toggleAttribute("data-outside", x < 0 || x > 1 || y < 0 || y > 1);
      element.style.setProperty("--hud-x", x.toFixed(4));
      element.style.setProperty("--hud-y", y.toFixed(4));
      // Rewrite React's own text nodes instead of replacing them.
      if (xText.current?.firstChild) xText.current.firstChild.nodeValue = signed(input.x);
      if (yText.current?.firstChild) yText.current.firstChild.nodeValue = signed(input.y);
    });
    paint.current = run;
    return () => {
      run.cancel();
      paint.current = null;
    };
  }, [interaction]);

  // Live engine readout, polled at ~4Hz only while the HUD is on screen and the tab is visible.
  useEffect(() => {
    const element = root.current;
    const node = statsText.current?.firstChild;
    if (!element || !node || !telemetry) return;
    let timer = 0;
    let onScreen = false;
    const tick = () => {
      const data = telemetry.current;
      if (data.particleCount > 0) {
        const fps = data.running && data.fps > 0 ? ` · ${Math.round(data.fps)} FPS` : "";
        node.nodeValue = `${count.format(data.particleCount)} PTS${fps} · ${MODES[data.mode]}`;
      }
    };
    const sync = () => {
      window.clearInterval(timer);
      timer = onScreen && !document.hidden ? window.setInterval(tick, 250) : 0;
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [telemetry]);

  useImperativeHandle(ref, () => ({
    track(next) {
      point.current = next;
      paint.current?.();
    },
  }), []);

  return (
    <FxTrigger trigger="mount" aria-hidden="true" className={styles.hud}>
      <div ref={root} className={styles.inner}>
        {CORNERS.map((corner, n) => (
          <span key={corner} data-corner={corner} data-reveal="" className={styles.corner} style={{ "--n": n } as CSSProperties} />
        ))}
        <span data-reveal="" className={styles.rulerX} />
        <span data-reveal="" className={styles.rulerY} />
        <span className={styles.markerX} />
        <span className={styles.markerY} />

        <div className={styles.top}>
          <div>
            <p className={styles.row}>
              <ScrambleText text={index} className="text-accent" delay={lead} duration={0.6} />
              <span className={styles.dash} />
              <ScrambleText text={labels.shape} delay={0.6} />
            </p>
            <p className={cn(styles.row, styles.name)}>
              <ScrambleText text={name} delay={lead} duration={0.8} />
            </p>
            <div data-reveal="" className={cn(styles.meter, styles.fade)} style={{ "--fade": "1.1s" } as CSSProperties}>
              {statusLabel ? (
                <span>{statusLabel}</span>
              ) : (
                <span
                  key={cycleKey}
                  className={styles.cycle}
                  style={{ "--cycle": `${duration}s`, "--morph": `${morph}s` } as CSSProperties}
                >
                  <span className={styles.track}>
                    <span className={styles.fill} />
                  </span>
                  <span className={styles.status}>
                    {morph > 0 && <span className={styles.morphing}>{labels.morphing}</span>}
                    <span className={styles.stable}>{labels.stable}</span>
                  </span>
                </span>
              )}
            </div>
          </div>
          {labels.engine && (
            <div className={styles.engine}>
              <p className={styles.row}>
                <span className={styles.pulse} />
                <ScrambleText text={labels.engine} delay={0.75} />
              </p>
              <p data-reveal="" className={cn(styles.stats, styles.fade)} style={{ "--fade": "1.15s" } as CSSProperties}>
                <span ref={statsText}>{" "}</span>
              </p>
            </div>
          )}
        </div>

        <div className={styles.bottom}>
          <p data-reveal="" className={cn(styles.coords, styles.fade)} style={{ "--fade": "1.2s" } as CSSProperties}>
            X <span ref={xText} className={styles.value}>{signed(0)}</span>
            <span className="ml-2">Y</span> <span ref={yText} className={styles.value}>{signed(0)}</span>
          </p>
          <span data-reveal="" className={cn(styles.rule, styles.fade)} style={{ "--fade": "1.25s" } as CSSProperties} />
          <p data-reveal="" className={cn(styles.hint, styles.fade)} style={{ "--fade": "1.3s" } as CSSProperties}>
            <span className={styles.hintDot} />
            <span className={styles.hintPointer}>{labels.hint}</span>
            <span className={styles.hintTouch}>{labels.hintTouch}</span>
          </p>
        </div>
      </div>
    </FxTrigger>
  );
}
