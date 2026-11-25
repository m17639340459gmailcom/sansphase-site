import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the account route inherits language and theme without mounting public site chrome", async () => {
  const localeLayout = await source("app/[locale]/layout.tsx");
  await source("app/[locale]/account/page.tsx");
  assert.match(localeLayout, /<html\b[\s\S]*?lang=\{locale/);
  assert.match(localeLayout, /<ThemeProvider followBeijingTime>/);
  assert.match(localeLayout, /<NextIntlClientProvider\b[^>]*messages=\{null\}/);
  assert.doesNotMatch(localeLayout, /<(?:Navbar|Footer|FooterVisibility|CommandPalette|Cursor|SmoothScroll|ScrollProgress|Preloader)\b/);
});

test("public V3 pages retain their shared chrome and transitions", async () => {
  const siteLayout = await source("app/[locale]/(site)/layout.tsx");
  for (const component of ["Navbar", "Footer", "CommandPalette", "Cursor", "SmoothScroll", "ScrollProgress"]) {
    assert.match(siteLayout, new RegExp(`<${component}\\b`));
  }
  assert.match(siteLayout, /<main\b[^>]*>\{children\}<\/main>/);
  assert.doesNotMatch(siteLayout, /<Preloader\b/);

  const [home, template, catchAll] = await Promise.all([
    source("app/[locale]/(site)/page.tsx"),
    source("app/[locale]/(site)/template.tsx"),
    source("app/[locale]/(site)/[...rest]/page.tsx"),
  ]);
  assert.match(home, /export default\b/);
  assert.match(template, /<PageTransition>\{children\}<\/PageTransition>/);
  assert.match(catchAll, /notFound\(\)/);
});

test("the V3 sitemap uses the primary navigation and excludes legacy template routes", async () => {
  const sitemap = await source("app/sitemap.ts");
  assert.ok(/\bv3NavItems\b/.test(sitemap), "sitemap should follow V3 primary navigation");
  assert.ok(!/\bfdeLessons\b|["']\/(?:skills|learn)(?:["'/])/i.test(sitemap), "sitemap lists legacy routes");
});

test("desktop and mobile expose a localized sign-in utility without prefetching the account page", async () => {
  const [desktop, mobile, pageLink, primary, zh, en] = await Promise.all([
    source("components/layout/navbar.tsx"),
    source("components/layout/mobile-menu.tsx"),
    source("components/layout/nav-page-link.tsx"),
    source("data/nav.ts"),
    source("messages/zh.json"),
    source("messages/en.json"),
  ]);

  for (const label of [JSON.parse(zh).Nav.signIn, JSON.parse(en).Nav.signIn]) {
    assert.ok(typeof label === "string" && label.trim(), "sign-in needs a readable label in each locale");
  }

  assert.doesNotMatch(primary, /["']\/account["']|key:\s*["']signIn["']/);
  assert.match(pageLink, /import\s*{[^}]*\bLink\b[^}]*}\s*from\s*["']@\/i18n\/navigation["']/);
  assert.match(pageLink, /<Link\s+\{\.\.\.props\}/);
  for (const navigation of [desktop, mobile]) {
    assert.match(navigation, /import\s*{[^}]*\bNavPageLink\b[^}]*}\s*from\s*["']\.\/nav-page-link["']/);
    const entry = navigation.match(/<NavPageLink\b[^>]*\bhref="\/account"[^>]*>/s)?.[0] ?? "";
    assert.match(entry, /prefetch=\{false\}/);
    assert.match(entry, /aria-current=/);
  }
  assert.match(desktop, /aria-label=\{t\("signIn"\)\}/);
  assert.match(mobile, /\{t\("signIn"\)\}/);
});

test("localized missing pages offer recovery links from the local V3 navigation", async () => {
  const notFound = await source("app/[locale]/(site)/not-found.tsx");
  assert.ok(/\bv3NavItems\b/.test(notFound), "recovery links should follow V3 primary navigation");
  assert.ok(/from\s+["']@\/i18n\/navigation["']/.test(notFound), "recovery links must preserve the reader's language");
  assert.ok(!/\bhref\s*[:=]\s*["']https?:/i.test(notFound), "recovery should stay in the local preview");
});
