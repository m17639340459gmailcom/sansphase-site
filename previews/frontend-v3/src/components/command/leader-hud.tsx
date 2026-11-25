"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import styles from "./command.module.css";
import { Kbd } from "./kbd";
import { GO_KEY_OF } from "./keys";
import type { CommandData } from "./types";

export type LeaderState = { id: number; status: "waiting" | "hit" | "miss"; key?: string };

/**
 * Which-key hint for `g` sequences: lists every jump target with a draining timer, lights the
 * chosen key, shakes on a miss. Purely visual; the shortcut sheet documents the same keys.
 */
export function LeaderHud({ state, pages, timeout }: { state: LeaderState | null; pages: CommandData["pages"]; timeout: number }) {
  const t = useTranslations("FX.command.leader");
  return (
    <div
      aria-hidden="true"
      data-command-keep=""
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[76] flex justify-center px-4 sm:bottom-24"
    >
      <AnimatePresence>
        {state && (
          <motion.div
            key="leader"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.2, ease: [0.5, 0, 0.75, 0] } }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            className="relative max-w-[42rem] overflow-hidden rounded-2xl border border-line-strong bg-bg-elevated/90 p-2 shadow-2xl backdrop-blur-xl"
          >
            <div key={state.status === "miss" ? state.id : "steady"} className={cn(state.status === "miss" && styles.shake)}>
              <div className="flex items-center gap-2 px-1.5 pb-2 pt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                <Kbd accent>G</Kbd>
                <span className="text-accent">→</span>
                <span className="text-fg">{t("title")}</span>
                <span className="ml-auto hidden pl-6 sm:inline">{t("hint")}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pages.map((page) => {
                  const key = GO_KEY_OF[page.key];
                  const hit = state.status === "hit" && state.key === key;
                  return (
                    <span
                      key={page.key}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border py-1 pl-1 pr-2.5 text-xs transition-[background-color,border-color,color,opacity,scale] duration-300 ease-out",
                        hit ? "scale-105 border-accent bg-accent [color:var(--fx-on-accent)]" : "border-line bg-bg/60 text-fg",
                        state.status === "hit" && !hit && "opacity-35",
                      )}
                    >
                      <Kbd className={cn(hit && "border-transparent bg-transparent text-inherit shadow-none")}>{key}</Kbd>
                      {page.label}
                    </span>
                  );
                })}
              </div>
            </div>
            {state.status === "waiting" && (
              <span key={state.id} className={styles.timer} style={{ animationDuration: `${timeout}ms` }} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
