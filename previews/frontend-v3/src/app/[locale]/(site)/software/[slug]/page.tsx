import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ConnectedCatalogEntry } from "@/components/catalog/connected-catalog";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { localize } from "@/data/sansphase";
import { findSoftwareSample, softwareSamples } from "@/data/sansphase-software";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";

type Props = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  if (siteBackendOrigin()) return [];
  return softwareSamples.map(({ id }) => ({ slug: id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (siteBackendOrigin()) return { title: locale === "en" ? "Software" : "软件推荐", robots: { index: false, follow: false } };
  const item = findSoftwareSample(slug);
  if (!item) return {};
  return sansphasePageMetadata(locale, `/software/${slug}`, localize(item.title, locale), localize(item.summary, locale));
}

export default async function SoftwareDetail({ params }: Props) {
  await connection();
  const { locale, slug } = await params;
  const origin = siteBackendOrigin();
  if (origin) return <ConnectedCatalogEntry origin={origin} kind="software" locale={locale} slug={slug} />;
  const item = findSoftwareSample(slug);
  if (!item) notFound();

  const en = locale === "en";
  const sections = [
    { label: en ? "Purpose and review" : "软件用途与使用体验", content: item.usage },
    { label: en ? "Getting started" : "安装与上手", content: item.setup },
    { label: en ? "Where it fits" : "适用场景与限制", content: item.limitations },
  ];

  return (
    <>
      <PageHeader eyebrow={en ? "Software · demo review" : "软件推荐 · 演示记录"} title={localize(item.title, locale)} body={localize(item.summary, locale)} />
      <div className="container-x grid gap-6 pb-12 pt-5 sm:pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.45fr)]">
        <article className="divide-y divide-line rounded-2xl border border-line bg-bg-elevated px-6 sm:px-8">
          {sections.map(({ label, content }) => (
            <section className="py-6" key={label}>
              <h2 className="font-display text-xl font-semibold">{label}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{localize(content, locale)}</p>
            </section>
          ))}
        </article>
        <aside className="self-start rounded-2xl border border-line bg-bg-elevated p-6">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-muted">{en ? "Supported platforms" : "支持平台"}</dt>
              <dd className="mt-1">{localize(item.platforms, locale)}</dd>
            </div>
            <div>
              <dt className="text-muted">{en ? "Pricing model" : "费用说明"}</dt>
              <dd className="mt-1">{localize(item.license, locale)}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
            <ButtonLink href="/software" size="sm" variant="secondary">{en ? "All tools" : "全部工具"}</ButtonLink>
            <ButtonLink href="/learning" size="sm" variant="ghost" arrow>{en ? "Browse materials" : "浏览实践资料"}</ButtonLink>
          </div>
        </aside>
      </div>
    </>
  );
}
