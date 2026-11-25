import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { accountCopy } from "@/components/account/account-copy";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { NavPageLink } from "@/components/layout/nav-page-link";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import styles from "./account-page.module.css";

const introductionSections = ["learning", "software", "work", "community"] as const;

export async function AccountShell({ locale, title, intro, showPreview = false, children }: {
  locale: string; title: string; intro: string; showPreview?: boolean; children: ReactNode;
}) {
  const english = locale === "en";
  const copy = english ? accountCopy.en : accountCopy.zh;
  const [nav, home] = await Promise.all([
    getTranslations({ locale, namespace: "Nav" }),
    getTranslations({ locale, namespace: "Home" }),
  ]);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.wordmark}>
          <span lang="zh" className={styles.mark}>無相</span>
          <span className={styles.name}>SANSPHASE</span>
        </div>
        <div className={styles.tools}>
          <NavPageLink href="/" prefetch={false} className={styles.back}>
            <ArrowLeft aria-hidden className="size-4" />
            <span className={styles.backLabel}>{copy.back}</span>
          </NavPageLink>
          <LocaleSwitcher label={nav("switchLocale")} />
          <ThemeToggle label={nav("toggleTheme")} />
        </div>
      </header>

      <main className={styles.main} aria-labelledby="account-heading">
        <div className={styles.layout}>
          <section className={styles.overview} aria-labelledby="site-heading">
            <h2 id="site-heading" className={styles.siteTitle}>
              {home("headline1")}{english && " "}<span className={styles.titleAccent}>{home("headline2")}</span>
            </h2>
            <p className={styles.siteIntro}>{home("intro")}</p>
            <ul className={styles.sections}>
              {introductionSections.map((section) => (
                <li key={section}>
                  <Link href={sansphaseLinks[section]} prefetch={false}>{nav(section)}</Link>
                </li>
              ))}
            </ul>
          </section>
          <div className={styles.panel}>
            <h1 id="account-heading" className={styles.title}>{title}</h1>
            <p className={styles.intro}>{intro}</p>
            {children}
            {showPreview && <p className={styles.preview}>{copy.preview}</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
