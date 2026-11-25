import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Portrait } from "@/components/about/portrait";
import { Publications } from "@/components/about/publications";
import { Story } from "@/components/about/story";
import { EducationTimeline } from "@/components/about/timeline";
import styles from "@/components/about/about.module.css";
import { Aurora } from "@/components/fx/aurora";
import { BorderBeam } from "@/components/fx/border-beam";
import { ScrambleText } from "@/components/fx/scramble-text";
import { ScrollFade } from "@/components/fx/scroll-fade";
import { SpotlightCard, SpotlightGroup } from "@/components/fx/spotlight";
import { TerminalPath } from "@/components/fx/terminal-path";
import { FxTrigger } from "@/components/fx/trigger";
import { ButtonLink } from "@/components/ui/button";
import { Magnetic } from "@/components/ui/magnetic";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { v3NavItems } from "@/data/nav";
import { sansphaseLinks, SANSPHASE_NAME } from "@/data/sansphase";
import type { EducationEntry } from "@/data/timeline";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { demoAboutPublications, siteAboutPublications, type AboutPublicationSearch } from "@/lib/about-publications";
import { getSiteArticleIndex } from "@/lib/sansphase-blog";
import { sansphasePageMetadata } from "@/lib/sansphase-page-metadata";
import { siteBackendOrigin } from "@/lib/site-backend";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ locale: string }> };
type ReadingNote = { title: string; body: string };

const pad = (value: number) => String(value).padStart(2, "0");
const hudIndex = pad(v3NavItems.findIndex(({ key }) => key === "about") + 1) + " / " + pad(v3NavItems.length);

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  return sansphasePageMetadata(locale, sansphaseLinks.about, t("eyebrow"), t("intro"));
}

