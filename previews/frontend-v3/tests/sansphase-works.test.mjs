import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import sharp from "sharp";
import { articles, sansphaseLinks } from "../src/data/sansphase.ts";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./sansphase" && context.parentURL?.endsWith("/src/data/sansphase-works.ts")) {
      return nextResolve(new URL("../src/data/sansphase.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { sansphaseWorks } = await import("../src/data/sansphase-works.ts");
resolver.deregister();

test("V3 navigation and homepage work buttons open the local works page", async () => {
  assert.equal(sansphaseLinks.work, "/projects");
  const nav = await source("data/nav.ts");
  assert.match(nav, /key:\s*"work",\s*href:\s*sansphaseLinks\.work/);
  for (const component of ["hero", "what-i-do", "featured-projects"]) {
    assert.match(await source(`components/home/${component}.tsx`), /href=\{sansphaseLinks\.work\}/);
  }
  const routing = await source("i18n/routing.ts");
  assert.match(routing, /defaultLocale:\s*"zh"/);
  assert.match(routing, /localePrefix:\s*"as-needed"/);
});

test("the works list and detail routes use the local catalog without depending on a content API", async () => {
  const [list, detail] = await Promise.all([
    source("app/[locale]/(site)/projects/page.tsx"),
    source("app/[locale]/(site)/projects/[slug]/page.tsx"),
  ]);
  assert.match(list, /<ProjectsGrid\s+projects=\{sansphaseWorks\}/);
  assert.match(detail, /\bsansphaseWorks\b|@\/data\/sansphase-works/);
  assert.match(detail, /\bnotFound\(\)/);
  assert.match(detail, /sansphaseLinks\.blog/);
  for (const route of [list, detail]) {
    assert.doesNotMatch(route, /@\/lib\/projects|supabase|\bfetch\s*\(/);
  }
});

test("each case has a unique route, localized content and valid public destinations", () => {
  const slugs = sansphaseWorks.map(({ slug }) => slug);
  assert.ok(slugs.length >= 2);
  assert.equal(new Set(slugs).size, slugs.length);
  const knownArticles = new Set(articles.map(({ slug }) => slug));
  const summaries = ["title", "tagline", "description", "problem", "approach", "impact"];
  for (const project of sansphaseWorks) {
    assert.match(project.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const field of summaries) {
      assert.ok(project[field].zh.trim(), `${project.slug}.${field}.zh`);
      assert.ok(project[field].en.trim(), `${project.slug}.${field}.en`);
    }
    assert.notEqual(project.description.zh, project.description.en, project.slug);
    if (project.article) assert.ok(knownArticles.has(project.article.slug), project.slug);
    if (project.links.demo) assert.equal(project.links.demo, sansphaseLinks.learning, project.slug);
  }
  assert.ok(sansphaseWorks.some(({ article }) => article), "at least one case links to a source article");
});

test("case categories have localized labels and image assets have their declared sizes", async () => {
  for (const locale of ["zh", "en"]) {
    const { Projects } = JSON.parse(await source(`messages/${locale}.json`));
    assert.ok(Projects.title.trim());
    assert.ok(Projects.detail.overview.trim());
    for (const { category } of sansphaseWorks) assert.ok(Projects.filters[category]?.trim(), `${locale}.${category}`);
  }
  for (const { cover, gallery = [] } of sansphaseWorks) {
    for (const image of cover ? [cover, ...gallery] : gallery) {
      assert.match(image.src, /^\/(?!\/)(?:[\w.-]+\/)*[\w.-]+\.(?:webp|png|jpg|jpeg)$/i);
      const data = await readFile(new URL(`../public${image.src}`, import.meta.url));
      const { width, height } = await sharp(data).metadata();
      assert.deepEqual({ width, height }, { width: image.width, height: image.height }, image.src);
      assert.ok(image.alt.zh.trim() && image.alt.en.trim(), image.src);
    }
  }
});
