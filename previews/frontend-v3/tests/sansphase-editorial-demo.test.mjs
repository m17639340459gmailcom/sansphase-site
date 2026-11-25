import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { articles } from "../src/data/sansphase.ts";
import { sansphaseMaterials } from "../src/data/sansphase-materials.ts";

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

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("works have fictional data and local case-study actions", async () => {
  const slugs = new Set(articles.map(({ slug }) => slug));
  for (const work of sansphaseWorks) {
    assert.match(work.stage.label.zh, /演示/);
    assert.match(work.cover.src, /^\/images\/demo-editorial\//);
    if (work.article) assert.ok(slugs.has(work.article.slug));
    for (const href of Object.values(work.links)) {
      assert.match(href, /^\/(?!\/)/);
    }
  }
  const detail = await source("app/[locale]/(site)/projects/[slug]/page.tsx");
  assert.doesNotMatch(detail, /publicBlogUrl|external:\s*true/);
});

test("every local article has synthetic cover art and two original, structured locale bodies", async () => {
  assert.equal(articles.length, 4);
  for (const article of articles) {
    assert.match(article.cover, /^\/images\/demo-editorial\//);
    const zh = await readFile(new URL(`../content/sansphase-blog/zh/${article.slug}.mdx`, import.meta.url), "utf8");
    const en = await readFile(new URL(`../content/sansphase-blog/en/${article.slug}.mdx`, import.meta.url), "utf8");
    assert.match(zh, /虚构演示/);
    assert.match(en, /fictional demonstration/i);
    assert.ok((zh.match(/^## /gm) ?? []).length >= 3);
    assert.ok((en.match(/^## /gm) ?? []).length >= 3);
    assert.notEqual(zh, en);
    assert.doesNotMatch(zh + en, /https?:\/\//);
  }
  const detail = await source("app/[locale]/(site)/blog/[slug]/page.tsx");
  assert.doesNotMatch(detail, /\bsourceHref\b|\boriginalChinese\b/);
});

test("learning records open local article previews with dated and localized downloads", async () => {
  const ids = new Set();
  for (const material of sansphaseMaterials) {
    ids.add(material.id);
    assert.match(material.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(material.detailHref, `/learning/${material.id}`);
    for (const suffix of ["", ".en"]) {
      const raw = await readFile(new URL(`../public/materials/${material.id}${suffix}.md`, import.meta.url), "utf8");
      assert.match(raw, /虚构演示|fictional demonstration/i);
      assert.doesNotMatch(raw, /https?:\/\//);
    }
  }
  assert.equal(ids.size, 3);
  assert.doesNotMatch(await source("app/[locale]/(site)/learning/page.tsx"), /officialSiteLinks/);
  assert.match(await source("app/[locale]/(site)/learning/[slug]/page.tsx"), /\brenderMdx\b/);
});
