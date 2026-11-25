import { ArrowUpRight, Mail, MessagesSquare } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { FxTrigger } from "@/components/fx/trigger";
import { ContactBanner } from "@/components/layout/contact-banner";
import { Reveal } from "@/components/ui/reveal";
import { v3NavItems } from "@/data/nav";
import { sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { BackToTop } from "./back-to-top";
import { FooterWordmark } from "./footer-wordmark";
import { LocalClock } from "./local-clock";
import { pad } from "./nav-utils";
import styles from "./footer.module.css";

function Eyebrow({ text }: { text: string }) {
  return (
    <FxTrigger as="p" className="eyebrow mb-5 flex items-center gap-3">
      <span className="fx-line inline-block h-px w-5 bg-accent" />
      <ScrambleText text={text} />
    </FxTrigger>
  );
}

export async function Footer() {
  const t = await getTranslations("Footer");
  const tNav = await getTranslations("Nav");
  const tCommon = await getTranslations("Common");
  const tCursor = await getTranslations("FX.common.cursor");
  const locale = await getLocale();
  const year = new Date().getFullYear();
  const linkClass = cn(styles.link, "group text-sm text-muted transition-colors duration-300 hover:text-accent pointer-coarse:min-h-11");

  return (
    <SpotlightGroup as="footer" className="relative mt-16 border-t border-line bg-bg-elevated/50 sm:mt-20">
      <div className="container-x">
        <ContactBanner />

        <div className="grid gap-x-10 gap-y-8 border-t border-line py-10 sm:grid-cols-2 lg:grid-cols-12">
          {/* Brand */}
          <Reveal className="sm:col-span-2 lg:col-span-5">
            <Link href="/" className="group inline-flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-fg font-display text-sm font-bold text-bg transition-[rotate,scale] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-rotate-6 group-hover:scale-105">
                S
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-display text-lg font-semibold tracking-tight">
                  {locale === "zh" ? "無相" : "SANSPHASE"}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                  {locale === "zh" ? "SANSPHASE" : "無相"}
                </span>
              </span>
            </Link>
            <p className="mt-5 max-w-sm text-[13px] leading-[1.85] text-muted">{t("colophonBody")}</p>
          </Reveal>

          {/* Navigate */}
          <Reveal delay={0.08} className="lg:col-span-3">
            <Eyebrow text={t("navigate")} />
            <ul className="grid grid-cols-2 gap-x-6 gap-y-3 pointer-coarse:gap-y-0">
              {v3NavItems.map((item, i) => (
                <li key={item.key}>
                  <Link href={item.href} className={cn(linkClass, "inline-flex items-baseline gap-2.5 pointer-coarse:items-center")}>
                    <span
                      aria-hidden="true"
                      className="font-mono text-[10px] tracking-[0.1em] text-muted/60 transition-colors duration-300 group-hover:text-accent"
                    >
                      {pad(i)}
                    </span>
                    <span className={styles.underline}>{tNav(item.key)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Connect */}
          <Reveal delay={0.16} className="min-w-0 lg:col-span-4">
            <Eyebrow text={t("connect")} />
            <ul className="flex flex-col gap-3 pointer-coarse:gap-0">
              {[
                { href: sansphaseLinks.contact, label: tNav("contact"), Icon: Mail },
                { href: sansphaseLinks.community, label: tNav("community"), Icon: MessagesSquare },
              ].map(({ href, label, Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    data-cursor-text={tCursor("visit")}
                    className={cn(linkClass, "inline-flex items-center gap-3")}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className={styles.underline}>{label}</span>
                    <ArrowUpRight aria-hidden="true" className={cn(styles.arrow, "h-3.5 w-3.5")} />
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <div className="flex flex-col gap-x-8 gap-y-5 border-t border-line py-6 text-xs text-muted md:flex-row md:flex-wrap md:items-center md:justify-between">
          <p>{t("rights", { year })} · {locale === "zh" ? "V3 本地演示" : "V3 local demo"}</p>
          <LocalClock label={tCommon("localTime")} seconds />
          <BackToTop label={t("backToTop")} className="self-start md:self-auto" />
        </div>
      </div>

      <FooterWordmark text="SANSPHASE" />
    </SpotlightGroup>
  );
}
