import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { build } from "esbuild";

type Mount = (host: HTMLElement, options?: { scene?: "atlas"; onError?: () => void }) => () => void;
interface PreviewWindow extends Window {
  __mountPreview: Mount;
  console: Console;
  eval(code: string): unknown;
  MutationObserver: typeof MutationObserver;
  Event: typeof Event;
  PageTransitionEvent: typeof PageTransitionEvent;
}
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (
    html: string,
    options: { url: string; runScripts: string },
  ) => {
    window: PreviewWindow;
  };
};
const mountNames = ["mountAstral"];
const bundle = await build({
  entryPoints: ["src/community-landing.ts"],
  bundle: true,
  format: "iife",
  write: false,
  plugins: [
    {
      name: "preview-mount-fixture",
      setup(build) {
        build.onResolve({ filter: /^\.\/.+\.ts$/ }, ({ path, importer }) =>
          importer.endsWith("community-landing.ts")
            ? { path, namespace: "mount-stub" }
            : undefined,
        );
        build.onLoad({ filter: /.*/, namespace: "mount-stub" }, () => ({
          contents: mountNames
            .map(
              (name) =>
                `export const ${name} = (host, options) => window.__mountPreview(host, options);`,
            )
            .join("\n"),
          loader: "js",
        }));
      },
    },
  ],
});
const code = bundle.outputFiles[0]!.text;
const fixtureHtml =
  '<main id="main"><section data-community="landing"><h1>無相社区</h1><div class="community-orbits"><i></i></div></section></main>';

function fixture(t: TestContext, mount: Mount, search = "?orbit=astral-constellation", origin = "http://127.0.0.1:4211", html = fixtureHtml) {
  const dom = new JSDOM(html, {
    url: `${origin}/${search}#/community`,
    runScripts: "outside-only",
  });
  const window = dom.window;
  window.__mountPreview = mount;
  window.console.warn = () => {};
  t.after(() => {
    window.dispatchEvent(new window.PageTransitionEvent("pagehide"));
    window.close();
  });
  window.eval(code);
  return { window, document: window.document };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("asynchronous renderer failure restores the original background and retry remounts once", async (t) => {
  const failures: Array<() => void> = [];
  let disposals = 0;
  const { document } = fixture(t, (host, options) => {
    assert.equal(typeof options?.onError, "function");
    failures.push(options!.onError!);
    const canvas = host.ownerDocument.createElement("canvas");
    host.append(canvas);
    return () => { disposals++; canvas.remove(); };
  }, "?scene=atlas");
  assert.equal(document.body.dataset.orbitScene, "atlas");
  failures[0]!();
  await settle();
  assert.equal(disposals, 1);
  assert.equal(document.querySelector("canvas"), null);
  assert.equal(document.body.hasAttribute("data-orbit-experiment"), false);
  assert.equal(document.body.hasAttribute("data-orbit-scene"), false);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
  assert.equal(document.querySelector("h1")!.textContent, "無相社区");
  document.querySelector<HTMLButtonElement>("[data-community-sky-retry]")!.click();
  await settle();
  assert.equal(failures.length, 2);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelectorAll("canvas").length, 1);
  assert.equal(document.body.dataset.orbitScene, "atlas");
  failures[0]!();
  await settle();
  assert.equal(disposals, 1, "a stale callback cannot dispose the new renderer on the same host");
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.body.dataset.orbitScene, "atlas");
});

test("late renderer failure after leaving cannot affect the next landing host", async (t) => {
  const failures: Array<() => void> = [];
  let disposals = 0;
  const { document } = fixture(t, (host, options) => {
    assert.equal(typeof options?.onError, "function");
    failures.push(options!.onError!);
    const canvas = host.ownerDocument.createElement("canvas");
    host.append(canvas);
    return () => { disposals++; canvas.remove(); };
  }, "?scene=atlas");
  const main = document.getElementById("main")!;
  main.replaceChildren();
  await settle();
  assert.equal(disposals, 1);
  failures[0]!();
  assert.equal(document.querySelector('[role="alert"]'), null);
  main.innerHTML = '<section data-community="landing"><h1>無相社区</h1><div class="community-orbits"><i></i></div></section>';
  await settle();
  assert.equal(failures.length, 2);
  failures[0]!();
  await settle();
  assert.equal(disposals, 1);
  assert.equal(document.querySelectorAll("canvas").length, 1);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.body.dataset.orbitScene, "atlas");
});

test("failed mount displays one visible alert with a retry button; repeated failure does not stack", async (t) => {
  let attempts = 0;
  const { document } = fixture(t, (host) => {
    attempts += 1;
    host.append(host.ownerDocument.createElement("canvas"));
    throw new Error("Simulated shader failure");
  });
  assert.equal(attempts, 1);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
  assert.match(
    document.querySelector('[role="alert"]')!.textContent!,
    /星座.*未.*加载/,
  );
  assert.equal(document.querySelector(".community-orbits canvas"), null);
  for (let index = 0; index < 3; index += 1) {
    const retry = document.querySelector<HTMLButtonElement>(
      "[data-community-sky-retry]",
    );
    assert.ok(retry);
    retry.click();
    await settle();
    assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
  }
  assert.equal(attempts, 4);
  assert.equal(document.querySelector("h1")!.textContent, "無相社区");
});

