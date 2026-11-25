import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  publicationCalendar,
  publicationToday,
  publicationYears,
} from "../src/lib/site-publishing-model.ts";

const alias = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier === "./sansphase") return nextResolve(new URL("../src/data/sansphase.ts", import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { loadSitePublishingData, parseResourceActivity, parseSiteNotes } = await import("../src/lib/site-publishing-data.ts");
const { getSitePublishingPreview } = await import("../src/lib/site-publishing.ts");
const { demoBooks } = await import("../src/data/sansphase-library.ts");
const { sansphaseMaterials } = await import("../src/data/sansphase-materials.ts");
const { softwareSamples } = await import("../src/data/sansphase-software.ts");
const { sansphaseWorks } = await import("../src/data/sansphase-works.ts");
alias.deregister();

const siteOrigin = "https://www.sansphase.com";
const today = "2026-11-24";
const day = (date, resourceCenter = 1, materials = 0, works = 0, software = 0) => ({ date, resourceCenter, materials, works, software });

test("the local homepage uses the same preview content without requesting live data", () => {
  const chinese = getSitePublishingPreview("zh", today);
  const english = getSitePublishingPreview("en", today);
  assert.equal(chinese.noteTotal, chinese.notes.length);
  assert.ok(chinese.notes.length >= 2);
  assert.ok(chinese.notes.every((note, index) => index === 0 || note.date <= chinese.notes[index - 1].date));
  assert.deepEqual(chinese.notes.map(({ href }) => href), english.notes.map(({ href }) => href));
  assert.notDeepEqual(chinese.notes[0].tags, english.notes[0].tags);
  assert.deepEqual(chinese.activity, english.activity);
  assert.ok(chinese.activity.length > 0);
  const earlier = getSitePublishingPreview("zh", "2026-10-01");
  assert.ok(earlier.activity.every(({ date }) => date <= "2026-10-01"));
});

test("homepage dates and counts come from the entries shown in the four demo catalogues", () => {
  const books = demoBooks.filter(({ vipOnly }) => !vipOnly);
  const { activity } = getSitePublishingPreview("zh", today);
  const dates = [...new Set([...books, ...sansphaseMaterials, ...softwareSamples, ...sansphaseWorks].map(({ date }) => date))].sort();
  assert.deepEqual(activity, dates.map((date) => ({
    date,
    resourceCenter: books.filter((book) => book.date === date).length,
    materials: sansphaseMaterials.filter((material) => material.date === date).length,
    works: sansphaseWorks.filter((work) => work.date === date).length,
    software: softwareSamples.filter((sample) => sample.date === date).length,
  })));
});

test("the site's publication date changes at midnight in Beijing", () => {
  assert.equal(publicationToday(new Date("2024-02-28T15:59:59.999Z")), "2024-02-28");
  assert.equal(publicationToday(new Date("2024-02-28T16:00:00Z")), "2024-02-29");
  assert.equal(publicationToday(new Date("2025-12-31T16:00:00Z")), "2026-01-01");
});

test("resource activity separates unavailable and empty feeds and validates sparse dates once", () => {
  assert.equal(parseResourceActivity({}, today), null);
  assert.deepEqual(parseResourceActivity({ resourceActivity: { days: [] } }, today), []);
  const worksOnly = day("2026-09-01", 0, 0, 2);
  const softwareOnly = day("2026-10-02", 0, 0, 0, 3);
  assert.deepEqual(parseResourceActivity({ resourceActivity: { days: [day("2026-10-01"), worksOnly, day("2026-12-01"), softwareOnly, day("2026-10-03", 0, 0)] } }, today), [worksOnly, day("2026-10-01"), softwareOnly]);
  for (const days of [[day("2026-02-29")], [day("2026-10-01", -1)], [day("2026-10-01", 1.5)], [day("2026-10-01", Number.MAX_SAFE_INTEGER, 0, 1)], [day("2026-10-01", 0, 0, 0, -1)], [day("2026-10-01"), day("2026-10-01", 0, 1)], [{date:"2026-10-01", resourceCenter:1, materials:0}]]) {
    assert.equal(parseResourceActivity({ resourceActivity: { days } }, today), null);
  }
});

test("rolling publication calendars are week-aligned with stable intensity levels and complete dates", () => {
  const activity = [day("2025-11-22", 50), day("2025-11-23", 0, 0, 1), day("2026-11-23", 1, 0, 0, 2), day("2026-11-24", 4, 1, 1), day("2026-11-25", 50)];
  const calendar = publicationCalendar(activity, today, null);
  assert.equal(calendar.year, null);
  assert.equal(calendar.startDate, "2025-11-23");
  assert.equal(calendar.endDate, today);
  assert.equal(calendar.days.length, 367);
  assert.equal(calendar.total, 10);
  assert.deepEqual(calendar.days[1], { date: "2025-11-24", count: 0, level: 0 });
  assert.deepEqual(calendar.days.filter(({ count }) => count > 0).map(({ level }) => level), [1, 3, 4]);
});

test("calendar years include leap days and retain empty futures without counting them", () => {
  const activity = [day("2024-02-29", 0, 0, 0, 2), day("2026-11-25", 24)];
  assert.deepEqual(publicationYears(activity, today), [2026, 2025, 2024]);
  assert.deepEqual(publicationYears([], today), [2026]);
  const leap = publicationCalendar(activity, today, 2024);
  assert.equal(leap.days.length, 366);
  assert.equal(leap.days[59].count, 2);
  assert.equal(publicationCalendar(activity, today, 2025).days.length, 365);
  const current = publicationCalendar(activity, today, 2026);
  assert.equal(current.total, 0);
  assert.deepEqual(current.days.at(-1), { date: "2026-12-31", count: 0, level: 0 });
});

test("cards use actual public note dates and resolved article links with translation fallback", () => {
  const notes = parseSiteNotes({ totalPublished: 4, items: [
    { id: "first", title: "第一篇", summary: "摘要", date: "2026/10/1 15:06:42", tags: ["知识库", "笔记"] },
    { id: "beijing", title: "北京时间", en: "Beijing time", summary: "摘要", summaryEn: "Summary", date: "2026-10-01T16:30:00Z" },
    { id: "invalid-date", title: "无效日期", date: "2026/2/30" },
    { id: "../not-an-article", title: "无效路径", date: "2026/10/1" },
  ] }, today, { siteOrigin, translations: [{ slug: "first", title: { zh: "旧标题", en: "First post" }, summary: { zh: "过时", en: "Overview" } }] });
  assert.equal(notes.total, 4);
  assert.deepEqual(notes.cards, [
    { id: "beijing", title: { zh: "北京时间", en: "Beijing time" }, summary: { zh: "摘要", en: "Summary" }, tags: [], date: "2026-10-02", href: `${siteOrigin}/blog/beijing` },
    { id: "first", title: { zh: "第一篇", en: "First post" }, summary: { zh: "摘要", en: "Overview" }, tags: ["知识库", "笔记"], date: "2026-10-01", href: `${siteOrigin}/blog/first` },
  ]);
  assert.equal(parseSiteNotes({ items: [], totalPublished: "4" }, today, { siteOrigin }), null);
  assert.deepEqual(parseSiteNotes({ items: [], totalPublished: 0 }, today, { siteOrigin }), { cards: [], total: 0 });
});

test("loader uses public same-site endpoints and keeps independent transport failures visible", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url: String(url), options });
    if (url.searchParams.get("view") === "list") throw new Error("offline");
    return Response.json({ resourceActivity: { days: [day("2026-10-01")] } });
  };
  const options = { siteOrigin, now: new Date("2026-11-24T00:00:00Z"), request };
  const value = await loadSitePublishingData({ ...options, activityPreviewOrigin: "http://127.0.0.1:4251" });
  assert.deepEqual(value, { notes: [], noteTotal: null, activity: [day("2026-10-01")] });
  assert.equal(calls[0].url, `${siteOrigin}/api/content?view=list&kind=notes&public=1&page=1`);
  assert.equal(calls[1].url, "http://127.0.0.1:4251/api/content?view=bootstrap&public=1&activity=resources");
  assert.ok(calls.every(({ options }) => options.credentials === "omit" && options.redirect === "error"));
  await loadSitePublishingData({ ...options, activityPreviewOrigin: "http://127.0.0.1@other.example:9999" });
  assert.equal(calls.at(-1).url, `${siteOrigin}/api/content?view=bootstrap&public=1&activity=resources`);

  const bad = await loadSitePublishingData({ ...options, request: async () => new Response("not JSON") });
  assert.deepEqual(bad, { notes: [], noteTotal: null, activity: null });
});

