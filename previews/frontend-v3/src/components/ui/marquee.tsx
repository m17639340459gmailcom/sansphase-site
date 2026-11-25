import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Marquee({
  children,
  reverse = false,
  className,
  itemClassName,
}: {
  children: ReactNode[];
  reverse?: boolean;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div className={cn("mask-fade-x relative flex w-full overflow-hidden", className)}>
      <div
        className={cn(
          "flex w-max shrink-0 items-center hover:[animation-play-state:paused]",
          reverse ? "animate-marquee-reverse" : "animate-marquee",
        )}
      >
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
            {children.map((child, i) => (
              <div key={i} className={cn("flex items-center", itemClassName)}>
                {child}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