export default async function AboutPage({ searchParams }: { searchParams: Promise<AboutPublicationSearch> }) {
  await connection();
  const locale = await getLocale();
  const t = await getTranslations("About");
  const origin = siteBackendOrigin();
  const notesIndex = origin ? await getSiteArticleIndex(origin, locale).catch(() => null) : null;
  const publications = origin ? siteAboutPublications(notesIndex ?? [], locale) : demoAboutPublications(locale);
  const recent = publications.slice(0, 4);
  const paragraphs: string[] = t.raw("story.paragraphs");
  const story = origin ? [...paragraphs.slice(0, -1), locale === "en"
    ? "The blog below brings together the articles I’ve published here. Open any article to read the full text."
    : "下面收录了我在这里发布的文章，点击即可阅读全文。"] : paragraphs;
  const notes: ReadingNote[] = t.raw("values.items");
  const inLocale = (value: string) => ({ zh: value, en: value });
  const timeline: EducationEntry[] = recent.map((article) => {
    const [year, month, day] = article.date.split("-");
    const period = year + " — " + month + "." + day;
    return {
      id: article.slug,
      school: inLocale(article.title),
      shortName: article.category,
      field: inLocale(article.description),
      period: inLocale(period),
      classOf: month + "." + day,
      focus: article.tags.map(inLocale),
      logo: article.cover,
      logoFit: "cover",
      hue: 0,
    };
  });

  return (
    <>
      <SpotlightGroup as="header" className="relative isolate overflow-hidden pt-32 pb-12 sm:pt-40 sm:pb-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: "var(--hero-glow)" }} />
        <Aurora className="-z-10" intensity={0.8} />
        <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden data-fx-spot="" className="fx-spot-lit fx-grid-lit pointer-events-none absolute inset-0 -z-10" />
        <div className="container-x relative grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-16">
          <div className="pointer-events-none absolute inset-x-5 -top-10 flex items-center justify-between gap-4 sm:inset-x-8 sm:-top-12 lg:inset-x-12">
            <TerminalPath />
            <span className="fx-terminal tabular-nums">{hudIndex}</span>
          </div>
          <ScrollFade className="lg:col-span-7">
            <SectionHeading
              as="h1"
              className="[&_h1]:lg:text-[3.25rem]"
              eyebrow={t("eyebrow")}
              title={t("title")}
              accent={t("titleAccent")}
              body={t("intro")}
              size="xl"
            />
          </ScrollFade>
          <div className="lg:col-span-5">
            <Portrait alt={SANSPHASE_NAME.zh} caption={SANSPHASE_NAME.zh + " / " + SANSPHASE_NAME.en} clockLabel={t("clock")} />
          </div>
        </div>
      </SpotlightGroup>
      <Story eyebrow={t("story.eyebrow")} paragraphs={story} />

      {timeline.length > 0 && (
        <section className="section-space relative isolate overflow-hidden border-y border-line bg-bg-elevated/35">
          <div aria-hidden className="dot-grid mask-fade-y pointer-events-none absolute inset-0 -z-10 opacity-40" />
          <div className="container-x">
            <SectionHeading
              eyebrow={t("timeline.eyebrow")}
              title={t("timeline.title")}
              accent={t("timeline.titleAccent")}
            />
            <div className="mt-12 md:mt-16">
              <EducationTimeline entries={timeline} locale={locale} classOfLabel="{year}" />
            </div>
          </div>
        </section>
      )}
      <Publications articles={publications} locale={locale} search={origin ? await searchParams : undefined} unavailable={Boolean(origin && !notesIndex)} />

      <section className="container-x section-space">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <Reveal className="lg:col-span-5">
            <SpotlightCard className="flex h-full flex-col gap-6 rounded-2xl bg-fg p-7 text-bg sm:p-8">
              <div aria-hidden className={cn(styles.dots, "pointer-events-none absolute inset-0 rounded-[inherit]")} />
              <BorderBeam duration={10} size={90} />
              <p className="eyebrow relative flex items-center gap-3 text-bg/60">
                <span aria-hidden className="relative flex h-1.5 w-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                {t("now.eyebrow")}
              </p>
              <h3 className="relative font-display text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">{t("now.title")}</h3>
              <FxTrigger as="ul" className="relative flex flex-col divide-y divide-bg/15">
                {recent.map((article, index) => (
                  <li key={article.slug} className="flex gap-4 py-4 text-sm leading-[1.8] text-bg/75 first:pt-0 last:pb-0">
                    <ScrambleText text={pad(index + 1)} delay={index * 0.12} className="pt-0.5 font-mono text-[10px] text-accent" />
                    {origin ? (
                      <Link href={article.href} prefetch={false} className="min-w-0 hover:text-bg hover:underline focus-visible:underline">
                        {article.category && <><strong className="font-medium text-bg">{article.category}</strong>{" · "}</>}
                        {article.title}
                      </Link>
                    ) : (
                      <span><strong className="font-medium text-bg">{article.category}</strong>{" · "}{article.title}</span>
                    )}
                  </li>
                ))}
              </FxTrigger>
              <div className="relative mt-auto pt-4">
                <Magnetic strength={0.3}>
                  <ButtonLink href={sansphaseLinks.contact} arrow>{t("cta")}</ButtonLink>
                </Magnetic>
              </div>
            </SpotlightCard>
          </Reveal>
          <div className="lg:col-span-7">
            <FxTrigger as="p" className="eyebrow mb-5 flex items-center gap-3">
              <span className="fx-line inline-block h-px w-6 bg-accent" />
              <ScrambleText text={t("values.eyebrow")} />
            </FxTrigger>
            <Stagger className="grid gap-x-7 gap-y-6 sm:grid-cols-2">
              {notes.map((note, index) => (
                <StaggerItem key={note.title} className="h-full">
                  <FxTrigger as="article" className="group/value relative flex h-full flex-col gap-3 pt-5">
                    <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-line" />
                    <span aria-hidden className="fx-line absolute top-0 left-0 h-px w-10 bg-accent transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/value:w-full" />
                    <ScrambleText text={pad(index + 1)} delay={0.1 + index * 0.08} className="font-mono text-[10px] text-muted" />
                    <h4 className="font-display text-xl font-semibold tracking-tight transition-colors duration-300 group-hover/value:text-accent">{note.title}</h4>
                    <p className="text-sm leading-[1.8] text-muted">{note.body}</p>
                  </FxTrigger>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </div>
      </section>
    </>
  );
}
