"use client";

import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent } from "react";
import { CELEBRATE_EVENT, KONAMI, isTyping, keyOf } from "@/components/command/keys";
import { toast } from "@/components/command/toast";
import { site } from "@/data/site";
import { REDUCED_MOTION_QUERY } from "./hooks";

const SIGNED_KEY = "tdx-console-signed";
const SIGNATURE = [
  "████████╗██████╗ ██╗  ██╗",
  "╚══██╔══╝██╔══██╗╚██╗██╔╝",
  "   ██║   ██║  ██║ ╚███╔╝ ",
  "   ██║   ██║  ██║ ██╔██╗ ",
  "   ██║   ██████╔╝██╔╝ ██╗",
  "   ╚═╝   ╚═════╝ ╚═╝  ╚═╝",
].join("\n");

let signed = false;

/**
 * The Konami code (or the palette's hidden command) launches the TDX fireworks with a toast;
 * reduced motion keeps the toast only. DevTools get a signature once per session.
 */
export function EasterEggs() {
  const t = useTranslations("FX.command");

  const celebrate = useEffectEvent(() => {
    toast({ title: t("toast.konami"), description: t("toast.konamiBody"), icon: "sparkles", duration: 4200 });
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) return;
    import("@/components/command/fireworks").then(
      ({ launchFireworks }) => launchFireworks(),
      () => {},
    );
  });

  useEffect(() => {
    const recent: string[] = [];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      recent.push(keyOf(event));
      if (recent.length > KONAMI.length) recent.shift();
      if (recent.length === KONAMI.length && recent.every((key, i) => key === KONAMI[i])) {
        recent.length = 0;
        celebrate();
      }
    };
    const onCelebrate = () => celebrate();
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener(CELEBRATE_EVENT, onCelebrate);
    };
  }, []);

  useEffect(() => {
    if (signed) return;
    signed = true;
    try {
      if (sessionStorage.getItem(SIGNED_KEY)) return;
      sessionStorage.setItem(SIGNED_KEY, "1");
    } catch {}
    const root = getComputedStyle(document.documentElement);
    const accent = root.getPropertyValue("--accent").trim();
    const muted = root.getPropertyValue("--muted").trim();
    const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
    console.log(`%c${SIGNATURE}`, `color:${accent};font:600 12px/1.15 ${mono}`);
    console.log(`%c${t("console.source", { url: site.repo })}`, `color:${accent};font:12px/1.6 ${mono}`);
    console.log(`%c${t("console.hint")}`, `color:${muted};font:11px/1.6 ${mono}`);
  }, [t]);

  return null;
}
