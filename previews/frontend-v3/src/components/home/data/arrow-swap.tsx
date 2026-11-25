import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

const move = "absolute h-full w-full transition-[translate] duration-500 ease-(--fx-ease)";

/**
 * Diagonal arrow that leaves top-right while its twin slides in from bottom-left, on hover or
 * keyboard focus of the nearest `group` ancestor. Decorative; server-safe.
 */
export function ArrowSwap({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-grid h-4 w-4 shrink-0 overflow-hidden", className)}>
      <ArrowUpRight className={cn(move, "group-hover:translate-x-full group-hover:-translate-y-full group-focus-visible:translate-x-full group-focus-visible:-translate-y-full")} />
      <ArrowUpRight className={cn(move, "-translate-x-full translate-y-full group-hover:translate-0 group-focus-visible:translate-0")} />
    </span>
  );
}