test("pagination finds the most recent articles even after manual reordering", async () => {
  const requests = [];
  const items = [
    { id: "earlier", title: "早晨", date: "2026/10/4 8:30:00" },
    { id: "old", title: "旧文章", date: "2026-10-01" },
    { id: "latest", title: "晚上", date: "2026-10-04T12:00:00Z" },
  ];
  const request = async (url, init) => {
    if (url.searchParams.get("view") === "bootstrap") return Response.json({ resourceActivity: { days: [] } });
    const page = Number(url.searchParams.get("page"));
    requests.push({ page, signal: init.signal });
    return Response.json({ items: page === 1 ? items.slice(0, 2) : items.slice(2), page, pages: 2, total: 3, totalPublished: 3 });
  };
  const options = { request, siteOrigin, now: new Date("2026-11-24T00:00:00Z") };
  const value = await loadSitePublishingData(options);
  assert.deepEqual(value.notes.map(({ id }) => id), ["latest", "earlier", "old"]);
  assert.equal(value.noteTotal, 3);
  assert.deepEqual(requests.map(({ page }) => page), [1, 2]);
  assert.equal(requests[0].signal, requests[1].signal);

  for (const response of [new Response("offline", { status: 503 }), Response.json({ items: [items[0]], page: 2, pages: 2, total: 3, totalPublished: 3 })]) {
    const partial = await loadSitePublishingData({ ...options, request: async (url, init) => url.searchParams.get("page") === "2" ? response : request(url, init) });
    assert.deepEqual(partial, { notes: [], noteTotal: null, activity: [] });
  }
});
