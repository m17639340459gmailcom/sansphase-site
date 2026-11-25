import { routing } from "./routing";

export const siteOrigin = process.env.SANSPHASE_V3_SITE_BACKEND?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:4308";

function prefixMode(): string {
  const lp: unknown = routing.localePrefix;
  return typeof lp === "object" && lp !== null && "mode" in lp
    ? String((lp as { mode: string }).mode)
    : String(lp ?? "always");
}

/**
 * External pathname for a route in a given locale, honoring `localePrefix`.
 * `as-needed` → default locale has no prefix ("/about"), others do ("/en/about").
 */
export function localizedPath(locale: string, path: string): string {
  const clean = path === "/" ? "" : path.replace(/\/$/, "");
  const mode = prefixMode();
  const omitPrefix = mode === "never" || (mode === "as-needed" && locale === routing.defaultLocale);
  return omitPrefix ? clean || "/" : `/${locale}${clean}`;
}

export function absoluteUrl(locale: string, path: string): string {
  return new URL(localizedPath(locale, path), siteOrigin).href;
}

/** `alternates.languages` map for Next metadata, including x-default. */
export function languageAlternates(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(routing.locales.map((l) => [l, localizedPath(l, path)])),
    "x-default": localizedPath(routing.defaultLocale, path),
  };
}
