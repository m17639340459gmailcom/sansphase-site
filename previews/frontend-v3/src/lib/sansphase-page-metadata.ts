import type { Metadata } from "next";
import { localize, SANSPHASE_NAME } from "@/data/sansphase";
import { languageAlternates, localizedPath } from "@/i18n/paths";

export function sansphasePageMetadata(locale: string, path: string, title: string, description: string): Metadata {
  const brand = localize(SANSPHASE_NAME, locale);
  const headline = `${title} · ${brand}`;
  const canonical = localizedPath(locale, path);

  return {
    title: { absolute: headline },
    description,
    alternates: { canonical, languages: languageAlternates(path) },
    openGraph: { type: "website", title: headline, description, url: canonical, siteName: brand },
    twitter: { card: "summary", title: headline, description },
  };
}
