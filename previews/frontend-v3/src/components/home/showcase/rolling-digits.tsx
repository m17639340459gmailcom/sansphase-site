import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import styles from "./rolling-digits.module.css";

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);

/**
 * Digit wheels that roll to each new value (a CSS transition on the wheel offset), unlike the
 * one-shot Odometer. Decorative: callers supply accessible text. Server-safe.
 */
export function RollingDigits({ value, className }: { value: string; className?: string }) {
  const chars: { char: string; column?: number }[] = [];
  let column = 0;
  for (const char of value) chars.push(/\d/.test(char) ? { char, column: column++ } : { char });

  return (
    <span aria-hidden="true" className={cn(styles.roll, className)}>
      {chars.map(({ char, column }, i) =>
        column === undefined ? (
          <span key={i}>{char}</span>
        ) : (
          <span key={i} className={styles.cell} style={{ "--n": char, "--i": column } as CSSProperties}>
            <span className={styles.ghost}>{char}</span>
            <span className={styles.wheel}>
              {DIGITS.map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        ),
      )}
    </span>
  );
}
