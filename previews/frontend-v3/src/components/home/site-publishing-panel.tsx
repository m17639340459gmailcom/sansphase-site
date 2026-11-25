import { BookOpen, Globe } from "lucide-react";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { BorderBeam } from "@/components/fx/border-beam";
import { Odometer } from "@/components/fx/odometer";
import { ScrambleText } from "@/components/fx/scramble-text";
import { SpotlightGroup } from "@/components/fx/spotlight";
import { TextRoll } from "@/components/fx/text-roll";
import { ArrowSwap } from "@/components/home/data/arrow-swap";
import { SectionHeading } from "@/components/ui/section-heading";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
import { ResourcePublicationCalendar } from "@/components/home/resource-publication-calendar";
import { localize, sansphaseLinks } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import { getSitePublishingPreview } from "@/lib/site-publishing";
import type { SitePublishing } from "@/lib/site-publishing-model";
import { formatDate } from "@/lib/utils";

/** Outlined numerals on the inverted card; the stroke is the card's own foreground. */
const watermark =
  "fx-watermark pointer-events-none absolute -bottom-6 -right-2 text-[7.5rem] text-transparent sm:text-[8.5rem]";

export async function SitePublishingPanel({ data, today }: { data?: SitePublishing; today: string }) {
  const [t, cursor, locale] = await Promise.all([
    getTranslations("Home.sitePublishing"),
    getTranslations("FX.common.cursor"),
    getLocale(),
  ]);
  const connected = data !== undefined;
  const { notes, noteTotal, activity } = data ?? getSitePublishingPreview(locale, today);
  const currentYear = today.slice(0, 4);
  const totals = activity?.reduce(
    (counts, day) => ({ resourceCenter: counts.resourceCenter + day.resourceCenter, materials: counts.materials + day.materials }),
    { resourceCenter: 0, materials: 0 },
  );
  const latest = notes[0];

  return (
    <section id="site-publishing" className="container-x section-space">
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <SectionHeading
          eyebrow={t("eyebrow")}
          title={t("title")}
          accent={t("titleAccent")}
          body={t("body")}
        />
      </div>

      <Stagger className="mt-10" stagger={0.09}>
        <SpotlightGroup className="grid min-w-0 gap-5 lg:grid-cols-12">
          {/* Profile */}
          <StaggerItem variant="clip" className="lg:col-span-4">
            <Link
              href={sansphaseLinks.blogIndex}
              data-fx-spot=""
              data-cursor-text={cursor("visit")}
              className="fx-spotlight fx-roll-host group relative flex h-full flex-col justify-between gap-8 overflow-hidden rounded-2xl border border-line bg-fg p-7 text-bg [--fx-spot-size:13rem]"
            >
              <span aria-hidden className="fx-spot-lit fx-grid-lit pointer-events-none absolute inset-0" />
              <span aria-hidden className={`${watermark} [-webkit-text-stroke:1px_color-mix(in_oklab,var(--bg)_16%,transparent)]`}>
                {currentYear}
              </span>
              <span aria-hidden className={`${watermark} fx-spot-lit [-webkit-text-stroke:1px_var(--accent)]`}>
                {currentYear}
              </span>
              <div className="relative flex items-center gap-4">
                <span className="relative flex shrink-0 rounded-2xl transition-[rotate,scale] duration-500 ease-(--fx-ease) motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-105">
                  <Image
                    src="/images/sansphase/author-avatar.webp"
                    alt=""
                    width={64}
                    height={64}
                    unoptimized
                    className="h-16 w-16 rounded-2xl border border-bg/20 object-contain"
                  />
                  <BorderBeam duration={5} size={120} />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="font-display text-lg font-semibold">無相 SANSPHASE</span>
                  {!connected && <span className="font-mono text-xs text-bg/60">{t("preview")}</span>}
                </div>
                <Globe aria-hidden className="ml-auto size-[22px] shrink-0 text-bg/80 transition-[color,rotate] duration-500 ease-(--fx-ease) group-hover:text-accent motion-safe:group-hover:rotate-[360deg]" />
              </div>
              <div className="relative grid grid-cols-3 gap-4">
                {[
                  { v: noteTotal, l: t("notes") },
                  { v: totals?.resourceCenter, l: t("resourceCenter") },
                  { v: totals?.materials, l: t("materials") },
                ].map((s, index) => (
                  <div key={s.l} className="flex flex-col">
                    <span className="font-display text-3xl font-bold tabular-nums">
                      {s.v == null ? "—" : <Odometer value={new Intl.NumberFormat(locale).format(s.v)} delay={0.2 + index * 0.1} />}
                    </span>
                    <span className="text-xs text-bg/60">{s.l}</span>
                  </div>
                ))}
              </div>
              <div className="relative flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-bg/60">
                <span>
                  {latest ? t("lastNote", { date: formatDate(latest.date, locale) }) : t("eyebrow")}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-accent [--fx-roll-to:var(--accent)]">
                  <TextRoll>{t("viewSite")}</TextRoll>
                  <ArrowSwap className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          </StaggerItem>

          {/* Recent journal entries */}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:col-span-8">
            {notes.length ? (
              notes.slice(0, 2).map((note, index) => (
                  <StaggerItem key={note.id} variant="scale" className="min-w-0">
                    <Link
                      href={connected ? new URL(note.href).pathname : note.href}
                      prefetch={connected ? false : undefined}
                      data-fx-spot=""
                      data-cursor-text={cursor("visit")}
                      className="fx-spotlight group relative flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-line bg-bg-elevated/60 p-6 transition-colors duration-300 hover:border-accent/30"
                    >
                      <span
                        aria-hidden
                        className="absolute inset-x-6 top-0 h-px origin-left scale-x-0 bg-linear-to-r from-accent to-amber transition-[scale] duration-700 ease-(--fx-ease) group-hover:scale-x-100 group-focus-visible:scale-x-100"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-baseline gap-2.5">
                          <span aria-hidden className="font-mono text-[10px] text-muted/70 transition-colors duration-300 group-hover:text-accent">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <ScrambleText text={localize(note.title, locale)} trigger="hover" className="block min-w-0 truncate font-mono text-sm font-medium text-fg" />
                        </span>
                        <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                          <time dateTime={note.date}>{formatDate(note.date, locale)}</time>
                          <ArrowSwap className="h-3.5 w-3.5 text-accent" />
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm leading-relaxed text-muted">
                        {localize(note.summary, locale) || t("noDescription")}
                      </p>
                      {note.tags.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5" aria-label={t("details")}>
                          {note.tags.slice(0, 3).map((detail, detailIndex) => (
                            <li
                              key={detail}
                              style={{ transitionDelay: `${detailIndex * 50}ms` }}
                              className="rounded-full border border-line bg-bg px-2 py-1 font-mono text-[10px] text-muted transition-[translate,border-color,color] duration-300 ease-(--fx-ease) group-hover:border-accent/30 group-hover:text-fg motion-safe:group-hover:-translate-y-0.5"
                            >
                              {detail}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-auto flex items-center gap-4 pt-2 font-mono text-xs text-muted">
                        <span className="flex items-center gap-1.5">
                          <BookOpen className="size-3.5 text-accent" aria-hidden />
                          {t("readNote")}
                        </span>
                      </div>
                    </Link>
                  </StaggerItem>
              ))
            ) : (
              <div className="flex items-center justify-center rounded-2xl border border-dashed border-line p-10 text-sm text-muted sm:col-span-2">
                {t(noteTotal === null ? "unavailable" : "noNotes")}
              </div>
            )}
          </div>

          <StaggerItem className="min-w-0 lg:col-span-12">
            <ResourcePublicationCalendar activity={activity} today={today} connected={connected} />
          </StaggerItem>
        </SpotlightGroup>
      </Stagger>
    </section>
  );
}