test("retry success removes the failure notice and leaving the route disposes once", async (t) => {
  let attempts = 0;
  let disposals = 0;
  const { document } = fixture(t, (host) => {
    if (++attempts === 1) throw new Error("First attempt fails");
    const canvas = host.ownerDocument.createElement("canvas");
    host.append(canvas);
    return () => {
      disposals += 1;
      canvas.remove();
    };
  });
  document
    .querySelector<HTMLButtonElement>("[data-community-sky-retry]")!
    .click();
  await settle();
  assert.equal(attempts, 2);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.body.dataset.orbitExperiment, "astral");
  document.getElementById("main")!.replaceChildren();
  await settle();
  assert.equal(disposals, 1);
  assert.equal(document.body.hasAttribute("data-orbit-experiment"), false);
});

test("failed-route departure removes the alert; returning mounts a fresh attempt", async (t) => {
  let attempts = 0;
  const { document } = fixture(t, () => {
    attempts += 1;
    throw new Error("Simulated device error");
  });
  const main = document.getElementById("main")!;
  const previous = main.innerHTML;
  main.replaceChildren();
  await settle();
  assert.equal(document.querySelector('[role="alert"]'), null);
  main.innerHTML = previous;
  await settle();
  assert.equal(attempts, 2);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
});

test("pagehide clears a failed renderer and persisted pageshow retries without duplicate alerts", async (t) => {
  let attempts = 0;
  const { window, document } = fixture(t, () => {
    attempts += 1;
    throw new Error("Simulated device error");
  });
  window.dispatchEvent(new window.PageTransitionEvent("pagehide"));
  assert.equal(document.querySelector('[role="alert"]'), null);
  window.dispatchEvent(
    new window.PageTransitionEvent("pageshow", { persisted: true }),
  );
  await settle();
  assert.equal(attempts, 2);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
});

test("no query and retired original preview query both enhance the constellation host", (t) => {
  for (const search of ["", "?orbit=original", "?orbit=obs-veil", "?orbit=astral-instrument&interaction=press"]) {
    let mounts = 0;
    const { document } = fixture(t, () => { mounts++; return () => {}; }, search);
    assert.equal(mounts, 1, search);
    assert.equal(document.body.dataset.orbitExperiment, "astral");
  }
});

test("atlas is the default on the landing and its scoped dataset clears on departure", async (t) => {
  const mounted: Array<"atlas" | undefined> = [];
  let disposals = 0;
  const { document } = fixture(t, (_host, options) => {
    mounted.push(options?.scene); return () => { disposals++; };
  }, "?orbit=original&scene=atlas");
  assert.deepEqual(mounted, ["atlas"]);
  assert.equal(document.body.dataset.orbitScene, "atlas");
  const main = document.getElementById("main")!;
  const landing = main.innerHTML;
  main.replaceChildren(); await settle();
  assert.equal(disposals, 1);
  assert.equal(document.body.hasAttribute("data-orbit-scene"), false);
  main.innerHTML = landing; await settle();
  assert.deepEqual(mounted, ["atlas", "atlas"]);
  assert.equal(document.body.dataset.orbitScene, "atlas");
});

test("retired query parameters and origins cannot select a different scene", (t) => {
  for (const [search, origin] of [["", "http://127.0.0.1:4212"], ["?scene=other", "http://localhost:4212"], ["?scene=atlas", "https://www.sansphase.com"]]) {
    let mounts = 0;
    const { document, window } = fixture(t, (_host, options) => {
      mounts++;
      assert.equal(options?.scene, "atlas"); return () => {};
    }, search, origin);
    window.history.replaceState(null, "", "?orbit=original#/community");
    window.dispatchEvent(new window.Event("popstate"));
    assert.equal(mounts, 1);
    assert.equal(document.body.dataset.orbitScene, "atlas");
  }
  const { document } = fixture(t, () => { assert.fail("no mount outside the landing"); }, "", "http://localhost:4212", '<main id="main"><section data-community="home"></section></main>');
  assert.equal(document.body.hasAttribute("data-orbit-scene"), false);
});
test("atlas failure and page lifecycle remove its dataset and persisted pageshow restores it", (t) => {
  const failed = fixture(t, () => { throw new Error("atlas setup failed"); }, "?scene=atlas");
  assert.equal(failed.document.body.hasAttribute("data-orbit-scene"), false);
  let disposals = 0;
  const view = fixture(t, () => () => { disposals++; }, "?scene=atlas");
  view.window.dispatchEvent(new view.window.PageTransitionEvent("pagehide"));
  assert.equal(view.document.body.hasAttribute("data-orbit-scene"), false);
  assert.equal(disposals, 1);
  view.window.dispatchEvent(new view.window.PageTransitionEvent("pageshow", { persisted: true }));
  assert.equal(view.document.body.dataset.orbitScene, "atlas");
});
