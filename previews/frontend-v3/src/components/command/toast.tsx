"use client";

import { Check, CircleAlert, Download, Sparkles, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { usePageVisible } from "@/components/fx/hooks";
import styles from "./command.module.css";

const ICONS = { check: Check, alert: CircleAlert, download: Download, sparkles: Sparkles } satisfies Record<string, LucideIcon>;

export type ToastInput = {
  title: string;
  description?: string;
  icon?: keyof typeof ICONS;
  /** Milliseconds on screen (paused while hovered or while the tab is hidden). */
  duration?: number;
};

type ToastItem = ToastInput & { id: number };

const EMPTY: ToastItem[] = [];
const listeners = new Set<() => void>();
let toasts = EMPTY;
let lastId = 0;

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows a short status message; it is announced politely to screen readers. */
export function toast(input: ToastInput) {
  const id = ++lastId;
  toasts = [...toasts.slice(-2), { ...input, id }];
  emit();
  return id;
}

function dismissToast(id: number) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

/** Bottom-centre stack. The live region is always mounted so additions are announced. */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  return (
    <div
      data-command-keep=""
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[75] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** `ref` is forwarded because `popLayout` measures the exiting card. */
function ToastCard({ item, ref }: { item: ToastItem; ref?: Ref<HTMLDivElement> }) {
  const Icon = ICONS[item.icon ?? "check"];
  const duration = item.duration ?? 3400;
  const visible = usePageVisible();
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(duration);
  const paused = hovered || !visible;

  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => dismissToast(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= performance.now() - start;
    };
  }, [paused, item.id]);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.18, ease: [0.5, 0, 0.75, 0] } }}
      transition={{ type: "spring", stiffness: 460, damping: 32 }}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onClick={() => dismissToast(item.id)}
      className="pointer-events-auto relative flex w-max min-w-[15rem] max-w-full items-center gap-3 overflow-hidden rounded-2xl border border-line-strong bg-bg-elevated/90 py-2.5 pl-2.5 pr-5 shadow-soft backdrop-blur-xl sm:max-w-sm"
    >
      <span aria-hidden="true" className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <span className={styles.ping} />
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{item.title}</span>
        {item.description && (
          <span className="block truncate font-mono text-[11px] tracking-[0.02em] text-muted">{item.description}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={styles.timer}
        style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? "paused" : "running" }}
      />
    </motion.div>
  );
}
