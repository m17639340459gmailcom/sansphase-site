import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as site from "../src/data/sansphase.ts";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const contactPage = "app/[locale]/(site)/contact/page.tsx";

test("the local contact route has two demo channels and an internal way to explore the work", async () => {
  assert.equal(site.sansphaseLinks.contact, "/contact");
  const page = await source(contactPage);
  assert.match(page, /<details\b/);
  assert.match(page, /<summary\b/);
  assert.match(page, /href=\{sansphaseLinks\.work\}/);
  assert.match(await source("data/nav.ts"), /key:\s*"contact",\s*href:\s*sansphaseLinks\.contact/);
});

test("the demo contact channels contain no live profile, form or network submission", async () => {
  const page = await source(contactPage);
  assert.match(page, /\bqq\b/);
  assert.match(page, /\bdouyin\b/);
  assert.doesNotMatch(page, /authorContactLinks|https?:\/\/|ContactForm|CopyEmail|WeChatDialog|wechat-qr|resumeUrlFor|\/resume\/|\/api\/contact|mailto:|site\.email|<form\b|\bfetch\s*\(/i);
});

test("the contact page has dedicated Chinese and English copy", async () => {
  assert.match(await source(contactPage), /["']SiteContact["']/);
  const copies = await Promise.all(["zh", "en"].map(async (locale) => {
    const { SiteContact } = JSON.parse(await source(`messages/${locale}.json`));
    assert.ok(SiteContact?.title?.trim(), `${locale} title`);
    assert.ok(SiteContact?.intro?.trim(), `${locale} intro`);
    assert.ok(SiteContact?.channel?.qq?.example?.trim(), `${locale} QQ example`);
    assert.ok(SiteContact?.channel?.douyin?.example?.trim(), `${locale} video example`);
    return SiteContact;
  }));
  assert.notEqual(copies[0].intro, copies[1].intro);
});

test("the navbar contact button preserves the active locale", async () => {
  const [navbar, pageLink] = await Promise.all([
    source("components/layout/navbar.tsx"),
    source("components/layout/nav-page-link.tsx"),
  ]);
  assert.match(navbar, /<NavPageLink\b[^>]*href\s*=\s*\{sansphaseLinks\.contact\}/);
  assert.match(pageLink, /import\s*{[^}]*\bLink\b[^}]*}\s*from\s*["']@\/i18n\/navigation["']/);
  assert.match(pageLink, /<Link\b[^>]*href=\{href\}/);
  assert.doesNotMatch(navbar, /<a\b[^>]*href\s*=\s*\{sansphaseLinks\.contact\}/);
});
