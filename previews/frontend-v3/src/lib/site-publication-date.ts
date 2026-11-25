import { z } from "zod";

const publicationDate = z.iso.date();
const publicationInstant = z.iso.datetime({ offset: true });
const siteTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function notePublishedAt(value: string): string | null {
  if (publicationDate.safeParse(value).success) return value + " 00:00:00";
  if (publicationInstant.safeParse(value).success) return siteTime.format(new Date(value));
  // Earlier site releases used a Beijing wall-clock string.
  const wallClock = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?: ((?:[01]?\d|2[0-3])):([0-5]\d)(?::([0-5]\d))?)?$/.exec(value);
  if (!wallClock) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = wallClock;
  const date = year + "-" + month.padStart(2, "0") + "-" + day.padStart(2, "0");
  return publicationDate.safeParse(date).success ? date + " " + hour.padStart(2, "0") + ":" + minute + ":" + second : null;
}
