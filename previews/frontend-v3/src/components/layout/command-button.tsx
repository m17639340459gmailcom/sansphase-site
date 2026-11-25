"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore, type CSSProperties } from "react";
import { openCommandPalette } from "@/components/fx/events";
import { cn } from "@/lib/utils";
import styles from "./navbar.module.css";

const noopSubscribe = () => () => {};

function isApple() {
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(agent.userAgentData?.platform || navigator.platform || navigator.userAgent);
}

/**
 * Opens the command palette. `bar` is a search capsule with the platform shortcut (⌘K / Ctrl K),
 * labelled from xl; `icon` is a round button for small screens. The shortcut is only known after
 * hydration.
 */
export function CommandButton({
  variant,
  onOpen,
  className,
}: {
  variant: "bar" | "icon";
  onOpen?: () => void;
  className?: string;
}) {
  const t = useTranslations("FX.nav");
  const apple = useSyncExternalStore(noopSubscribe, isApple, () => null);
  const keys = apple === null ? ["", "K"] : [apple ? "⌘" : "Ctrl", "K"];

  return (
    <button
      type="button"
      aria-label={t("command")}
      aria-haspopup="dialog"
      aria-keyshortcuts={apple === null ? undefined : apple ? "Meta+K" : "Control+K"}
      data-cursor="snap"
      onClick={() => {
        onOpen?.();
        openCommandPalette();
      }}
      className={cn(
        styles.search,
        "group/search inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted transition-[color,border-color,background-color] duration-300 hover:border-accent hover:text-fg active:scale-95",
        variant === "bar" ? "h-10 gap-2 pl-3 pr-2" : "h-11 w-11",
        className,
      )}
    >
      <Search
        aria-hidden="true"
        className="h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/search:-rotate-12 group-hover/search:scale-110"
      />
      {variant === "bar" && (
        <>
          <span className={cn(styles.searchLabel, "text-[13px] font-medium")}>
            <span>{t("search")}</span>
          </span>
          <span aria-hidden="true" className={cn(styles.kbd, "font-mono")}>
            {keys.map((key, i) => (
              <kbd key={i} style={{ "--k": i } as CSSProperties}>
                {key}
              </kbd>
            ))}
          </span>
        </>
      )}
    </button>
  );
}
