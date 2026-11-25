import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SiteSupport" });
  return sansphasePageMetadata(locale, "/support", t("navTitle"), t("body"));
}

export default async function SupportPage() {
  const t = await getTranslations("SiteSupport");
  return (
    <PageHeader eyebrow={t("navTitle")} title={t("title")} body={t("body")}>
      <ButtonLink className="mt-6" href="/" size="sm" variant="secondary" arrow>{t("home")}</ButtonLink>
    </PageHeader>
  );
}
