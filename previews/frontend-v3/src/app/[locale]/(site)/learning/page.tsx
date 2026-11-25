import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { connection } from "next/server";
import { getMessages, getTranslations } from "next-intl/server";
import { ConnectedCatalog } from "@/components/catalog/connected-catalog";
import { MaterialsDirectory } from "@/components/learning/materials-directory";
import { PageHeader } from "@/components/ui/page-header";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const connectedIntro = (locale: string) => locale === "en"
  ? "Browse learning guides, templates and reference materials."
  : "查阅站内发布的学习记录、实践模板和参考资料。";

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Learning" });
  return sansphasePageMetadata(locale, "/learning", t("navTitle"), siteBackendOrigin() ? connectedIntro(locale) : t("intro"));
}

export default async function LearningPage({ params, searchParams }: Props) {
  await connection();
  const [{ locale }, t] = await Promise.all([params, getTranslations("Learning")]);
  const origin = siteBackendOrigin();

  return (
    <>
      <PageHeader eyebrow={t("navTitle")} title={t("title")} accent={t("accent")} body={origin ? connectedIntro(locale) : t("intro")} />
      {origin
        ? <ConnectedCatalog origin={origin} kind="resources" locale={locale} search={await searchParams} />
        : <PreviewDirectory />}
    </>
  );
}

async function PreviewDirectory() {
  const { Learning } = await getMessages();
  return (
    <section className="container-x pb-12 pt-5 sm:pb-16">
      <NextIntlClientProvider messages={{ Learning }}>
        <MaterialsDirectory />
      </NextIntlClientProvider>
    </section>
  );
}
