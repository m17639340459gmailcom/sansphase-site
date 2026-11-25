import assert from "node:assert/strict";
import test from "node:test";
import {
  adminConsoleHref,
  adminLoginHref,
  adminMainSiteHref,
  adminAuthorPanelHref,
  adminReturnDestination,
  consoleSection,
  readerAdminReturnLocation,
} from "../src/admin-console-navigation.ts";

test("console exits keep the current site and the retained author panel separate", () => {
  assert.equal(adminMainSiteHref(), "/");
  assert.equal(adminAuthorPanelHref(), "/#/account");
  assert.equal(adminAuthorPanelHref(false, "v2"), "/original#/account");
  assert.equal(adminMainSiteHref(true), "/?mainPreview=1#/notes");
  assert.equal(adminMainSiteHref(true, "v3"), "/");
  assert.equal(adminAuthorPanelHref(true), "/?mainPreview=1#/account");
  assert.equal(adminAuthorPanelHref(true, "v2"), "/?mainPreview=1#/account");
  for (const value of [
    undefined,
    "",
    "v1",
    "V2",
    "/original",
    "https://evil.test",
    { mainFrontend: "v2" },
  ])
    assert.equal(adminAuthorPanelHref(false, value), "/#/account");
  const current =
    "https://example.test/admin-console/?adminReturn=memberships&return=https://evil.test#/readers?filter=private";
  for (const preview of [false, true]) {
    for (const href of [
      adminMainSiteHref(preview),
      adminAuthorPanelHref(preview, "v1"),
      adminAuthorPanelHref(preview, "v2"),
    ]) {
      const destination = new URL(href, current);
      assert.equal(destination.origin, new URL(current).origin);
      assert.equal(destination.searchParams.has("adminReturn"), false);
      assert.equal(destination.searchParams.has("return"), false);
      assert.equal(destination.href.includes("private"), false);
    }
  }
});

test("console login return keeps only allowlisted sections and discards private filters", () => {
  assert.equal(
    consoleSection("#/readers?filter=%7B%22q%22%3A%22private%22%7D"),
    "readers",
  );
  assert.equal(
    consoleSection("/profile-reviews?filter=secret"),
    "profile-reviews",
  );
  assert.equal(
    adminLoginHref("#/maintenance?selected=private"),
    "/?adminReturn=maintenance#/account",
  );
  assert.equal(adminLoginHref("#/maintenance?selected=private", "v3"), "/account?adminReturn=maintenance");
  assert.equal(adminLoginHref("#/activity", "v2"), "/?adminReturn=activity#/account");
  assert.equal(adminConsoleHref("memberships"), "/admin-console/#/memberships");
  for (const input of [
    "https://evil.test/",
    "//evil.test/",
    "/readers-evil",
    "/community/manage",
    "/%2F%2Fevil.test",
  ]) {
    assert.equal(consoleSection(input), "readers");
    assert.equal(adminLoginHref(input), "/?adminReturn=readers#/account");
    assert.equal(adminLoginHref(input, "v3"), "/account?adminReturn=readers");
  }
});

test("an ordinary reader from an allowed admin return stays in the original account page and consumes that intent", () => {
  assert.equal(
    readerAdminReturnLocation("?adminReturn=memberships"),
    "/#/account",
  );
  assert.equal(
    readerAdminReturnLocation("?communityTheme=light&adminReturn=activity"),
    "/?communityTheme=light#/account",
  );
  for (const search of [
    "",
    "?adminReturn=",
    "?adminReturn=https://evil.test",
    "?adminReturn=readers&adminReturn=activity",
  ])
    assert.equal(
      readerAdminReturnLocation(search),
      null,
      "normal or invalid entry must preserve the existing login navigation",
    );
});

test("only an authenticated owner may use one exact section return parameter", () => {
  for (const section of [
    "readers",
    "memberships",
    "profile-reviews",
    "maintenance",
    "activity",
  ]) {
    assert.equal(
      adminReturnDestination("?adminReturn=" + section, true),
      "/admin-console/#/" + section,
    );
    assert.equal(
      adminReturnDestination("?adminReturn=" + section, false),
      null,
    );
  }
  for (const search of [
    "",
    "?adminReturn=",
    "?adminReturn=https://evil.test",
    "?adminReturn=%2F%2Fevil.test",
    "?adminReturn=readers%3Fq%3Dsecret",
    "?adminReturn=activity&adminReturn=readers",
  ]) {
    assert.equal(adminReturnDestination(search, true), null);
  }
});
