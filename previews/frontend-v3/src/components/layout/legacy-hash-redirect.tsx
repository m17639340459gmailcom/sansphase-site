"use client";

import { useEffect } from "react";
import { legacyFrontendPath } from "@/lib/legacy-frontend-path";

export function LegacyHashRedirect({ english }: { english: boolean }) {
  useEffect(() => {
    function replaceOldAddress() {
      const target = legacyFrontendPath(window.location.hash, window.location.search, english);
      if (target) window.location.replace(target);
    }
    replaceOldAddress();
    window.addEventListener("hashchange", replaceOldAddress);
    return () => window.removeEventListener("hashchange", replaceOldAddress);
  }, [english]);

  return null;
}
