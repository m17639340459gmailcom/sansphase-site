import type { LocalizedText } from "@/data/sansphase";

export type NoteCard = {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  tags: string[];
  date: string;
  href: string;
};

const siteDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MS_PER_DAY = 86_400_000;

export type ResourcePublicationDay = { date: string; resourceCenter: number; materials: number; works: number; software: number };
export type PublicationDay = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 };
export type PublicationCalendar = {
  year: number | null;
  startDate: string;
  endDate: string;
  total: number;
  days: PublicationDay[];
};
export type HomeFeature = { id: string; title: string; summary: string; coverSrc?: string };
export type HomeFeatures = Partial<Record<"works" | "resources" | "resource-center" | "software", HomeFeature>>;
export type SitePublishing = { notes: NoteCard[]; noteTotal: number | null; activity: ResourcePublicationDay[] | null; featured?: HomeFeatures | null };

export function publicationToday(now = new Date()): string {
  return siteDate.format(now);
}

export function countPublications({ resourceCenter, materials, works, software }: ResourcePublicationDay): number {
  return resourceCenter + materials + works + software;
}

export function publicationYears(days: readonly ResourcePublicationDay[], today: string): number[] {
  const current = Number(today.slice(0, 4));
  const first = days.reduce((earliest, day) => day.date <= today && countPublications(day) > 0
    ? Math.min(earliest, Number(day.date.slice(0, 4))) : earliest, current);
  return Array.from({ length: current - first + 1 }, (_, index) => current - index);
}

export function publicationCalendar(days: readonly ResourcePublicationDay[], today: string, year: number | null): PublicationCalendar {
  const endDate = year === null ? today : `${year}-12-31`;
  let startDate = `${year}-01-01`;
  if (year === null) {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    startDate = start.toISOString().slice(0, 10);
  }
  const counts = new Map(days.map((day) => [day.date, countPublications(day)]));
  const calendar: PublicationCalendar = { year, startDate, endDate, total: 0, days: [] };
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (let timestamp = Date.parse(`${startDate}T00:00:00Z`); timestamp <= end; timestamp += MS_PER_DAY) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const count = date <= today ? counts.get(date) ?? 0 : 0;
    calendar.total += count;
    calendar.days.push({ date, count, level: Math.min(count, 4) as PublicationDay["level"] });
  }
  return calendar;
}

