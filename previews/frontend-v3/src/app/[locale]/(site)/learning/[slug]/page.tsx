import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ArrowLeft, Download } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { ConnectedCatalogEntry } from "@/components/catalog/connected-catalog";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { localize } from "@/data/sansphase";
import { materialDownloadHref, sansphaseMaterials } from "@/data/sansphase-materials";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { renderMdx } from "@/lib/mdx";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";
import { formatDate } from "@/lib/utils";

type Props = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  if (siteBackendOrigin()) return [];
  return routing.locales.flatMap((locale) => sansphaseMaterials.map(({ id }) => ({ locale, slug: id })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (siteBackendOrigin()) return { title: locale === "en" ? "Learning materials" : "资料", robots: { index: false, follow: false } };
  const material = sansphaseMaterials.find(({ id }) => id === slug);
  if (!material) return {};
  return sansphasePageMetadata(locale, material.detailHref, localize(material.title, locale), localize(material.summary, locale));
}

export default async function MaterialPage({ params }: Props) {
  await connection();
  const { locale, slug } = await params;
  const origin = siteBackendOrigin();
  if (origin) return <ConnectedCatalogEntry origin={origin} kind="resources" locale={locale} slug={slug} />;
  const material = sansphaseMaterials.find(({ id }) => id === slug);
  if (!material) notFound();

  const href = materialDownloadHref(material.id, locale);
  const [t, raw] = await Promise.all([
    getTranslations({ locale, namespace: "Learning" }),
    readFile(join(process.cwd(), "public", href.slice(1)), "utf8"),
  ]);
  // The downloaded document keeps its own title. The preview already has a page heading.
  const body = await renderMdx(raw.replace(/^# [^\n]+\r?\n+/, ""));

  return (
    <article className="pb-16 sm:pb-24">
      <PageHeader eyebrow={t("navTitle")} title={localize(material.title, locale)} body={localize(material.summary, locale)} />
      <div className="container-x">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
          <Link href="/learning" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted transition-colors hover:text-accent">
            <ArrowLeft aria-hidden className="size-4" />
            {t("back")}
          </Link>
          <time className="font-mono text-xs text-muted" dateTime={material.date}>{formatDate(material.date, locale)}</time>
          <a className={buttonClasses({ variant: "secondary" })} href={href} download>
            <Download aria-hidden className="size-4" />
            {t("download")}
          </a>
        </div>
        <div className="prose-tdx mt-10 max-w-3xl min-w-0">{body}</div>
      </div>
    </article>
  );
}
