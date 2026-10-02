import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { communityLandingHTML } from "../src/community.mjs";
import { mountCommunityLanding, arriveCommunity, COMMUNITY_DEPART_MS, COMMUNITY_SWITCH_MS } from "../src/community-landing.mjs";

// A 2D context that accepts every drawing call, so the constellation network can run under jsdom.
const fakeContext = () => new Proxy({}, {
  get: (_, key) => key === "createRadialGradient" || key === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => {},
  set: () => true,
});

function setup({ reduced = false, canWarp = true, canDraw = false } = {}) {
  const dom = new JSDOM(`<body><div id="blog-backdrop"></div><main id="main">${communityLandingHTML((zh) => zh, { message: "" })}</main></body>`, { url: "http://localhost/#/community", pretendToBeVisual: true });
  const win = dom.window;
  win.HTMLCanvasElement.prototype.getContext = canDraw ? fakeContext : () => null;
  win.matchMedia = (query) => ({ matches: reduced && query.includes("reduce") });
  const calls = [], went = [], fetched = [];
  const sky = canWarp ? { warp: (...args) => calls.push(args) } : {};
  const section = win.document.querySelector(".community-landing");
  const backdrop = win.document.querySelector("#blog-backdrop");
  const cleanup = mountCommunityLanding(section, { backdrop, sky: () => sky, go: (href) => went.push(href), prefetch: (href) => fetched.push(href), win });
  const click = (selector, init = {}) => {
    const event = new win.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    win.document.querySelector(selector).dispatchEvent(event);
    return event;
  };
  return { win, doc: win.document, body: win.document.body, section, backdrop, calls, went, fetched, sky, cleanup, click };
}

test("entering the community switches early behind the flight, then the community fades in", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { win, body, doc, section, backdrop, calls, went, fetched, sky, cleanup, click } = setup({ canDraw: true });
  // jsdom's clock does not follow the mocked timers; pin it so the arrival waits for the rest of the flight.
  let now = 0;
  win.performance.now = () => now;
  const event = click(".community-enter");
  assert.equal(event.defaultPrevented, true, "the page waits for the flight");
  assert.ok(body.classList.contains("community-warping") && section.classList.contains("is-warping"));
  assert.deepEqual(calls[0].slice(0, 2), [1, COMMUNITY_DEPART_MS], "the sky speeds up to full warp");
  assert.deepEqual(fetched, ["#/community/home"], "the community starts loading as the flight begins");
  assert.equal(click(".community-enter").defaultPrevented, true, "a second click during the flight does nothing more");
  assert.equal(calls.length, 1);

  t.mock.timers.tick(COMMUNITY_SWITCH_MS);
  now = COMMUNITY_SWITCH_MS;
  assert.deepEqual(went, ["#/community/home"], "the page switches early, while the picture is still nearly still");
  cleanup();
  assert.ok(backdrop.querySelector(".community-network"), "the network flies on over the community page");
  assert.equal(arriveCommunity(doc, sky), true);
  assert.ok(body.classList.contains("community-switched"), "the community page stays hidden until the flight ends");

  t.mock.timers.tick(COMMUNITY_DEPART_MS - COMMUNITY_SWITCH_MS);
  assert.ok(!body.classList.contains("community-warping") && !body.classList.contains("community-switched"));
  assert.ok(body.classList.contains("community-arriving"));
  assert.ok(backdrop.querySelector(".community-network.is-fading"), "the network fades away");
  assert.deepEqual(calls.at(-1)[0], 0, "the warp slows down after arriving");
  t.mock.timers.tick(2000);
  assert.ok(!body.classList.contains("community-arriving"));
  assert.equal(backdrop.querySelector(".community-network"), null, "the network is gone afterwards");
  assert.equal(arriveCommunity(doc, sky), false, "nothing to finish without a flight");
});

test("a board on the landing page flies to that board", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { went, click } = setup();
  click('a[href="#/community/boards/tools"]');
  t.mock.timers.tick(COMMUNITY_SWITCH_MS);
  assert.deepEqual(went, ["#/community/boards/tools"]);
});

test("without a moving sky, with reduced motion or a modified click, links behave as links", () => {
  for (const options of [{ canWarp: false }, { reduced: true }]) {
    const { click, body } = setup(options);
    assert.equal(click(".community-enter").defaultPrevented, false);
    assert.ok(!body.classList.contains("community-warping"));
  }
  const { click } = setup();
  assert.equal(click(".community-enter", { ctrlKey: true }).defaultPrevented, false);
  assert.equal(click(".community-enter", { button: 1 }).defaultPrevented, false);
});

test("leaving the landing page before the switch drops out of warp", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { click, cleanup, body, backdrop, calls, went } = setup({ canDraw: true });
  click(".community-enter");
  cleanup();
  t.mock.timers.tick(COMMUNITY_DEPART_MS);
  assert.deepEqual(went, [], "no switch after leaving");
  assert.ok(!body.classList.contains("community-warping"));
  assert.equal(backdrop.querySelector(".community-network"), null);
  assert.equal(calls.at(-1)[0], 0);
});

test("the constellation network lives in the page backdrop and goes with the landing page", () => {
  const { backdrop, section, cleanup } = setup({ canDraw: true });
  assert.ok(backdrop.querySelector("canvas.community-network[aria-hidden='true']"), "drawn behind the page");
  assert.equal(section.querySelector("canvas"), null);
  cleanup();
  assert.equal(backdrop.querySelector(".community-network"), null, "removed with the landing page");
  const still = setup({ canDraw: false });
  assert.equal(still.backdrop.querySelector(".community-network"), null, "no canvas without a 2D context");
});
