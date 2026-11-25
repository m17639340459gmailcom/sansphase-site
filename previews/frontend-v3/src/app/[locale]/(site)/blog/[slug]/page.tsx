import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ViewTransition } from "react";
import { NextPost } from "@/components/blog/next-post";
import { PostCard } from "@/components/blog/post-card";
import { ShareButton } from "@/components/blog/share-button";
import { TableOfContents, TocDisclosure } from "@/components/blog/table-of-contents";
import { ZoomImage } from "@/components/blog/zoom-image";
import { Aurora } from "@/components/fx/aurora";
import { ScrambleText } from "@/components/fx/scramble-text";
import { TextRoll } from "@/components/fx/text-roll";
import { FxTrigger } from "@/components/fx/trigger";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { Tag } from "@/components/ui/tag";
import { localize, sansphaseLinks, SANSPHASE_NAME } from "@/data/sansphase";
import { Link } from "@/i18n/navigation";
import { absoluteUrl, languageAlternates, localizedPath, siteOrigin } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { getSansphasePost, getSansphasePosts, sansphaseBlogSlugs } from "@/lib/sansphase-blog";
import { extractToc, renderMdx } from "@/lib/mdx";
import { isPublishedSiteOrigin, siteBackendOrigin } from "@/lib/site-backend";
import { prepareSiteRichText } from "@/lib/site-rich-text";
import { formatDate, readingTime } from "@/lib/utils";
import "./post-fx.css";

