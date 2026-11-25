import type { Locale } from "@/i18n/routing";

export type Localized = Record<Locale, string>;

export function pick(value: Localized, locale: string): string {
  return value[(locale as Locale) in value ? (locale as Locale) : "en"];
}
