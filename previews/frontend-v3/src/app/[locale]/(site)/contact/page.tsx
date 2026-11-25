import { ChevronDown, Clapperboard, Code2, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { SpotlightCard } from "@/components/fx/spotlight";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { sansphaseLinks } from "@/data/sansphase";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";
import { readSiteContactLinks } from "@/lib/site-contact";

const channels = [
  { key: "qq", Icon: MessagesSquare },
  { key: "douyin", Icon: Clapperboard },
] as const;

const services = ["websites", "features", "automation"] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SiteContact" });
  return sansphasePageMetadata(locale, "/contact", t("navTitle"), t(siteBackendOrigin() ? "published.intro" : "intro"));
}

export default async function ContactPage() {
  await connection();
  const t = await getTranslations("SiteContact");
  const origin = siteBackendOrigin();
  const published = origin ? await readSiteContactLinks(origin) : null;
  const availableChannels = origin ? channels.filter(({ key }) => published?.[key]) : channels;

  return (
    <>
      <PageHeader eyebrow={t("navTitle")} title={t("title")} accent={t("accent")} body={t(origin ? "published.intro" : "intro")} />
      <div className="container-x grid gap-5 pb-12 pt-6 sm:pb-16 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <SpotlightCard as="section" className="rounded-2xl border border-line bg-bg-elevated p-6 sm:p-8" aria-labelledby="contacts-title">
          <div className="flex items-center gap-4 pb-6">
            <Image
              src="/images/sansphase/author-avatar.webp"
              width={56}
              height={56}
              sizes="56px"
              alt=""
              className="size-14 shrink-0 rounded-xl border border-line object-cover"
            />
            <div>
              <h2 id="contacts-title" className="font-display text-xl font-semibold">{t("channels")}</h2>
              <p className="mt-1 text-sm text-muted">無相 SANSPHASE</p>
            </div>
          </div>
          {availableChannels.length ? <ul className="divide-y divide-line border-t border-line">
            {availableChannels.map(({ key, Icon }) => (
              <li key={key}>
                <details className="group/channel">
                  <summary className="grid min-h-16 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 py-3 text-fg transition-colors hover:text-accent focus-visible:text-accent [&::-webkit-details-marker]:hidden">
                    <Icon aria-hidden className="size-5 shrink-0 text-accent" />
                    <span>
                      <span className="block text-sm font-semibold">{t(origin ? `published.channel.${key}.name` : `channel.${key}.name`)}</span>
                      <span className="mt-1 block text-xs leading-5 text-muted">{t(`channel.${key}.description`)}</span>
                    </span>
                    <ChevronDown aria-hidden className="size-4 shrink-0 text-accent transition-transform group-open/channel:rotate-180" />
                  </summary>
                  <div className="mb-4 ms-9 rounded-lg border border-line bg-bg px-4 py-3 text-sm leading-6 text-muted">
                    {published?.[key]
                      ? <ButtonLink href={published[key]} size="sm" variant="secondary" arrow>{t(`published.channel.${key}.action`)}</ButtonLink>
                      : <p>{t(`channel.${key}.example`)}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul> : (
            <p className="border-t border-line pt-4 text-sm leading-6 text-muted">
              {t(published ? "published.empty" : "published.unavailable")}
            </p>
          )}
        </SpotlightCard>
        <section aria-labelledby="collaboration-title" className="rounded-2xl border border-line bg-bg-elevated/55 p-6 sm:p-8">
          <Code2 aria-hidden className="size-6 text-accent" />
          <h2 id="collaboration-title" className="mt-4 font-display text-xl font-semibold">{t("collaboration")}</h2>
          <p className="mt-3 text-sm leading-7 text-muted">{t("collaborationHint")}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {services.map((service) => (
              <li key={service} className="rounded-full border border-line bg-bg px-3 py-1.5 text-xs text-fg">{t(`services.${service}`)}</li>
            ))}
          </ul>
          <ButtonLink className="mt-6" href={sansphaseLinks.work} size="sm" variant="secondary" arrow>{t(origin ? "published.viewWork" : "viewWork")}</ButtonLink>
        </section>
      </div>
    </>
  );
}
