import { Coffee, Gift, Globe, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getLocale } from "next-intl/server";
import { CommunityEntry } from "@/components/community/community-entry";
import { communityCopy, toCommunityLocale } from "@/components/community/copy";
import { communityEntryCopy } from "@/components/community/entry-copy";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { communityEntryPost, communityOrigin, communityPublicHref } from "@/lib/community-entry";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";

const features = [
  { key: "discussions", Icon: MessagesSquare },
  { key: "stardust", Icon: Gift },
  { key: "teaRoom", Icon: Coffee },
] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const language = toCommunityLocale(locale);
  return sansphasePageMetadata(locale, "/community", communityCopy[language].name, communityEntryCopy[language].intro);
}

type Props = { searchParams: Promise<{ post?: string | string[] }> };

export default async function CommunityPage({ searchParams }: Props) {
  await connection();
  const locale = toCommunityLocale(await getLocale());
  const copy = communityEntryCopy[locale];
  const post = communityEntryPost((await searchParams).post);

  return (
    <>
      <PageHeader
        eyebrow={communityCopy[locale].name}
        title={copy.title}
        accent={copy.accent}
        body={copy.intro}
        className="max-[360px]:[&_h1]:text-[2rem]"
      />
      <div className="container-x pb-12 pt-6 sm:pb-16">
        <section
          aria-labelledby="community-gateway-title"
          className="grid overflow-hidden rounded-2xl border border-line bg-bg-elevated md:grid-cols-[minmax(0,1.16fr)_minmax(0,1fr)]"
        >
          <div className="relative isolate flex flex-col justify-center border-b border-line px-6 py-7 sm:p-9 md:border-r md:border-b-0 lg:p-11">
            <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(130deg,transparent,var(--fg))]" />
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_100%_0%,var(--accent-soft),transparent_70%)]" />
            <p className="flex items-center gap-2 break-all font-mono text-xs tracking-wide text-muted">
              <Globe aria-hidden className="size-4 shrink-0 text-accent" />
              {new URL(communityOrigin).hostname}
            </p>
            <h2 id="community-gateway-title" className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {copy.gatewayTitle}
            </h2>
            <p className="mt-3 max-w-sm text-sm leading-7 text-muted">{copy.gatewayIntro}</p>
            <div className="mt-6">
              {siteBackendOrigin() ? <CommunityEntry locale={locale} post={post} /> : (
                <div className="flex flex-col items-start gap-3">
                  <ButtonLink href={communityPublicHref(post)} arrow>{copy.enter}</ButtonLink>
                  <p className="max-w-sm text-xs leading-5 text-muted">{copy.preview}</p>
                </div>
              )}
            </div>
          </div>
          <ul className="flex flex-col justify-center divide-y divide-line px-6 py-3 sm:px-9 sm:py-5 lg:px-10">
            {features.map(({ key, Icon }) => (
              <li key={key} className="flex items-start gap-4 py-4 sm:py-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-accent-soft text-accent">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{copy[key].title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{copy[key].description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
