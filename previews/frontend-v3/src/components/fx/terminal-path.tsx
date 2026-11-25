"use client";

import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Decorative shell prompt showing the current route, e.g. `~/projects▌`. */
export function TerminalPath({ className, prompt = "~" }: { className?: string; prompt?: string }) {
  const pathname = usePathname();
  return (
    <span aria-hidden="true" className={cn("fx-terminal", className)}>
      <span className="text-accent">{prompt}</span>
      {pathname}
      <span className="fx-caret" />
    </span>
  );
}
