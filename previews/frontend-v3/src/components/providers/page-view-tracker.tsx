"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const SESSION_KEY = "tdx-visit";

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

/**
 * Reports one page view per route to `/api/track`. Skipped for visitors who send Do Not Track or
 * Global Privacy Control; nothing is stored in cookies or localStorage.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === pathname) return;
    const previous = last.current;
    last.current = pathname;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    const body = JSON.stringify({
      path: pathname,
      // Only the first view of a tab has an outside referrer; later ones are in-site navigations.
      referrer: previous === null ? document.referrer || undefined : undefined,
      session: sessionId(),
    });
    void fetch("/api/track", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  }, [pathname]);

  return null;
}
