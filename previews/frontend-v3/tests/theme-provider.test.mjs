import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as beijingTheme from "../src/components/providers/beijing-theme.ts";

const require = createRequire(import.meta.url);
const source = await fs.readFile(
  new URL("../src/components/providers/theme-provider.tsx", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020,
  },
});

function providerElement(isServer, followBeijingTime = false) {
  const testModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: testModule,
    exports: testModule.exports,
    require: (id) => id === "./beijing-theme" ? beijingTheme : require(id),
    ...(isServer ? {} : { window: {} }),
  });
  return testModule.exports.ThemeProvider({
    children: createElement("main", null, "Theme content"),
    followBeijingTime,
  });
}

test("server rendering retains the executable before-paint theme bootstrap", () => {
  const html = renderToStaticMarkup(providerElement(true));
  assert.match(html, /<script[^>]*type="text\/javascript"/);
  assert.match(html, /<main>Theme content<\/main>/);
});

test("client renders mark the bootstrap inert while retaining theme and motion providers", () => {
  const element = providerElement(false);
  const html = renderToStaticMarkup(element);
  assert.match(html, /<script[^>]*type="text\/plain"/);
  assert.equal(element.props.attribute, "class");
  assert.equal(element.props.defaultTheme, "system");
  assert.equal(element.props.enableSystem, true);
  assert.equal(element.props.disableTransitionOnChange, true);
  assert.equal(element.props.children.props.reducedMotion, "user");
  assert.match(html, /<main>Theme content<\/main>/);
});

const serverHtml = renderToStaticMarkup(providerElement(true));
const bootstrap = serverHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap, "The initial theme script is missing");

for (const [stored, systemDark, expected] of [
  ["dark", false, "dark"],
  ["light", true, "light"],
  ["system", true, "dark"],
  [null, false, "light"],
]) {
  test(`initial theme uses ${stored ?? "the system default"}, resolving to ${expected}`, () => {
    const classes = new Set(["font-example", "light", "dark"]);
    const style = {};
    vm.runInNewContext(bootstrap, {
      document: {
        documentElement: {
          classList: {
            remove(...values) { values.forEach(value => classes.delete(value)); },
            add(value) { classes.add(value); },
          },
          style,
        },
      },
      localStorage: {
        getItem(key) {
          assert.equal(key, "theme");
          return stored;
        },
      },
      window: {
        matchMedia(query) {
          assert.equal(query, "(prefers-color-scheme: dark)");
          return { matches: systemDark };
        },
      },
    });
    assert.deepEqual([...classes].sort(), ["font-example", expected].sort());
    assert.equal(style.colorScheme, expected);
  });
}

test("unavailable browser storage does not break the initial page", () => {
  assert.doesNotThrow(() => vm.runInNewContext(bootstrap, {
    document: { documentElement: {} },
    localStorage: { getItem() { throw new Error("Storage blocked"); } },
  }));
});

const beijingThemeCases = [
  ["2026-11-24T21:59:59.999Z", "dark"], // 05:59:59 in Beijing
  ["2026-11-24T22:00:00.000Z", "light"],
  ["2026-11-25T11:59:59.999Z", "light"],
  ["2026-11-25T12:00:00.000Z", "dark"],
  ["2026-11-25T16:00:00.000Z", "dark"], // Midnight in Beijing
];

function runBeijingBootstrap(instant, initialStorage = [], storageBlocked = false) {
  const html = renderToStaticMarkup(providerElement(true, true));
  const script = html.match(/<script[^>]*id="sansphase-beijing-theme"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "The scheduled theme must run before the initial paint");
  const storage = new Map(initialStorage);
  const classes = new Set(["font-example", "light", "dark"]);
  const style = {};
  class TestDate extends Date {
    static now() { return Date.parse(instant); }
  }
  vm.runInNewContext(script, {
    Date: TestDate,
    localStorage: {
      getItem(key) {
        if (storageBlocked) throw new Error("Storage blocked");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageBlocked) throw new Error("Storage blocked");
        storage.set(key, value);
      },
    },
    document: {
      documentElement: {
        classList: {
          remove(...values) { values.forEach(value => classes.delete(value)); },
          add(value) { classes.add(value); },
        },
        style,
      },
    },
  });
  assert.deepEqual([...classes].sort(), ["font-example", style.colorScheme].sort());
  return { theme: style.colorScheme, storage, html };
}

test("the V3 first paint follows Beijing time at 06:00, 20:00 and across midnight", () => {
  for (const [instant, expected] of beijingThemeCases) {
    const { theme, storage, html } = runBeijingBootstrap(instant, [["theme", expected === "dark" ? "light" : "dark"]]);
    assert.equal(theme, expected, instant);
    assert.equal(storage.get("sansphase-v3-theme"), expected);
    assert.match(html, /<script[^>]*type="text\/plain"/, "Only the scheduled script should run in public pages");
  }
});

test("manual selection survives refresh within the same period and expires at the next switch", () => {
  const override = JSON.stringify({ theme: "light", until: Date.parse("2026-11-25T22:00:00Z") });
  const stored = [["sansphase-v3-theme-override", override]];
  assert.equal(runBeijingBootstrap("2026-11-25T16:00:00Z", stored).theme, "light");
  assert.equal(runBeijingBootstrap("2026-11-25T22:00:00Z", stored).theme, "light");
  assert.equal(runBeijingBootstrap("2026-11-26T12:00:00Z", stored).theme, "dark");
  const darkByDay = [["sansphase-v3-theme-override", JSON.stringify({ theme: "dark", until: Date.parse("2026-11-25T12:00:00Z") })]];
  assert.equal(runBeijingBootstrap("2026-11-25T11:00:00Z", darkByDay).theme, "dark");
  assert.equal(runBeijingBootstrap("2026-11-25T22:00:00Z", darkByDay).theme, "light");
});

test("scheduled theme still resolves when storage is blocked or contains a malformed choice", () => {
  assert.equal(runBeijingBootstrap("2026-11-25T12:00:00Z", [], true).theme, "dark");
  assert.equal(runBeijingBootstrap("2026-11-25T11:00:00Z", [["sansphase-v3-theme-override", "{"]]).theme, "light");
});
