import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { ConnectedCatalog } from "@/components/catalog/connected-catalog";
import { pad } from "@/components/projects/gallery-utils";
import { ProjectsGrid } from "@/components/projects/projects-grid";
import { PageHeader } from "@/components/ui/page-header";
import { v3NavItems } from "@/data/nav";
import { SANSPHASE_NAME, localize, sansphaseLinks } from "@/data/sansphase";
import { sansphaseWorks } from "@/data/sansphase-works";
import { languageAlternates, localizedPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { siteBackendOrigin } from "@/lib/site-backend";

type Props = { params: Promise<{ locale: string }> };
type Search = Record<string, string | string[] | undefined>;
const connectedIntro = { zh: "浏览已经发布的作品，了解制作过程与成果。", en: "Browse published projects, their process and results." };

const navIndex = v3NavItems.findIndex((item) => item.key === "work") + 1;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const brand = localize(SANSPHASE_NAME, locale);
  const title = `${t("projects")} · ${brand}`;
  const description = t("projectsDescription");
  const canonical = localizedPath(locale, sansphaseLinks.work);
  return {
    title: { absolute: title },
    description,
    applicationName: "SANSPHASE",
    authors: [{ name: brand }],
    creator: brand,
    keywords: ["SANSPHASE", "無相", "AI 影像", "个人知识库"],
    alternates: {
      canonical,
      languages: languageAlternates(sansphaseLinks.work),
    },
    openGraph: { title, description, type: "website", url: canonical, siteName: brand },
    twitter: { card: "summary", title, description },
    robots: { index: false, follow: false },
  };
}

export default async function ProjectsPage({ params, searchParams }: Props & { searchParams: Promise<Search> }) {
  await connection();
  const { locale } = await params;
  const t = await getTranslations("Projects");
  const origin = siteBackendOrigin();

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        accent={t("titleAccent")}
        body={origin ? localize(connectedIntro, locale) : t("intro")}
        index={`${pad(navIndex)} / ${pad(v3NavItems.length)}`}
      />
      {origin
        ? <ConnectedCatalog origin={origin} kind="works" locale={locale} search={await searchParams} />
        : <section className="container-x pb-16 sm:pb-24"><ProjectsGrid projects={sansphaseWorks} /></section>}
    </>
  );
}
