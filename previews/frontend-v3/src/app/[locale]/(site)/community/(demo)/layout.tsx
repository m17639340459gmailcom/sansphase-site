import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { localizedPath } from "@/i18n/paths";
import { siteBackendOrigin } from "@/lib/site-backend";

export default async function CommunityDemoLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  await connection();
  if (siteBackendOrigin()) {
    const { locale } = await params;
    redirect(localizedPath(locale, "/community"));
  }
  return children;
}
