"use client";

import { Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Magnetic } from "@/components/ui/magnetic";
import { cn } from "@/lib/utils";
import { burst } from "./burst";

/** Native share sheet when available, otherwise copies the URL; success morphs the icon and bursts. */
export function ShareButton({ label, copiedLabel, className, url }: { label: string; copiedLabel: string; className?: string; url?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const [done, setDone] = useState<"shared" | "copied" | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const succeed = (kind: "shared" | "copied") => {
    setDone(kind);
    burst(ref.current);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(null), 2000);
  };

  return (
    <Magnetic strength={0.2} inner={0.5}>
      <button
        ref={ref}
        type="button"
        data-done={done ? "" : undefined}
        onClick={async () => {
          try {
            const shareUrl = url ? new URL(url, window.location.origin).href : window.location.href;
            if (navigator.share) {
              await navigator.share({ url: shareUrl, title: document.title });
              succeed("shared");
              return;
            }
            await navigator.clipboard.writeText(shareUrl);
            succeed("copied");
          } catch {
            // user cancelled or clipboard blocked
          }
        }}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-muted transition-[color,border-color,background-color] duration-300 hover:border-accent hover:text-accent data-done:border-accent data-done:bg-accent-soft data-done:text-accent pointer-fine:h-9",
          className,
        )}
      >
        <span aria-hidden="true" className="pfx-morph-icon" data-magnetic-inner="">
          <Link2 />
          <svg viewBox="0 0 24 24">
            <path d="M4.5 12.8l4.6 4.4L19.5 6.8" pathLength={1} />
          </svg>
        </span>
        <span className="pfx-swap" data-magnetic-inner="">
          <span>{label}</span>
          <span aria-hidden="true">{done === "copied" ? copiedLabel : label}</span>
        </span>
      </button>
      <span role="status" className="sr-only">
        {done === "copied" ? copiedLabel : ""}
      </span>
    </Magnetic>
  );
}
