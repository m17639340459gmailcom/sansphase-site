"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

// First two segments: /projects -> /projects/x animates, lessons inside /learn/fde keep their shell.
function routeKey(pathname: string) {
  return pathname.split("/").slice(0, 3).join("/") || "/";
}

/**
 * Route transitions via React's <ViewTransition> (see the `page-enter`/`page-exit` CSS in
 * globals.css): the old page lifts away, the new one is wiped in from the bottom.
 * Mounted from `template.tsx`; browsers without the API just swap pages.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={routeKey(pathname)} enter="page-enter" exit="page-exit" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
