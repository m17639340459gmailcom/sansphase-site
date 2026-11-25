import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tag({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em]",
        tone === "accent"
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-line text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