type Props = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  if (siteBackendOrigin()) return [];
  return routing.locales.flatMap((locale) => sansphaseBlogSlugs.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getSansphasePost(locale, slug);
  if (!post) return {};
  const brand = localize(SANSPHASE_NAME, locale);
  const integrated = "bodyHTML" in post;
  const allowIndex = integrated && isPublishedSiteOrigin(siteOrigin);
  const author = integrated ? brand : locale === "en" ? "Demo author" : "演示作者";
  return {
    title: { absolute: `${post.title} · ${brand}` },
    description: post.description,
    applicationName: "SANSPHASE",
    authors: [{ name: author }],
    keywords: post.tags,
    robots: { index: allowIndex, follow: allowIndex },
    alternates: {
      canonical: localizedPath(locale, `/blog/${slug}`),
      languages: languageAlternates(`/blog/${slug}`),
    },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated,
      authors: [author],
      siteName: brand,
      tags: post.tags,
      images: [{ url: post.cover, ...post.coverSize, alt: post.coverAlt ?? post.title }],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: [post.cover] },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const locale = await getLocale();
  const post = await getSansphasePost(locale, slug);
  if (!post) notFound();

  const t = await getTranslations("Blog");
  const tc = await getTranslations("Common");
  const fx = await getTranslations("FX.blog");
  const integrated = "bodyHTML" in post;
  const richText = integrated ? prepareSiteRichText(post.bodyHTML) : null;
  const [content, all] = await Promise.all([
    integrated ? null : renderMdx(post.content),
    getSansphasePosts(locale).catch((error: unknown) => {
      if (integrated) return [];
      throw error;
    }),
  ]);
  const toc = integrated ? richText!.toc : extractToc(post.content);
  const author = integrated ? localize(SANSPHASE_NAME, locale) : t("demoAuthor");
  const shareUrl = integrated ? `/share/blog/${slug}` : undefined;
  // Posts are newest first: "next" continues into the archive and wraps around to the newest.
  const index = all.findIndex((p) => p.slug === post.slug);
  const next = all.length > 1 ? all[(index + 1) % all.length] : undefined;
  const related = all.filter((p) => p.slug !== post.slug && p.slug !== next?.slug).slice(0, 2);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    image: post.cover,
    dateModified: post.updated ?? post.date,
    inLanguage: post.locale === "en" ? "en" : "zh-CN",
    author: { "@type": "Person", name: author },
    keywords: post.tags.join(", "),
    url: absoluteUrl(locale, `/blog/${slug}`),
  };

  return (
    <article className="pb-16 sm:pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }}
      />
      <header className="relative isolate overflow-hidden pt-28 sm:pt-36">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: "var(--hero-glow)" }} />
        <Aurora className="-z-10" intensity={0.55} />
        <div aria-hidden className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-60" />
        <div className="container-x">
          <Reveal>
            <Link
              href={sansphaseLinks.blogIndex}
              className="fx-roll-host group/back inline-flex min-h-11 items-center gap-2 text-sm text-muted transition-colors hover:text-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/back:-translate-x-1" />
              <TextRoll>{tc("backToBlog")}</TextRoll>
            </Link>
          </Reveal>
          <FxTrigger className="mt-8 max-w-4xl">
            <Reveal delay={0.05}>
              <div className="flex flex-wrap items-center gap-2">
                {post.tags.map((tag) => (
                  <Tag key={tag} tone="accent">
                    {tag}
                  </Tag>
                ))}
              </div>
            </Reveal>
            <h1 className="mt-5 max-w-3xl font-display text-3xl font-semibold leading-[1.3] tracking-tight sm:text-4xl lg:text-5xl">
              {post.title}
            </h1>
            <Reveal delay={0.3}>
              <p className="mt-5 max-w-2xl text-base leading-8 text-muted sm:text-lg">
                {post.description}
              </p>
            </Reveal>
            <Reveal delay={0.4}>
              <div className="relative mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 py-4 text-xs text-muted">
                <span aria-hidden className="fx-line absolute inset-x-0 top-0 h-px bg-line-strong [--fx-line-delay:0.35s]" />
                <span aria-hidden className="fx-line absolute inset-x-0 bottom-0 h-px bg-line [--fx-line-delay:0.5s]" />
                <span>
                  {t("writtenBy")} <span className="text-fg">{author}</span>
                </span>
                <span>
                  {tc("published")}{" "}
                  <time dateTime={post.date} className="text-fg">
                    {formatDate(post.date, locale)}
                  </time>
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-1 w-1 rounded-full bg-accent" />
                  {tc("minRead", { minutes: richText ? readingTime(richText.text, post.locale) : post.readingMinutes })}
                </span>
                <div className="ml-auto">
                  <ShareButton label={t("share")} copiedLabel={tc("copied")} url={shareUrl} />
                </div>
              </div>
            </Reveal>
          </FxTrigger>
        </div>
      </header>

      <div className="container-x mt-10 grid gap-10 sm:mt-12 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16">
        <div className="min-w-0 max-w-[46rem]">
          {toc.length > 0 && <TocDisclosure items={toc} label={tc("tableOfContents")} className="mb-10 lg:hidden" />}
          {post.cover && (
            // No entrance of its own: it arrives by morphing from the card that was clicked.
            <ViewTransition name={`post-cover-${post.slug}`} share="morph" default="none">
              <ZoomImage src={post.cover} alt={post.coverAlt ?? ""} className="mb-10 overflow-hidden rounded-xl border border-line">
                <Image
                  src={post.cover}
                  alt={post.coverAlt ?? ""}
                  width={post.coverSize.width}
                  height={post.coverSize.height}
                  unoptimized={integrated}
                  loading="eager"
                  sizes="(max-width: 767px) 100vw, (max-width: 1023px) 90vw, 736px"
                  className="h-auto w-full bg-[#f6f3ed]"
                />
              </ZoomImage>
            </ViewTransition>
          )}
          {richText
            ? <div data-reading-root lang="zh-CN" className="prose-tdx pfx-prose" dangerouslySetInnerHTML={{ __html: richText.html }} />
            : <div data-reading-root lang={post.locale === "en" ? "en" : "zh-CN"} className="prose-tdx pfx-prose">{content}</div>}
          {integrated && post.attachments.length > 0 && (
            <ul className="mt-8 space-y-2 text-sm text-accent">
              {post.attachments.map(({ name, url }) => <li key={url}><a href={url} download className="hover:underline">{name}</a></li>)}
            </ul>
          )}
          <FxTrigger className="mt-14 flex items-center gap-4">
            <span aria-hidden className="fx-line h-px flex-1 bg-line-strong" />
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              <span aria-hidden className="text-accent">∎</span>
              <ScrambleText text={fx("endOfArticle")} />
            </p>
            <span aria-hidden className="fx-line h-px flex-1 origin-right bg-line-strong" />
            <ShareButton label={t("share")} copiedLabel={tc("copied")} url={shareUrl} />
          </FxTrigger>
        </div>
        {toc.length > 0 && (
          <aside className="hidden lg:block">
            <div className="sticky top-28 rounded-2xl border border-line bg-bg-elevated/70 p-5 backdrop-blur-sm">
              <TableOfContents items={toc} label={tc("tableOfContents")} />
            </div>
          </aside>
        )}
      </div>

      {next && (
        <section aria-label={fx("upNext")} className="container-x mt-16 sm:mt-24">
          <Reveal variant="scale">
            <NextPost post={next} locale={locale} minRead={tc("minRead", { minutes: next.readingMinutes })} />
          </Reveal>
        </section>
      )}

      {related.length > 0 && (
        <section className="container-x mt-16 sm:mt-24">
          <FxTrigger as="p" className="eyebrow mb-6 flex items-center gap-3">
            <span aria-hidden className="fx-line inline-block h-px w-6 bg-accent" />
            <ScrambleText text={t("relatedPosts")} />
          </FxTrigger>
          <Stagger className="grid gap-5 md:grid-cols-2">
            {related.map((p) => (
              <StaggerItem key={p.slug} className="h-full">
                <PostCard
                  post={p}
                  locale={locale}
                  minRead={tc("minRead", { minutes: p.readingMinutes })}
                />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      )}
    </article>
  );
}
