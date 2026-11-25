import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { ConnectedCatalogEntry } from "@/components/catalog/connected-catalog";
import { pad, type GalleryImage } from "@/components/projects/gallery-utils";
import { NextProject } from "@/components/projects/next-project";
import {
  CaseHighlights,
  CaseNotice,
  CaseSection,
  CaseSidebar,
  type CaseLink,
} from "@/components/projects/project-case";
import { ProjectHero } from "@/components/projects/project-hero";
import { ScrollHighlight } from "@/components/projects/scroll-highlight";
import { Reveal } from "@/components/ui/reveal";
import { SANSPHASE_NAME, sansphaseLinks } from "@/data/sansphase";
import { sansphaseWorks } from "@/data/sansphase-works";
import { pick } from "@/data/types";
import { absoluteUrl, languageAlternates, localizedPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { siteBackendOrigin } from "@/lib/site-backend";

type Props = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  if (siteBackendOrigin()) return [];
  return routing.locales.flatMap((locale) => sansphaseWorks.map(({ slug }) => ({ locale, slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (siteBackendOrigin()) return { title: locale === "en" ? "Projects" : "作品", robots: { index: false, follow: false } };
  const project = sansphaseWorks.find((work) => work.slug === slug);
  if (!project) return {};
  const brand = pick(SANSPHASE_NAME, locale);
  const title = `${pick(project.title, locale)} · ${brand}`;
  const description = pick(project.tagline, locale);
  const path = `${sansphaseLinks.work}/${slug}`;
  const canonical = localizedPath(locale, path);
  const images = project.cover && [{ url: project.cover.src, width: project.cover.width, height: project.cover.height }];
  return {
    title: { absolute: title },
    description,
    applicationName: "SANSPHASE",
    keywords: ["SANSPHASE", ...project.stack],
    alternates: {
      canonical,
      languages: languageAlternates(path),
    },
    openGraph: { title, description, type: "website", url: canonical, siteName: brand, images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images },
    robots: { index: false, follow: false },
  };
}

export default async function ProjectPage({ params }: Props) {
  await connection();
  const { slug, locale: pageLocale } = await params;
  const origin = siteBackendOrigin();
  if (origin) return <ConnectedCatalogEntry origin={origin} kind="works" locale={pageLocale} slug={slug} />;
  const index = sansphaseWorks.findIndex((work) => work.slug === slug);
  if (index === -1) notFound();
  const total = sansphaseWorks.length;
  const project = sansphaseWorks[index];
  const next = sansphaseWorks[(index + 1) % total];
  const [locale, t, tc, tf, cursor] = await Promise.all([
    getLocale(),
    getTranslations("Projects"),
    getTranslations("Common"),
    getTranslations("FX.projects"),
    getTranslations("FX.common.cursor"),
  ]);
  const title = pick(project.title, locale);
  const images: GalleryImage[] = [...(project.cover ? [project.cover] : []), ...(project.gallery ?? [])].map(
    (image) => ({
      src: image.src,
      width: image.width,
      height: image.height,
      alt: pick(image.alt, locale),
      caption: pick(image.caption ?? image.alt, locale),
    }),
  );

  const sections = [
    { key: "overview", body: pick(project.description, locale) },
    { key: "problem", body: pick(project.problem, locale) },
    { key: "approach", body: pick(project.approach, locale) },
    { key: "impact", body: pick(project.impact, locale) },
    ...(project.learning
      ? [{ key: "learning" as const, body: pick(project.learning, locale) }]
      : []),
  ] as const;

  const actions: NonNullable<Parameters<typeof ProjectHero>[0]["actions"]> = [];
  if (project.article) {
    actions.push({
      href: `${sansphaseLinks.blog}/${project.article.slug}`,
      label: pick(project.article.label, locale),
      kind: "article",
      cursor: cursor("read"),
    });
  }
  if (project.links.demo) {
    actions.push({ href: project.links.demo, label: t("detail.relatedMaterials"), kind: "demo", cursor: cursor("visit") });
  }
  const links: CaseLink[] = actions.map((action) => ({ ...action, external: false }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: pick(project.title, locale),
    description: pick(project.description, locale),
    dateCreated: project.year,
    keywords: project.stack.join(", "),
    url: absoluteUrl(locale, `${sansphaseLinks.work}/${project.slug}`),
  };

  return (
    <article className="pb-16 sm:pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProjectHero
        project={project}
        title={title}
        tagline={pick(project.tagline, locale)}
        category={t(`filters.${project.category}`)}
        stage={{ label: pick(project.stage.label, locale), tone: project.stage.tone }}
        kind={pick(project.kind, locale)}
        caseLabel={tf("caseIndex", { index: pad(index + 1), total: pad(total) })}
        backLabel={tc("backToProjects")}
        metrics={project.metrics.map((m) => ({ value: m.value, label: pick(m.label, locale) }))}
        images={images}
        note={project.galleryNote && pick(project.galleryNote, locale)}
        cursorLabel={cursor("open")}
        actions={actions}
      />

      <div className="container-x mt-16 grid gap-10 sm:mt-24 lg:grid-cols-12 lg:gap-14">
        <div className="flex min-w-0 flex-col lg:col-span-8">
          {sections.map((s, i) => (
            <CaseSection key={s.key} id={`case-${s.key}`} number={pad(i + 1)} title={t(`detail.${s.key}`)}>
              {i === 0 ? (
                <ScrollHighlight
                  text={s.body}
                  className="font-display text-xl tracking-[-0.01em] text-fg sm:text-[1.65rem] sm:leading-[1.55] leading-[1.6]"
                />
              ) : (
                <Reveal>
                  <p className="text-base leading-8 text-fg/85">{s.body}</p>
                </Reveal>
              )}
            </CaseSection>
          ))}

          <CaseSection id="case-highlights" number={pad(sections.length + 1)} title={t("detail.highlights")}>
            <CaseHighlights items={project.highlights.map((h) => pick(h, locale))} />
          </CaseSection>

          {project.notice && <CaseNotice title={t("detail.notice")} body={pick(project.notice, locale)} />}
        </div>

        <CaseSidebar
          labels={{ role: tc("role"), year: tc("year"), stack: tc("stack"), links: tc("links") }}
          role={pick(project.role, locale)}
          year={project.year}
          stack={project.stack}
          links={links}
        />
      </div>

      {next && next.slug !== project.slug && (
        <NextProject
          slug={next.slug}
          title={pick(next.title, locale)}
          tagline={pick(next.tagline, locale)}
          category={t(`filters.${next.category}`)}
          position={`${next.index} / ${pad(total)}`}
          cover={
            next.cover && {
              src: next.cover.src,
              width: next.cover.width,
              height: next.cover.height,
              alt: pick(next.cover.alt, locale),
            }
          }
          labels={{
            eyebrow: t("detail.nextProject"),
            more: t("detail.more"),
            cta: tc("viewProject"),
            aria: tf("nextLabel", { title: pick(next.title, locale) }),
            cursor: cursor("view"),
          }}
        />
      )}
    </article>
  );
}
