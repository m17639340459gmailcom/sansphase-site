import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LegacyHashRedirect } from "@/components/layout/legacy-hash-redirect";
import { NavPageScrollProvider } from "@/components/layout/nav-page-link";
import { SiteEscapeBack } from "@/components/layout/site-escape-back";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { articles, localize, SANSPHASE_NAME } from "@/data/sansphase";
import { languageAlternates, localizedPath, siteOrigin } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { fontVariables } from "../fonts";
import "../globals.css";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { locale } = await params;
  // Stray requests such as /favicon.ico reach this segment; the layout itself then 404s.
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const title = t("title");
  const description = t("description");
  const brand = localize(SANSPHASE_NAME, locale);
  const ogImage = articles[0].cover;

  return {
    metadataBase: new URL(siteOrigin),
    title: { default: title, template: t("titleTemplate") },
    description,
    applicationName: "SANSPHASE",
    authors: [{ name: brand }],
    creator: brand,
    keywords: ["SANSPHASE", "無相", "AI 影像", "个人知识库"],
    alternates: {
      canonical: localizedPath(locale, "/"),
      languages: languageAlternates("/"),
    },
    openGraph: {
      type: "website",
      locale: locale === "zh" ? "zh_CN" : "en_US",
      url: localizedPath(locale, "/"),
      siteName: brand,
      title,
      description,
      images: [{ url: ogImage, ...articles[0].coverSize, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#090d17" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html
      lang={locale === "zh" ? "zh-CN" : "en"}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider followBeijingTime>
          <NextIntlClientProvider locale={locale} messages={null}>
            <LegacyHashRedirect english={locale === "en"} />
            <NavPageScrollProvider>{children}</NavPageScrollProvider>
            <SiteEscapeBack />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
