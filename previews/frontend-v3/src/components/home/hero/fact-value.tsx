import type { ReactNode } from "react";
import { Odometer } from "@/components/fx/odometer";
import { countUnits } from "@/components/fx/split";
import { SplitText } from "@/components/fx/split-text";
import { cn } from "@/lib/utils";

const STAGGER = 0.035;

/**
 * A fact value that assembles itself in reading order: letters rise per glyph, digit runs spin into
 * place like an odometer. Lines only break at spaces (never inside "中文" or "'25"); screen readers
 * get the plain value once.
 */
export function FactValue({ value, delay = 0, className }: { value: string; delay?: number; className?: string }) {
  const words: ReactNode[] = [];
  let clock = delay;
  for (const [w, word] of value.split(/(\s+)/).entries()) {
    if (!word) continue;
    if (/^\s+$/.test(word)) {
      words.push(" ");
      continue;
    }
    const runs: ReactNode[] = [];
    for (const [r, run] of word.split(/(\d+)/).entries()) {
      if (!run) continue;
      if (/^\d+$/.test(run)) {
        runs.push(<Odometer key={r} value={run} delay={clock} duration={1.4} />);
        clock += 0.2;
      } else {
        runs.push(<SplitText key={r} text={run} by="char" delay={clock} stagger={STAGGER} />);
        clock += countUnits(run, "char") * STAGGER;
      }
    }
    words.push(
      <span key={w} className="whitespace-nowrap">
        {runs}
      </span>,
    );
  }
  return (
    <span className={cn("block", className)}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true">{words}</span>
    </span>
  );
}
