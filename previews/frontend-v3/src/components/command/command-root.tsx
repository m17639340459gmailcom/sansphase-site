"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { onCommandOpen, type CommandOpenDetail } from "@/components/fx/events";
import { getIntroDone } from "@/components/fx/intro-store";
import { useRouter } from "@/i18n/navigation";
import { GO_KEYS, isApplePlatform, isTyping, keyOf, modalOpen } from "./keys";
import { LeaderHud, type LeaderState } from "./leader-hud";
import type { CloseOptions, CommandData, CommandPageKey, Phase } from "./types";

const loadDialog = () => import("./command-dialog");
const CommandDialog = dynamic(() => loadDialog().then((mod) => mod.CommandDialog), { ssr: false });

const LEADER_MS = 1500;
/** Long enough for the chosen key to light up before the page wipe covers the hint. */
const LEADER_GO_MS = 140;
const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn", "OS"]);

/**
 * The site-wide command layer: ⌘K / Ctrl K, `/` and `?` open the (lazy) palette, `g` + key
 * jumps between pages with a which-key hint.
 */
export function CommandRoot({ data }: { data: CommandData }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("closed");
  const [seed, setSeed] = useState("");
  const [requested, setRequested] = useState(false);
  const [leader, setLeader] = useState<LeaderState | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);

  function open(query = "") {
    // Reopening mid-exit cancels whatever command was queued behind it.
    pending.current = null;
    if (phase === "closed") {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSeed(query);
    }
    setRequested(true);
    setPhase("open");
    setLeader(null);
  }

  const close = useCallback(({ instant = false, then }: CloseOptions = {}) => {
    pending.current = then ?? null;
    setPhase((current) => (current === "closed" ? current : instant ? "closed" : "closing"));
  }, []);

  const onExited = useCallback(() => setPhase((current) => (current === "closing" ? "closed" : current)), []);

  // The palette is gone and the page unlocked: hand focus back, then run the chosen command.
  const onClosed = useCallback(() => {
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    const key = keyOf(event);
    const apple = isApplePlatform();
    // Ctrl+K stays the emacs "kill line" in macOS text fields.
    const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

    if (mod && key === "k" && !event.altKey && !event.shiftKey) {
      if (phase === "open") {
        event.preventDefault();
        close();
      } else if (getIntroDone() && (phase === "closing" || !modalOpen())) {
        event.preventDefault();
        open();
      }
      return;
    }

    if (phase !== "closed") {
      if (key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        if (phase === "open") close();
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (event.defaultPrevented || isTyping(event.target)) return;

    if (leader?.status === "waiting") {
      if (MODIFIERS.has(event.key)) return;
      const page = (GO_KEYS as Record<string, CommandPageKey | undefined>)[key];
      const href = page && data.pages.find((item) => item.key === page)?.href;
      if (href) {
        event.preventDefault();
        setLeader({ ...leader, status: "hit", key });
        window.setTimeout(() => {
          if (href.startsWith("https://")) window.location.assign(href);
          else router.push(href);
        }, LEADER_GO_MS);
      } else {
        if (key === "Escape") event.preventDefault();
        setLeader(key === "Escape" ? null : { ...leader, status: "miss" });
      }
      return;
    }

    if (!getIntroDone() || modalOpen()) return;
    if (key === "/" || key === "?") {
      event.preventDefault();
      open(key === "?" ? "?" : "");
    } else if (key === "g" && !event.shiftKey) {
      setLeader({ id: event.timeStamp, status: "waiting" });
    }
  });

  const onOpenRequest = useEffectEvent((detail: CommandOpenDetail) => {
    if (phase === "open" || (phase === "closed" && modalOpen())) return;
    open(detail.query ?? "");
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", handler);
    const unsubscribe = onCommandOpen((detail) => onOpenRequest(detail));
    return () => {
      document.removeEventListener("keydown", handler);
      unsubscribe();
    };
  }, []);

  // The hint times out on its own; a hit or miss lingers just long enough to be seen.
  useEffect(() => {
    if (!leader) return;
    const timer = window.setTimeout(() => setLeader(null), leader.status === "waiting" ? LEADER_MS : 420);
    return () => window.clearTimeout(timer);
  }, [leader]);

  // Fetch the dialog chunk while idle, so the first ⌘K opens instantly.
  useEffect(() => {
    const warm = () => void loadDialog().catch(() => {});
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(warm, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      {requested && (
        <CommandDialog data={data} phase={phase} seed={seed} onClose={close} onExited={onExited} onClosed={onClosed} />
      )}
      <LeaderHud state={leader} pages={data.pages} timeout={LEADER_MS} />
    </>
  );
}
