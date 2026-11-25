import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { articles, readingTopics, sansphaseLinks } from "../src/data/sansphase.ts";
import { isPublishedSiteOrigin } from "../src/lib/site-backend.ts";

test("homepage selections point to demo articles and have accurate local cover sizes", async () => {
  assert.equal(new Set(articles.map(({ slug }) => slug)).size, articles.length);
  for (const article of articles) {
    assert.equal(article.href, sansphaseLinks.blog + "/" + article.slug);
    const cover = fileURLToPath(new URL("../public" + article.cover, import.meta.url));
    const { width, height, format } = await sharp(cover).metadata();
    assert.equal(format, "webp", article.slug);
    assert.deepEqual({ width, height }, article.coverSize, article.slug);
  }
});

test("home's auxiliary and publishing links stay inside the preview", async () => {
  assert.equal(sansphaseLinks.software, "/software");
  const publishing = readFileSync(new URL("../src/components/home/site-publishing-panel.tsx", import.meta.url), "utf8");
  assert.match(publishing, /href=\{sansphaseLinks\.blogIndex\}/);
  assert.doesNotMatch(publishing, /sansphaseLinks\.home|target="_blank"/);
});

test("the topic breakdown counts every selected article once", () => {
  assert.deepEqual(
    readingTopics.flatMap((topic) => topic.articles.map((article) => article.slug)).sort(),
    articles.map((article) => article.slug).sort(),
  );
});

test("the homepage mounts site publications and the resource calendar below the publishing log", () => {
  const page = readFileSync(new URL("../src/app/[locale]/(site)/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<PublishingPanel\b[^>]*\/>\s*<SitePublishingPanel\b[^>]*\/>/);
  assert.doesNotMatch(page, /GitHubPanel/);
});

test("home panels read one public journal and do not request reader-only collections", () => {
  const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const page = source("app/[locale]/(site)/page.tsx");
  assert.equal([...page.matchAll(/getSiteArticleIndex\(origin, locale\)/g)].length, 1);
  assert.match(page, /await Promise\.all\(\[\s*getSiteArticleIndex\(origin, locale\)[^\n]+,\s*loadSitePublishingData\(/);
  assert.match(page, /robots: \{ index: allowIndex, follow: allowIndex \}/);
  assert.match(page, /"\/share\/cover\.jpg"/);
  assert.doesNotMatch(page, /readSiteCatalog|readSiteContent|getSiteReader/);
  for (const panel of ['featured-projects', 'publishing-panel', 'reading-topics', 'latest-posts', 'what-i-do']) {
    assert.doesNotMatch(source(`components/home/${panel}.tsx`), /readSiteCatalog|readSiteContent|getSiteReader|credentials:\s*["']include/);
  }
});

test("only the canonical HTTPS main-site origin qualifies for public indexing", () => {
  assert.equal(isPublishedSiteOrigin("https://www.sansphase.com"), true);
  for (const origin of ["http://www.sansphase.com", "http://127.0.0.1:4315", "https://community.sansphase.com", "https://www.sansphase.com.invalid", "https://www.sansphase.com/preview", "not a URL"]) {
    assert.equal(isPublishedSiteOrigin(origin), false, origin);
  }
});

test("public homepage topic totals describe the entire catalogue with a bounded breakdown", async () => {
  const resolver = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      return nextResolve(specifier, context);
    },
  });
  try {
    const { summarizeHomeTopics } = await import("../src/lib/home-journal.ts");
    const posts = ["工作流", "工作流", "资料", "设计", "网站", "读书", "写作", undefined].map((category) => ({ category }));
    const stats = summarizeHomeTopics(posts, { other: "其他主题", noCategory: "未分类" });
    assert.deepEqual([stats.total, stats.topicCount], [8, 6]);
    assert.equal(stats.entries.length, 5);
    assert.equal(stats.entries[0].category, "工作流");
    assert.deepEqual(stats.entries.at(-1), { id: "other", name: "其他主题", count: 3 });
    assert.equal(stats.entries.reduce((sum, entry) => sum + entry.count, 0), 8);
    assert.deepEqual(summarizeHomeTopics([{}], { other: "Other", noCategory: "Uncategorized" }).entries, [{ id: "no-category", name: "Uncategorized", count: 1 }]);
  } finally { resolver.deregister(); }
});

test("the author card uses a lightweight square local portrait", async () => {
  const src = "/images/sansphase/author-avatar.webp";
  const component = readFileSync(new URL("../src/components/home/site-publishing-panel.tsx", import.meta.url), "utf8");
  assert.ok(component.includes(`src="${src}"`));

  const image = readFileSync(new URL("../public" + src, import.meta.url));
  const { width, height, format } = await sharp(image).metadata();
  assert.deepEqual({ width, height, format }, { width: 192, height: 192, format: "webp" });
  assert.ok(image.length < 24 * 1024);
});

test("both contact banner themes share one lightweight transparent artwork", async () => {
  const src = "/images/home/sansphase-contact-banner-shared-v1.webp";
  const component = readFileSync(new URL("../src/components/layout/contact-banner.tsx", import.meta.url), "utf8");
  assert.deepEqual([...component.matchAll(/<Image\s+src="([^"]+)"/g)].map(([, path]) => path), [src]);
  assert.match(component, /alt=""\s+fill\s+loading="lazy"/);

  const image = readFileSync(new URL("../public" + src, import.meta.url));
  const { width, height, format, hasAlpha } = await sharp(image).metadata();
  assert.equal(format, "webp");
  assert.ok(width >= 768 && width > height);
  assert.equal(hasAlpha, true);
  const { channels } = await sharp(image).stats();
  assert.equal(channels[3].min, 0);
  assert.equal(channels[3].max, 255);
  assert.ok(image.length <= 140 * 1024);
});
