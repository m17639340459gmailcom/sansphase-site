import { accountWorkflowCopy } from "@/components/account/account-copy";
import { accountReturn, toSearchParams } from "@/components/account/account-paths";
import { ResetPasswordForm } from "@/components/account/email-access";
import { AccountShell } from "../account/account-shell";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const copy = locale === "en" ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  return { title: copy.resetTitle, robots: { index: false, follow: false }, referrer: "no-referrer" as const };
}

export default async function ResetPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ locale }, search] = await Promise.all([params, searchParams]);
  const english = locale === "en";
  const copy = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  return (
    <AccountShell locale={locale} title={copy.resetTitle} intro={copy.resetIntro}>
      <ResetPasswordForm english={english} requested={accountReturn(toSearchParams(search))} />
    </AccountShell>
  );
}
