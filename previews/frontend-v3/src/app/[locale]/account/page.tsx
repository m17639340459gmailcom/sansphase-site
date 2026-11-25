import type { Metadata } from "next";
import { accountCopy, accountWorkflowCopy } from "@/components/account/account-copy";
import { accountInvitation, accountReturn, toSearchParams } from "@/components/account/account-paths";
import { RegistrationForm, RecoveryForm } from "@/components/account/email-access";
import { SignIn } from "@/components/account/sign-in";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { AccountShell } from "./account-shell";

type AccountPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: AccountPageProps): Promise<Metadata> {
  const { locale } = await params;
  const copy = locale === "en" ? accountCopy.en : accountCopy.zh;
  return {
    ...sansphasePageMetadata(locale, "/account", copy.title, copy.intro),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function AccountPage({ params, searchParams }: AccountPageProps) {
  const [{ locale }, rawSearch] = await Promise.all([params, searchParams]);
  const english = locale === "en";
  const copy = english ? accountCopy.en : accountCopy.zh;
  const workflow = english ? accountWorkflowCopy.en : accountWorkflowCopy.zh;
  const search = toSearchParams(rawSearch);
  const requested = accountReturn(search);
  const invitation = accountInvitation(search);
  const register = search.get("mode") === "register" || !search.has("mode") && invitation.present;

  if (register) return (
    <AccountShell locale={locale} title={workflow.registrationTitle} intro={workflow.registrationIntro}>
      <RegistrationForm key={invitation.present ? invitation.code ?? "invalid-invite" : "open"} english={english} requested={requested} invitation={invitation} />
    </AccountShell>
  );
  if (search.get("mode") === "forgot") return (
    <AccountShell locale={locale} title={workflow.forgotTitle} intro={workflow.forgotIntro}>
      <RecoveryForm english={english} requested={requested} />
    </AccountShell>
  );
  return (
    <AccountShell locale={locale} title={copy.title} intro={copy.intro} showPreview={Boolean(process.env.SANSPHASE_V3_LOCAL_READER_ORIGIN)}>
      <SignIn copy={copy} english={english} requested={requested} />
    </AccountShell>
  );
}
