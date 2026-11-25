/**
 * Global site configuration.
 * Everything personal lives here so it can be edited in one place.
 */
const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const site = {
  name: "Dingxin Tao",
  nameZh: "陶鼎新",
  initials: "DT",
  handle: "DingxinTao0417",
  // Public URL of the deployed site (used for canonical URLs, sitemap, OG images).
  url: configuredSiteUrl || "https://tdx-portfolio.vercel.app",
  email: "taodingxin0417@gmail.com",
  location: { en: "Los Angeles, CA", zh: "美国 · 洛杉矶" },
  timeZone: "America/Los_Angeles",
  repo: "https://github.com/DingxinTao0417/tdx-portfolio",
  /** Comprehensive resume PDFs under /public/resume — pick by locale. */
  resumes: {
    en: "/resume/dingxin-tao-comprehensive-en.pdf",
    zh: "/resume/dingxin-tao-comprehensive-zh.pdf",
  },
  socials: [
    {
      id: "github",
      label: "GitHub",
      href: "https://github.com/DingxinTao0417",
      handle: "@DingxinTao0417",
    },
    {
      id: "email",
      label: "Email",
      href: "mailto:taodingxin0417@gmail.com",
      handle: "taodingxin0417@gmail.com",
    },
    // TODO: add your LinkedIn / X handles here once you want them public.
    // { id: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/…", handle: "in/…" },
  ],
} as const;

export type SocialId = (typeof site.socials)[number]["id"];

/** Locale-aware resume PDF path (falls back to English). */
export function resumeUrlFor(locale: string): string {
  return locale === "zh" ? site.resumes.zh : site.resumes.en;
}
