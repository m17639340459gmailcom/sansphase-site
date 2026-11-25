import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the software catalogue has bilingual fictional products with complete setup and limitation details", async () => {
  const { softwareSamples, findSoftwareSample } = await import("../src/data/sansphase-software.ts");
  assert.ok(softwareSamples.length >= 3);
  assert.equal(new Set(softwareSamples.map(({ id }) => id)).size, softwareSamples.length);
  for (const item of softwareSamples) {
    assert.match(item.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.equal(findSoftwareSample(item.id), item);
    for (const field of ["title", "summary", "platforms", "license", "usage", "setup", "limitations"]) {
      assert.ok(item[field].zh.trim() && item[field].en.trim(), `${item.id} ${field}`);
    }
  }
  assert.equal(findSoftwareSample("missing"), undefined);
});

test("software cards, reader recovery and further reading all use local routes", async () => {
  const index = await source("app/[locale]/(site)/software/page.tsx");
  const detail = await source("app/[locale]/(site)/software/[slug]/page.tsx");
  assert.match(index, /\/software\/\$\{item\.id\}/);
  assert.match(detail, /notFound\(\)/);
  assert.match(detail, /href="\/software"/);
  assert.match(detail, /href="\/learning"/);
  assert.doesNotMatch(index + detail, /https?:\/\/|target="_blank"/);
});

test("software is an independently localized primary destination without a duplicate search result", async () => {
  const [resources, software, navigation, palette, zh, en] = await Promise.all([
    source("app/[locale]/(site)/resources/page.tsx"),
    source("app/[locale]/(site)/software/page.tsx"),
    source("data/nav.ts"),
    source("components/command/command-palette.tsx"),
    source("messages/zh.json"),
    source("messages/en.json"),
  ]);
  assert.match(navigation.split("export const v3NavItems")[1], /key: "software", href: sansphaseLinks\.software/);
  assert.match(palette, /v3NavItems\.map\(/);
  assert.doesNotMatch(palette, /key: "software"/);
  assert.doesNotMatch(resources + software, /ResourceNavigation/);
  assert.equal(JSON.parse(zh).Nav.software, "软件推荐");
  assert.equal(JSON.parse(en).Nav.software, "Software");
});
