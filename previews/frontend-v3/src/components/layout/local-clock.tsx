"use client";

import { useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import styles from "./local-clock.module.css";

const formatOptions: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Shanghai",
};
const minutesFormat = new Intl.DateTimeFormat("en-US", formatOptions);
const secondsFormat = new Intl.DateTimeFormat("en-US", { ...formatOptions, second: "2-digit" });

/** Notifies on every `ms` boundary of the wall clock (not drifting like a plain interval). */
function every(ms: number) {
  return (notify: () => void) => {
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(tick, ms - (Date.now() % ms) + 15);
    };
    const tick = () => {
      notify();
      schedule();
    };
    schedule();
    return () => window.clearTimeout(timer);
  };
}

const clocks = {
  minutes: {
    subscribe: every(60_000),
    snapshot: () => minutesFormat.format(new Date()),
    server: () => "--:--",
  },
  seconds: {
    subscribe: every(1_000),
    snapshot: () => secondsFormat.format(new Date()),
    server: () => "--:--:--",
  },
};

/** One digit that rolls the previous value up and out whenever it changes. */
function Digit({ value }: { value: string }) {
  const [digits, setDigits] = useState({ value, previous: value });
  if (digits.value !== value) setDigits({ value, previous: digits.value });
  return (
    <span className={styles.cell}>
      <span key={digits.value} className={styles.roll} data-roll={digits.previous !== digits.value ? "" : undefined}>
        <span>{digits.previous}</span>
        <span>{digits.value}</span>
      </span>
    </span>
  );
}

/** Beijing clock with rolling digits. Inherits `color` so it works on inverted surfaces. */
export function LocalClock({
  label,
  className,
  seconds = false,
}: {
  label: string;
  className?: string;
  /** Tick every second (HH:MM:SS) instead of every minute. */
  seconds?: boolean;
}) {
  const clock = seconds ? clocks.seconds : clocks.minutes;
  const time = useSyncExternalStore(clock.subscribe, clock.snapshot, clock.server);

  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-xs tracking-[0.12em] text-muted", className)}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      <span className="font-semibold tabular-nums text-current">
        <span className="sr-only">{time}</span>
        <span aria-hidden="true" className={styles.digits}>
          {Array.from(time, (char, i) =>
            char === ":" ? (
              <span key={i} className={styles.sep}>
                :
              </span>
            ) : (
              <Digit key={i} value={char} />
            ),
          )}
        </span>
      </span>
      <span className="uppercase opacity-80">{label}</span>
    </span>
  );
}
