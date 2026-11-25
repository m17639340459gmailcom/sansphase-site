import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localizedPath } from "@/i18n/paths";

export async function ResourceAccessMessage({ state, locale, returnTo, bookTitle }: {
  state: "sign-in" | "vip-required" | "changed";
  locale: string;
  returnTo: string;
  bookTitle?: string;
}) {
  const t = await getTranslations("Library");
  const title = state === "sign-in" ? t("signInRequired") : state === "vip-required" ? t("vipRequired") : t("editionChanged");
  const [returnPath, returnQuery] = returnTo.split("?");
  const localizedReturn = localizedPath(locale, returnPath) + (returnQuery ? `?${returnQuery}` : "");
  const linkClass = "mt-3 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline";
  return (
    <section className="rounded-2xl border border-line bg-bg-elevated px-5 py-9 sm:px-8">
      {bookTitle && <p className="mb-2 text-sm text-muted">{bookTitle}</p>}
      <h2 className="text-lg font-semibold">{title}</h2>
      {state === "changed" ? <a href={localizedReturn} className={linkClass}>{t("reloadChapter")}</a> :
        <Link href={state === "sign-in" ? { pathname: "/account", query: { return: localizedReturn } } : "/resources"} prefetch={false} className={linkClass}>
          {t(state === "sign-in" ? "signIn" : "back")}
        </Link>}
    </section>
  );
}
