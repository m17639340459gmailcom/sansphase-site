import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Keycap; `pressed` sinks it while the matching key is held. */
export function Kbd({
  children,
  pressed,
  accent,
  className,
}: {
  children: ReactNode;
  pressed?: boolean;
  accent?: boolean;
  className?: string;
}) {
  return (
    <kbd
      data-pressed={pressed || undefined}
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-line-strong bg-bg px-1 font-mono text-[10px] font-medium uppercase leading-none tracking-normal text-muted shadow-[0_1.5px_0_var(--line-strong)] transition-[translate,box-shadow,color,border-color] duration-150",
        "data-[pressed]:translate-y-[1.5px] data-[pressed]:border-accent data-[pressed]:text-accent data-[pressed]:shadow-none",
        accent && "border-accent/50 text-accent",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A key chord such as `G` then `P`; `then` labels the gap between sequential keys. */
export function KeyChord({ keys, then, className }: { keys: readonly string[]; then?: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center gap-1", className)}>
      {keys.map((key, i) => (
        <Fragment key={i}>
          {i > 0 && then && <span className="px-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">{then}</span>}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}
