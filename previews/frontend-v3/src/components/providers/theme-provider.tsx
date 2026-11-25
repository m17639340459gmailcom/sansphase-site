"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { MotionConfig } from "motion/react";
import { useEffect, useEffectEvent, type ReactNode } from "react";
import { beijingThemeBootstrap, beijingThemeOverrideKey, beijingThemeStorageKey, currentBeijingTheme } from "./beijing-theme";

function BeijingThemeClock() {
  const { resolvedTheme, setTheme } = useTheme();
  const apply = useEffectEvent((theme: "light" | "dark") => {
    if (resolvedTheme !== theme) setTheme(theme);
  });
  useEffect(() => {
    let timer: number;
    const sync = () => {
      window.clearTimeout(timer);
      const { theme, until } = currentBeijingTheme();
      apply(theme);
      // A one-minute ceiling also catches changes to the device clock.
      timer = window.setTimeout(sync, Math.max(1, Math.min(until - Date.now(), 60_000)));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === beijingThemeOverrideKey || event.key === null) sync();
    };
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  return null;
}

export function ThemeProvider({ children, followBeijingTime = false }: { children: ReactNode; followBeijingTime?: boolean }) {
  const server = typeof window === "undefined";
  const content = <MotionConfig reducedMotion="user">{children}</MotionConfig>;
  // When storage is blocked, hydrate from the class applied by the inline script.
  const initialTheme = followBeijingTime && !server && document.documentElement.classList.contains("dark") ? "dark" : "light";

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={followBeijingTime ? initialTheme : "system"}
      enableSystem={!followBeijingTime}
      storageKey={followBeijingTime ? beijingThemeStorageKey : undefined}
      disableTransitionOnChange
      scriptProps={{ type: server && !followBeijingTime ? "text/javascript" : "text/plain" }}
    >
      {followBeijingTime ? (
        <>
          <script
            id="sansphase-beijing-theme"
            type={server ? "text/javascript" : "text/plain"}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: beijingThemeBootstrap }}
          />
          <BeijingThemeClock />
          {content}
        </>
      ) : content}
    </NextThemesProvider>
  );
}
