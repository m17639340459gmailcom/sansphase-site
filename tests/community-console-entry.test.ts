import assert from "node:assert/strict";
import test from "node:test";
import { communityPageTabs, manageHref } from "../src/community-routing.ts";
import { communityConsoleDestination } from "../src/community-console/entry.ts";

test("community console bookmarks use the existing management route contract", () => {
  for (const tab of communityPageTabs.manage) {
    assert.equal(
      communityConsoleDestination(`#/${tab}`, ""),
      "/" + manageHref(tab),
    );
    assert.equal(
      communityConsoleDestination(`#/community/manage/${tab}`, ""),
      "/" + manageHref(tab),
    );
  }
  assert.equal(
    communityConsoleDestination("#/community", ""),
    "/#/community/home",
  );
  assert.equal(
    communityConsoleDestination("#/original-management", ""),
    "/" + manageHref("queue"),
  );
  assert.equal(communityConsoleDestination("", ""), "/" + manageHref("queue"));
});

test("only the established language values and explicit community theme values survive the redirect", () => {
  assert.equal(
    communityConsoleDestination(
      "#/reports?filter=private-note",
      "?communityTheme=dark&lang=en&filter=private-uid&returnUrl=https://evil.test",
    ),
    "/?communityTheme=dark&lang=en#/community/manage/reports",
  );
  assert.equal(
    communityConsoleDestination("#/content", "?lang=zh&communityTheme=light"),
    "/?communityTheme=light&lang=zh#/community/manage/content",
  );
  assert.equal(
    communityConsoleDestination(
      "#/queue",
      "?communityTheme=dark&communityTheme=light&lang=en&lang=zh",
    ),
    "/" + manageHref("queue"),
  );
  assert.equal(
    communityConsoleDestination(
      "#/queue",
      "?communityTheme=night&lang=zh-CN&theme=dark&next=//evil.test",
    ),
    "/" + manageHref("queue"),
  );
});

test("untrusted fragments cannot create an external destination or retain private detail paths", () => {
  for (const fragment of [
    "#//evil.test",
    "#https://evil.test",
    "#/content/private-user",
    "#/queue/../reports",
    "#/%2f%2fevil.test",
    "#/orders%3freturnUrl=https://evil.test",
    "#/reports\\evil",
    "#/%E0%A4%A",
    "#/login",
    "#/not-a-tab",
  ]) {
    const destination = communityConsoleDestination(
      fragment,
      "?returnUrl=javascript:alert(1)&q=private-name",
    );
    assert.equal(destination, "/" + manageHref("queue"));
    assert.equal(
      new URL(destination, "https://community.example.test").origin,
      "https://community.example.test",
    );
  }
});
