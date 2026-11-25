import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "./site-reader-request" ? specifier + ".ts" : specifier, context);
  },
});
const { readSiteContactLinks } = await import("../src/lib/site-contact.ts");
hooks.deregister();

const backend = "http://127.0.0.1:4245";

test("contact uses the anonymous profile bootstrap and exposes only published contact channels", async () => {
  const actual = await readSiteContactLinks(backend, async (url, options) => {
    assert.equal(String(url), `${backend}/api/content?view=bootstrap`);
    assert.equal(options.headers.get("Cookie"), null);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    return Response.json({
      reader: { email: "reader@example.test" },
      profile: { socialLinks: [
        { label: "QQ", url: "https://qm.qq.com.attacker.example/q/no" },
        { label: "QQ", url: "http://qm.qq.com/q/example" },
        { label: "QQ fallback", url: "https://wpa.qq.com/msgrd?v=3" },
        { label: "QQ", url: "https://mp.weixin.qq.com/s/ignore" },
        { label: "Douyin", url: "https://test@v.douyin.com/example/" },
        { label: "Douyin", url: "https://v.douyin.com:8443/ignore/" },
        { label: "Douyin preview", url: "https://v.douyin.com/no\npe/" },
        { label: "Douyin", url: "https://v.douyin.com/example/" },
      ] },
    });
  });
  assert.deepEqual(actual, { qq: "https://qm.qq.com/q/example", douyin: "https://v.douyin.com/example/" });
});

test("contact does not substitute a demo profile when configured data is missing or unavailable", async () => {
  for (const payload of [{ profile: null }, { profile: { socialLinks: [] } }, { profile: { socialLinks: [null, {}, { url: "javascript:alert(1)" }] } }]) {
    assert.deepEqual(await readSiteContactLinks(backend, async () => Response.json(payload)), {});
  }
  assert.equal(await readSiteContactLinks(backend, async () => new Response(null, { status: 503 })), null);
  assert.equal(await readSiteContactLinks(backend, async () => new Response("not JSON")), null);
  assert.equal(await readSiteContactLinks(backend, async () => { throw new Error("offline"); }), null);
});

test("the direct support route explains the current support status in both locales", async () => {
  const page = await readFile(new URL("../src/app/[locale]/(site)/support/page.tsx", import.meta.url), "utf8");
  assert.match(page, /sansphasePageMetadata\(locale, "\/support"/);
  for (const locale of ["zh", "en"]) {
    const { SiteSupport, SiteContact } = JSON.parse(await readFile(new URL(`../src/messages/${locale}.json`, import.meta.url), "utf8"));
    assert.ok(SiteSupport.body.trim());
    assert.ok(SiteSupport.home.trim());
    assert.ok(SiteContact.published.unavailable.trim());
    assert.ok(SiteContact.published.channel.qq.action.trim());
    assert.ok(SiteContact.published.channel.douyin.action.trim());
  }
});
