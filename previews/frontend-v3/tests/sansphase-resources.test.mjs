import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { sansphaseLinks } from "../src/data/sansphase.ts";
import * as library from "../src/data/sansphase-library.ts";
import { queryBlogPosts } from "../src/lib/blog-query.ts";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const readerPath = "app/[locale]/(site)/resources/[book]/[[...chapter]]/page.tsx";

test("V3 navigation opens a local book catalogue, including a demo VIP title", async () => {
  assert.equal(sansphaseLinks.resources, "/resources");
  assert.match(await source("data/nav.ts"), /key:\s*"resources",\s*href:\s*sansphaseLinks\.resources/);
  assert.doesNotMatch(await source("app/[locale]/(site)/resources/page.tsx"), /officialSiteLinks|https?:\/\//i);
  const { demoBooks } = library;
  assert.deepEqual(demoBooks.map(({ slug }) => slug), [
    "creative-practice-notebook",
    "ai-production-field-guide",
    "knowledge-system-handbook",
  ]);
  assert.ok(demoBooks.some(({ vipOnly }) => vipOnly));
  assert.equal(new Set(demoBooks.map(({ category }) => category)).size, demoBooks.length);
  for (const book of demoBooks) {
    assert.equal(book.href, `/resources/${book.slug}`);
    assert.match(book.date, /^2026-\d\d-\d\d$/);
    assert.ok(book.tags.length >= 2);
    assert.ok(book.title.zh && book.title.en && book.summary.zh && book.summary.en);
  }
});

test("book routes resolve the right chapter and reject misplaced or unknown chapters", () => {
  const { demoBooks, resolveDemoBook } = library;
  const [first, second] = demoBooks;
  assert.equal(resolveDemoBook(first.slug, [])?.book.href, first.href);
  assert.equal(resolveDemoBook(first.slug, [first.chapters[0].id])?.chapterIndex, 0);
  assert.equal(resolveDemoBook(second.slug, [first.chapters[0].id]), undefined);
  assert.equal(resolveDemoBook(first.slug, [first.chapters[0].id, "extra"]), undefined);
  assert.equal(resolveDemoBook("unknown", []), undefined);
});

test("the resource shelf reuses the blog catalogue with local book links, chapter counts and the VIP marker", async () => {
  const page = await source("app/[locale]/(site)/resources/page.tsx");
  const explorer = await source("components/blog/blog-explorer.tsx");
  assert.match(page, /<PageHeader\b[\s\S]*?id="resource-shelf"[\s\S]*?<BlogExplorer[^>]*kind="resources"/);
  assert.match(page, /href:\s*book\.href/);
  assert.match(page, /detail:\s*t\("chaptersCount",\s*\{ count: book\.chapters\.length \}\)/);
  assert.match(page, /badge:\s*book\.vipOnly\s*\?\s*t\("vipDemo"\)/);
  assert.match(page, /searchTerms:\s*\[/);
  assert.doesNotMatch(page, /LibraryCatalog|\/blog\/\$\{|readingMinutes/);
  assert.match(explorer, /<FeaturedPost\b[\s\S]*?<PostCard\b/);
  for (const file of ["featured-post.tsx", "post-card.tsx"]) {
    assert.match(await source("components/blog/" + file), /post\.badge/);
  }
  for (const book of library.demoBooks) {
    const image = await readFile(new URL(`../public${book.cover.src}`, import.meta.url));
    const { width, height } = await sharp(image).metadata();
    assert.deepEqual([width, height], [book.cover.width, book.cover.height], book.slug);
  }
});

test("the shared catalogue can match bilingual book terms without displaying a second set of tags", () => {
  const entries = library.demoBooks.map((book) => ({
    slug: book.slug,
    date: book.date,
    title: book.title.zh,
    description: book.summary.zh,
    tags: book.tags.map(({ zh }) => zh),
    searchTerms: [book.title.en, ...book.tags.map(({ en }) => en)],
  }));
  assert.deepEqual(queryBlogPosts(entries, { search: "  " }).posts, entries);
  assert.deepEqual(queryBlogPosts(entries, { search: "Shot design" }).posts.map(({ slug }) => slug), ["ai-production-field-guide"]);
  assert.deepEqual(queryBlogPosts(entries, { search: "知识库" }).posts.map(({ slug }) => slug), ["knowledge-system-handbook"]);
  assert.deepEqual(queryBlogPosts(entries, { search: "不存在" }).posts, []);
});

test("each book contains three complete local chapters with distinct bilingual files", async () => {
  const seen = new Set();
  for (const book of library.demoBooks) {
    assert.equal(book.chapters.length, 3);
    for (const chapter of book.chapters) {
      assert.ok(chapter.title.zh && chapter.title.en && chapter.summary.zh && chapter.summary.en);
      for (const locale of ["zh", "en"]) {
        const href = library.demoChapterDownload(book.slug, chapter.id, locale);
        assert.equal(href, `/demo-library/${book.slug}/${chapter.id}.${locale}.md`);
        assert.ok(!seen.has(href));
        seen.add(href);
        const markdown = await readFile(new URL(`../public${href}`, import.meta.url), "utf8");
        assert.ok(markdown.startsWith(`# ${chapter.title[locale]}\n`), href);
        assert.ok((markdown.match(/^## /gm) ?? []).length >= 2, href);
        assert.doesNotMatch(markdown, /https?:\/\//i, href);
      }
    }
  }
  assert.equal(seen.size, 18);
});

test("the reader uses static pages with local Markdown and does not prefetch other chapters", async () => {
  const reader = await source(readerPath);
  const layout = await source("components/resources/resource-book-reader.tsx");
  assert.match(reader, /\bgenerateStaticParams\b/);
  assert.match(reader, /\bnotFound\(\)/);
  assert.match(reader, /\brenderMdx\b/);
  assert.doesNotMatch(reader, /\bsupabase\b|\bfetch\s*\(|https?:\/\//i);
  assert.match(reader, /<ResourceBookReader\b/);
  assert.match(layout, /\bprefetch=\{false\}/);
  assert.match(layout, /\bdownload(?=\s|=|>)/);
});
