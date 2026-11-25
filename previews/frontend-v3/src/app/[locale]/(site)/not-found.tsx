import { useTranslations } from "next-intl";
import { SearchSiteButton } from "@/components/contact/search-site-button";
import { StatusScreen } from "@/components/contact/status-screen";
import { ButtonLink } from "@/components/ui/button";
import { Magnetic } from "@/components/ui/magnetic";
import { v3NavItems } from "@/data/nav";
import { Link } from "@/i18n/navigation";

const jumps = v3NavItems.filter(({ key }) => key === "work" || key === "about" || key === "contact");

export default function NotFound() {
  const t = useTranslations("NotFound");
  const fx = useTranslations("FX.contact.notFound");
  const nav = useTranslations("Nav");

  return (
    <StatusScreen
      code={t("code")}
      status={fx("status")}
      detail={`HTTP ${t("code")}`}
      title={t("title")}
      accent={t("titleAccent")}
      body={t("body")}
    >
      <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
        <Magnetic>
          <ButtonLink href="/" size="lg" arrow>
            {t("cta")}
          </ButtonLink>
        </Magnetic>
        <nav aria-label={fx("jump")} className="flex flex-wrap items-center gap-x-5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          <span aria-hidden>{fx("jump")}</span>
          {jumps.map((jump) => (
            <Link
              key={jump.key}
              href={jump.href}
              className="group/jump inline-flex min-h-11 items-center gap-1 transition-colors hover:text-accent"
            >
              <span aria-hidden className="text-accent transition-transform duration-300 group-hover/jump:translate-x-0.5">/</span>
              {nav(jump.key)}
            </Link>
          ))}
          <SearchSiteButton label={fx("search")} />
        </nav>
      </div>
    </StatusScreen>
  );
}
