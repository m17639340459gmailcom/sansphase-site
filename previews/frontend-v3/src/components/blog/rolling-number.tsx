import { cn } from "@/lib/utils";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Live counter whose digits roll to each new value (CSS transitions, no JS per frame).
 * Decorative and aria-hidden: always pair it with the real value as text.
 */
export function RollingNumber({ value, pad = 1, className }: { value: number; pad?: number; className?: string }) {
  const digits = String(Math.max(0, Math.round(value))).padStart(pad, "0").split("");
  return (
    <span aria-hidden="true" className={cn("inline-flex whitespace-nowrap tabular-nums", className)}>
      {digits.map((digit, i) => (
        // Keyed by place value, so "9" -> "10" rolls the ones column instead of remounting it.
        <span key={digits.length - i} className="relative inline-block leading-[1.15em] [clip-path:inset(0_-0.1em)]">
          <span className="invisible">{digit}</span>
          <span
            className="absolute inset-x-0 top-0 flex flex-col items-center transition-[translate] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ translate: `0 calc(${digit} * -1.15em)` }}
          >
            {DIGITS.map((n) => (
              <span key={n} className="block h-[1.15em]">
                {n}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
