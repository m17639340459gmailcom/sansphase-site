import { Monitor } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale } from "next-intl/server";
import { CatalogCard, CatalogCardGrid } from "@/components/catalog/catalog-card";
import { ConnectedCatalog } from "@/components/catalog/connected-catalog";
import { PageHeader } from "@/components/ui/page-header";
import { localize } from "@/data/sansphase";
import { softwareSamples } from "@/data/sansphase-software";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";

const heading = {
  label: { zh: "软件推荐", en: "Software" },
  title: { zh: "工具与", en: "Tools from" },
  accent: { zh: "使用体验。", en: "the workbench." },
  body: { zh: "了解工具的适用场景、支持的平台和上手方法。", en: "Find out where a tool fits, which platforms it supports and how to get started." },
  demo: { zh: "以下为演示推荐。", en: "These are demo recommendations." },
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return sansphasePageMetadata(locale, "/software", localize(heading.label, locale), localize(heading.body, locale));
}

export default async function SoftwarePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const locale = await getLocale();
  const text = (value: Parameters<typeof localize>[0]) => localize(value, locale);
  const origin = siteBackendOrigin();
  const intro = origin ? text(heading.body) : text(heading.body) + (locale === "en" ? " " : "") + text(heading.demo);

  return (
    <>
      <PageHeader eyebrow={text(heading.label)} title={text(heading.title)} accent={text(heading.accent)} body={intro} />
      {origin ? <ConnectedCatalog origin={origin} kind="software" locale={locale} search={await searchParams} /> : (
        <section className="container-x pb-12 pt-6 sm:pb-16">
          <CatalogCardGrid fillWidth>
            {softwareSamples.map((item) => (
              <CatalogCard key={item.id} href={`/software/${item.id}`} title={text(item.title)} summary={text(item.summary)}
                fallback={<Monitor className="size-9" strokeWidth={1.25} />} />
            ))}
          </CatalogCardGrid>
        </section>
      )}
    </>
  );
}
