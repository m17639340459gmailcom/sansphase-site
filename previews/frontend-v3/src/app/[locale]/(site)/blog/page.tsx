import { redirect } from "next/navigation";
import { sansphaseLinks } from "@/data/sansphase";
import { localizedPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function BlogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(localizedPath(locale, sansphaseLinks.blogIndex));
}
