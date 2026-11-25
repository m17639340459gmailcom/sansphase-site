import type { PublicationCalendar } from "@/lib/site-publishing-model";

type PublicationDay = PublicationCalendar["days"][number];

export type ContributionStats = {
  activeDays: number;
  longestStreak: number;
  /** Consecutive active days ending today; an empty today does not break it yet. */
  currentStreak: number;
  busiest: PublicationDay | null;
};

/** The calendar supplies consecutive, date-sorted days. */
export function contributionStats(days: readonly PublicationDay[]): ContributionStats {
  let activeDays = 0;
  let longestStreak = 0;
  let run = 0;
  let busiest: PublicationDay | null = null;
  for (const day of days) {
    if (day.count === 0) {
      run = 0;
      continue;
    }
    activeDays++;
    longestStreak = Math.max(longestStreak, ++run);
    if (!busiest || day.count > busiest.count) busiest = day;
  }

  let currentStreak = 0;
  let index = days.length - 1;
  if (days[index]?.count === 0) index--;
  while (index >= 0 && days[index].count > 0) {
    currentStreak++;
    index--;
  }
  return { activeDays, longestStreak, currentStreak, busiest };
}
