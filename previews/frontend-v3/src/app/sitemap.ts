import type { MetadataRoute } from "next";
import { v3NavItems } from "@/data/nav";
import { absoluteUrl } from "@/i18n/paths";
import { routing } from "@/i18n/routing";

function entry(path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]) {
  return routing.locales.map((locale) => ({
    url: absoluteUrl(locale, path),
    lastModified: new Date(),
    changeFrequency,
    priority,
    alternates: {
      languages: Object.fromEntries(routing.locales.map((l) => [l, absoluteUrl(l, path)])),
    },
  }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return v3NavItems.flatMap(({ href }) => entry(href, href === "/" ? 1 : 0.8, "weekly"));
}
