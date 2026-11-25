import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as site from "../src/data/sansphase.ts";

const materials = ["learning-journal", "project-checklist", "source-index"];
const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("V3 navigation opens the local learning directory", async () => {
  assert.equal(site.sansphaseLinks.learning, "/learning");
  assert.match(await source("data/nav.ts"), /key:\s*"learning",\s*href:\s*sansphaseLinks\.learning/);
});

test("the learning directory exposes matching bilingual local downloads", async () => {
  const { materialDownloadHref, sansphaseMaterials } = await import("../src/data/sansphase-materials.ts");
  assert.deepEqual(sansphaseMaterials.map(({ id }) => id).sort(), materials);
  for (const entry of sansphaseMaterials) {
    assert.equal(entry.href, `/materials/${entry.id}.md`);
    assert.equal(entry.detailHref, `/learning/${entry.id}`);
    for (const locale of ["zh", "en"]) {
      assert.ok(entry.title[locale].trim(), `${entry.id}.title.${locale}`);
      assert.ok(entry.summary[locale].trim(), `${entry.id}.summary.${locale}`);
      const href = materialDownloadHref(entry.id, locale);
      const body = await readFile(new URL(`../public${href}`, import.meta.url), "utf8");
      assert.equal(body.split(/\r?\n/, 1)[0], `# ${entry.title[locale]}`);
      assert.ok(body.startsWith("# "));
    }
  }
});

test("the learning route keeps its original template directory, purpose filters, and direct downloads", async () => {
  const [page, directory, detail, card] = await Promise.all([
    source("app/[locale]/(site)/learning/page.tsx"),
    source("components/learning/materials-directory.tsx"),
    source("app/[locale]/(site)/learning/[slug]/page.tsx"),
    source("components/catalog/catalog-card.tsx"),
  ]);
  assert.match(page, /<PageHeader\b[\s\S]*?<MaterialsDirectory\b/);
  assert.match(page, /<NextIntlClientProvider messages=\{\{ Learning \}\}>\s*<MaterialsDirectory\b/);
  assert.doesNotMatch(page, /\bBlogExplorer\b|\bofficialSiteLinks\b/);
  assert.match(directory, /^\s*["']use client["']/m);
  assert.match(directory, /\buseState\b/);
  assert.match(directory, /aria-pressed\s*=/);
  assert.match(directory, /<CatalogCardGrid\b[\s\S]*?<CatalogCard\b/);
  assert.match(directory, /href=\{material\.detailHref\}/);
  assert.match(directory, /download=\{\{ href: materialDownloadHref\(material\.id, locale\)/);
  assert.match(card, /<a\b[^>]*href=\{download\.href\}[^>]*\bdownload(?:\s|=|>)/);
  assert.match(detail, /<a\b[^>]*\bdownload(?:\s|=|>)/);
  for (const locale of ["zh", "en"]) {
    const { Learning } = JSON.parse(await source(`messages/${locale}.json`));
    assert.ok(Learning.filterLabel.trim(), locale);
    assert.deepEqual(Object.keys(Learning.filter).sort(), ["all", ...materials]);
    assert.match(Learning.previewNamed, /\{title\}/);
    assert.match(Learning.downloadNamed, /\{title\}/);
  }
  for (const route of [page, directory, detail]) {
    assert.doesNotMatch(route, /\bsupabase\b|\bfetch\s*\(/i);
  }
});
