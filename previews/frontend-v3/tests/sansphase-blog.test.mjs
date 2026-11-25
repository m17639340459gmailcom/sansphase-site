import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { compileMDX } from "next-mdx-remote/rsc";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import remarkGfm from "remark-gfm";
import sharp from "sharp";
import { articles, readingTopics, sansphaseLinks } from "../src/data/sansphase.ts";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const selectedSlugs = articles.map(({ slug }) => slug);
const localeVariants = ["zh", "en"];

test("the main navigation ends with Community, About and Contact while blog links go to the About section", async () => {
  assert.equal(sansphaseLinks.blog, "/blog");
  assert.equal(sansphaseLinks.blogIndex, "/about#blog");
  const nav = (await source("data/nav.ts")).split("export const v3NavItems")[1];
  assert.deepEqual([...nav.matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]), [
    "home", "work", "learning", "resources", "software", "community", "about", "contact",
  ]);
  assert.match(await source("components/home/hero.tsx"), /href=\{sansphaseLinks\.blogIndex\}/);
  assert.match(await source("components/command/command-palette.tsx"), /key:\s*"blog",\s*href:\s*sansphaseLinks\.blogIndex/);
  for (const article of articles) assert.equal(article.href, `/blog/${article.slug}`);
});

test("lists and details retain internal routes and choose a share card only in connected mode", async () => {
  const list = await source("app/[locale]/(site)/about/page.tsx");
  const legacy = await source("app/[locale]/(site)/blog/page.tsx");
  const detail = await source("app/[locale]/(site)/blog/[slug]/page.tsx");
  const adapter = await source("lib/sansphase-blog.ts");
  const archive = await source("components/about/publications.tsx");
  assert.match(archive, /id="blog"/);
  assert.match(archive, /result\.posts\.map\(/);
  assert.match(archive, /href=\{article\.href\}/);
  assert.doesNotMatch(archive, /ResearchGate|publisherUrl|target="_blank"/);
  assert.match(legacy, /redirect\(localizedPath\(locale, sansphaseLinks\.blogIndex\)\)/);
  assert.match(detail, /href=\{sansphaseLinks\.blogIndex\}/);
  assert.match(detail, /\bgetSansphasePost\b/);
  assert.match(detail, /\bsansphaseBlogSlugs\b/);
  assert.match(detail, /\bnotFound\(\)/);
  assert.match(detail, /allowIndex = integrated && isPublishedSiteOrigin\(siteOrigin\)/);
  assert.match(detail, /<ShareButton[^>]+copiedLabel=[^>]+\/>/);
  assert.match(detail, /const shareUrl = integrated \? `\/share\/blog\/\$\{slug\}` : undefined/);
  assert.match(detail, /<ShareButton[^>]+\burl=\{shareUrl\}/);
  assert.match(detail, /lang=\{post\.locale === "en" \? "en" : "zh-CN"\}/);
  for (const route of [list, detail, adapter]) {
    assert.doesNotMatch(route, /(?:import\s+\{[^}]*\}\s+from\s+["']@\/lib\/blog["']|\bsupabase\b|\bfetch\s*\()/i);
  }
});

test("About keeps the portrait, scroll story, timeline and article effects around the local blog", async () => {
  const page = await source("app/[locale]/(site)/about/page.tsx");
  const proxy = await source("proxy.ts");
  const portrait = await source("components/about/portrait.tsx");
  const zh = JSON.parse(await source("messages/zh.json"));
  assert.equal(zh.About.title + zh.About.titleAccent, "我是無相");
  assert.match(portrait, /src="\/images\/sansphase\/author-portrait\.webp"/);
  assert.match(page, /<Portrait\b[\s\S]*?<Story\b[\s\S]*?<EducationTimeline\b[\s\S]*?<Publications\b/);
  for (const component of ["Aurora", "ScrollFade", "BorderBeam", "Magnetic", "StaggerItem"]) {
    assert.match(page, new RegExp(`<${component}\\b`));
  }
  assert.doesNotMatch(page, /<BlogExplorer\b|<PageHeader\b|\beducation\s*\}/);
  assert.doesNotMatch(proxy, /referencePages = new Set\(\[[^\]]*"about"/);
});

test("the About archive, timeline and recent writing share a collection resolved for the current mode", async () => {
  const page = await source("app/[locale]/(site)/about/page.tsx");
  const archive = await source("components/about/publications.tsx");
  assert.match(page, /getSiteArticleIndex\(origin, locale\)/);
  assert.match(page, /siteAboutPublications\(/);
  assert.match(page, /timeline\b[^=]*=\s*recent\.map\(/);
  assert.match(page, /<EducationTimeline[^>]*entries=\{timeline\}/);
  assert.match(page, /<Publications\s+articles=\{publications\}/);
  assert.doesNotMatch(archive, /from ["']@\/data\/sansphase["']/);
  assert.match(archive, /<Odometer\b/);
  assert.match(archive, /group-hover\/pub:scale-x-100/);
  assert.match(archive, /group-focus-visible\/link:translate-x/);
  assert.deepEqual(readingTopics.flatMap((chapter) => chapter.articles.map(({ slug }) => slug)).sort(), [...selectedSlugs].sort());
});

test("the About archive uses author metadata, supports real filters, and preserves local anchor links", async () => {
  const resolver = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (/^\.\.?\/[\w/-]+$/.test(specifier) && context.parentURL?.includes("/src/lib/")) {
        return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
      }
      if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      return nextResolve(specifier, context);
    },
  });
  try {
    const { aboutPublicationHref, aboutPublicationQuery, queryAboutPublications, relatedAboutPublication, siteAboutPublications } =
      await import("../src/lib/about-publications.ts");
    const { siteArticleMeta } = await import("../src/lib/site-articles.ts");
    const makePost = (id, category, tags, fields = {}) => ({ id, category, tags, title: `友站上线 ${id}`, en: `Site launch ${id}`,
      summary: "流程复盘", summaryEn: "Process review", date: "2026-11-20", ...fields });
    const raw = [
      makePost("full-stack", "部署", ["Web", "部署"]),
      makePost("release-log", "部署", ["日志"], { date: "2026-11-19" }),
      makePost("css-notes", "前端", ["ＣＳＳ"], { date: "2026-11-18", en: undefined }),
      makePost("split-layout", "设计", ["css"], { date: "2026-11-17" }),
    ];
    const notes = siteAboutPublications(raw.map((item) => siteArticleMeta(item, "zh")), "zh");
    assert.deepEqual(notes.map(({ href }) => href), raw.map(({ id }) => `/blog/${id}`));
    assert.equal(notes[0].englishTitle, "Site launch full-stack");
    assert.equal(notes[2].englishTitle, undefined);
    assert.equal(relatedAboutPublication(notes[0], notes)?.slug, "release-log");
    assert.equal(relatedAboutPublication(notes[2], notes)?.slug, "split-layout");
    assert.equal(relatedAboutPublication(notes[2], [notes[2]]), undefined);

    const query = aboutPublicationQuery({ category: "部署", q: "web 复盘", page: "1" });
    assert.deepEqual(queryAboutPublications(notes, query, "zh").posts.map(({ slug }) => slug), ["full-stack"]);
    assert.equal(aboutPublicationHref(query), "/about?category=%E9%83%A8%E7%BD%B2&q=web+%E5%A4%8D%E7%9B%98#blog");
    const byTag = aboutPublicationQuery({ tag: "Css", page: "999" });
    assert.deepEqual(queryAboutPublications(notes, byTag, "zh").posts.map(({ slug }) => slug), ["css-notes", "split-layout"]);
    assert.equal(aboutPublicationHref(byTag), "/about?tag=Css&page=999#blog");
    assert.equal(aboutPublicationHref(aboutPublicationQuery({ category: ["部署", "前端"], page: "-2" })), "/about#blog");
    const en = siteAboutPublications([siteArticleMeta(raw[0], "en")], "en");
    assert.equal(en[0].title, "Site launch full-stack");
    assert.equal(en[0].description, "Process review");
    assert.equal(en[0].englishTitle, undefined);
    assert.equal(queryAboutPublications(notes, aboutPublicationQuery({ q: "SITE LAUNCH" }), "zh").total, 3);
    const more = Array.from({ length: 13 }, (_, index) => ({ ...notes[0], slug: `result-${index + 1}`, date: `2026-11-${String(index + 1).padStart(2, "0")}` }));
    const pageTwo = queryAboutPublications(more, aboutPublicationQuery({ category: "部署", page: "2" }), "zh");
    assert.deepEqual(pageTwo.posts.map(({ slug }) => slug), ["result-1"]);
    assert.deepEqual([pageTwo.start, pageTwo.end, pageTwo.totalPages], [13, 13, 2]);
  } finally {
    resolver.deregister();
  }
});

test("blog search keeps one border when focused", async () => {
  const explorer = await source("components/blog/blog-explorer.tsx");
  const css = await source("app/[locale]/(site)/blog/[slug]/post-fx.css");
  assert.doesNotMatch(explorer, /<Trace\b|\bpfx-trace\b/);
  assert.doesNotMatch(css, /\.pfx-trace\b/);
});

test("both local article collections compile with correctly sized covers and illustrations", async () => {
  assert.equal(selectedSlugs.length, 4);
  for (const article of articles) {
    const asset = await readFile(new URL(`../public${article.cover}`, import.meta.url));
    const { width, height } = await sharp(asset).metadata();
    assert.deepEqual({ width, height }, article.coverSize, article.slug);
  }
  for (const locale of localeVariants) {
    const snapshots = new URL(`../content/sansphase-blog/${locale}/`, import.meta.url);
    const names = (await readdir(snapshots)).filter((name) => name.endsWith(".mdx")).sort();
    assert.deepEqual(names, selectedSlugs.map((slug) => `${slug}.mdx`).sort());
    const { Blog } = JSON.parse(await source(`messages/${locale}.json`));
    assert.ok(Blog.demoAuthor.trim(), locale);

    for (const article of articles) {
      const content = await readFile(new URL(`${article.slug}.mdx`, snapshots), "utf8");
      assert.ok(content.trim().length >= 500, article.slug);
      if (locale === "zh") assert.match(content, /[\u3400-\u9fff]/u, article.slug);
      const illustrations = [];
      const { content: compiled } = await compileMDX({
        source: content,
        options: { mdxOptions: { remarkPlugins: [remarkGfm] } },
        components: {
          BlogImage: (props) => {
            illustrations.push(props);
            return React.createElement("img", props);
          },
        },
      });
      const html = renderToStaticMarkup(compiled);
      assert.ok(illustrations.length > 0, article.slug);
      assert.doesNotMatch(html, /<img\b[^>]*\bsrc="(?:https?:)?\/\//i, article.slug);
      for (const illustration of illustrations) {
        assert.match(illustration.src, /^\/images\/demo-editorial\/[a-z0-9-]+\.webp$/i);
        assert.ok(illustration.alt.trim(), illustration.src);
        const image = await sharp(await readFile(new URL(`../public${illustration.src}`, import.meta.url))).metadata();
        assert.deepEqual({ width: image.width, height: image.height }, {
          width: Number(illustration.width), height: Number(illustration.height),
        }, illustration.src);
      }
    }
  }
});

test("the local adapter returns bilingual metadata and bodies without fetching", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", () => assert.fail("The demo adapter must stay offline"));
  const resolver = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolverRoot = new URL("../src/", import.meta.url);
      if (specifier === "server-only") return nextResolve("data:text/javascript,export%20{}", context);
      if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, resolverRoot).href, context);
      if (context.parentURL?.startsWith(resolverRoot.href) && /^\.\.?\/[\w/-]+$/.test(specifier)) {
        return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const { getSansphasePosts, getSansphasePost, sansphaseBlogSlugs } = await import("../src/lib/sansphase-blog.ts");
    assert.deepEqual([...sansphaseBlogSlugs].sort(), [...selectedSlugs].sort());
    assert.equal(await getSansphasePost("zh", "not-a-demo-article"), null);
    assert.equal(await getSansphasePost("en", "dsh-session-conductor"), null);
    for (const locale of localeVariants) {
      const posts = await getSansphasePosts(locale);
      assert.deepEqual(posts.map(({ slug }) => slug), selectedSlugs);
      for (const [index, article] of articles.entries()) {
        const post = posts[index];
        assert.equal(post.title, article.title[locale], article.slug);
        assert.equal(post.locale, locale, article.slug);
        assert.equal(post.fallback, false, article.slug);
        assert.deepEqual(post.coverSize, article.coverSize, article.slug);
        assert.ok(post.readingMinutes > 0, article.slug);
        assert.ok(!Object.hasOwn(post, "content"), "article body must not be sent with card metadata");
        const detail = await getSansphasePost(locale, article.slug);
        assert.match(detail.content, locale === "zh" ? /虚构演示/ : /Fictional demonstration/i, article.slug);
      }
    }
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    resolver.deregister();
  }
});
