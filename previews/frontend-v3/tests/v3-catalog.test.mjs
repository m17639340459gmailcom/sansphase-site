import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { catalogHref, catalogQuery } from "../src/lib/catalog-navigation.ts";

const files = {
  "./catalog-navigation": "catalog-navigation",
  "./site-articles": "site-articles",
  "./site-publication-date": "site-publication-date",
  "./site-reader-request": "site-reader-request",
};
const frontendModules = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(Object.hasOwn(files, specifier)
      ? new URL(`../src/lib/${files[specifier]}.ts`, import.meta.url).href : specifier, context);
  },
});
const { readSiteCatalog, readSiteCatalogEntry } = await import("../src/lib/site-catalog.ts");
frontendModules.deregister();

const origin = "http://localhost:4315";
const opaqueMediaId = "41fe66a4-ff66-4e22-9cc3-c8ff3a9c44a0";
const cookies = "sansphase_reader_session=isolated; unrelated=discard-me";
const item = {
  id: "stable-item", title: "Actual item", category: "实际分类", tags: ["Tools", "Tools"],
  date: "2026-11-25T18:12:00.000Z",
  coverSrc: `/api/media/${opaqueMediaId}?w=960&view=content`, coverWidth: 1200, coverHeight: 800,
  summary: "Actual summary", bodyHTML: "<p>Authorized body</p>", publishState: "unused",
  attachments: [
    { name: "Authorized download", url: `/api/media/${opaqueMediaId}?download=1` },
    { name: "Wrong route", url: "/api/author/media/0000?download=1" },
    { name: "External", url: "https://example.test/download" },
  ],
};

test("catalog lists preserve actual categories and page numbers without serializing bodies", async () => {
  const query = catalogQuery({ page: "3", category: "实际分类", q: " a+b " });
  assert.equal(catalogHref("works", query), "/projects?category=%E5%AE%9E%E9%99%85%E5%88%86%E7%B1%BB&q=a%2Bb&page=3");
  const catalog = await readSiteCatalog(origin, "works", query, cookies, async (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, "/api/content");
    assert.deepEqual(Object.fromEntries(url.searchParams), { view: "list", kind: "works", page: "3", category: "实际分类", q: "a+b" });
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(new Headers(options.headers).get("cookie"), "sansphase_reader_session=isolated");
    return Response.json({ items: [item], categories: ["实际分类"], total: 25, page: 3, pages: 3 });
  });
  assert.equal(catalog.status, "ok");
  assert.equal(catalog.value.items[0].date, "2026-11-26");
  assert.equal(catalog.value.items[0].cover.src, item.coverSrc);
  assert.equal(catalog.value.items[0].title, item.title);
  assert.deepEqual(catalog.value.categories, ["实际分类"]);
  for (const excluded of ["bodyHTML", "attachments", "publishState"]) assert.equal(excluded in catalog.value.items[0], false);
});

test("catalog honors access, withdrawal and upstream errors without falling back to samples", async () => {
  const query = catalogQuery({ page: ["1", "2"], category: ["x", "y"] });
  for (const [code, status] of [[401, "signin"], [403, "forbidden"], [404, "missing"], [503, "unavailable"]]) {
    const request = async () => new Response(null, { status: code });
    assert.deepEqual(await readSiteCatalog(origin, "resources", query, null, request), { status });
    assert.deepEqual(await readSiteCatalogEntry(origin, "software", item.id, null, request), { status });
  }
  assert.deepEqual(await readSiteCatalog(origin, "software", query, null, async () => { throw new Error("socket closed"); }), { status: "unavailable" });
  assert.deepEqual(await readSiteCatalogEntry(origin, "works", "../secret", null, async () => assert.fail("invalid slug was requested")), { status: "missing" });
  assert.deepEqual(await readSiteCatalogEntry(origin, "works", "different-id", cookies, async () => Response.json({ item })), { status: "unavailable" });
});

test("catalog reads authorized sanitized bodies and uses only access-controlled attachment paths", async () => {
  const catalog = await readSiteCatalogEntry(origin, "resources", item.id, cookies, async (url) => {
    assert.deepEqual(Object.fromEntries(url.searchParams), { view: "detail", kind: "resources", id: item.id });
    return Response.json({ item });
  });
  assert.equal(catalog.status, "ok");
  assert.equal(catalog.value.bodyHTML, item.bodyHTML);
  assert.deepEqual(catalog.value.attachments, [item.attachments[0]]);
  const locked = await readSiteCatalogEntry(origin, "resources", item.id, cookies, async () => Response.json({ item: { ...item, locked: true } }));
  assert.deepEqual(locked, { status: "forbidden" });
});
