import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { parse } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "next-intl";

const messages = Object.fromEntries(await Promise.all(
  ["zh", "en"].map(async (locale) => [
    locale,
    JSON.parse(await fs.readFile(new URL(`../src/messages/${locale}.json`, import.meta.url), "utf8")),
  ]),
));

function shape(value) {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, shape(child)]));
  }
  return typeof value;
}

function flatten(value, prefix = "") {
  if (typeof value === "string") return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, `${prefix}.${key}`));
}

function argumentsIn(nodes, result = new Set()) {
  for (const node of nodes) {
    if (node.type >= 1 && node.type <= 6) result.add(node.value);
    if (node.options) {
      for (const option of Object.values(node.options)) argumentsIn(option.value, result);
    }
    if (node.children) argumentsIn(node.children, result);
  }
  return [...result].sort();
}

test("Chinese and English messages retain matching keys, types, and array lengths", () => {
  assert.deepEqual(shape(messages.zh), shape(messages.en));
});

test("every localized message is non-empty and valid ICU", () => {
  for (const [locale, catalog] of Object.entries(messages)) {
    for (const [key, value] of flatten(catalog)) {
      assert.ok(value.trim(), `${locale}${key} is empty`);
      assert.doesNotThrow(() => parse(value), `${locale}${key} has invalid ICU syntax`);
    }
  }
});

test("localized message rewrites preserve the same interpolation arguments", () => {
  const english = new Map(flatten(messages.en));
  for (const [key, value] of flatten(messages.zh)) {
    assert.deepEqual(argumentsIn(parse(value)), argumentsIn(parse(english.get(key))), key);
  }
});

// Key parity alone cannot detect a key removed from both catalogs while the UI
// still uses it. Exercise the particle controls' actual translation contract.
for (const [locale, catalog] of Object.entries(messages)) {
  test(`${locale} particle controls resolve their description and every next-shape label`, () => {
    const t = createTranslator({
      locale,
      messages: catalog,
      namespace: "Home.particles",
      onError(error) { throw error; },
    });

    assert.ok(t.has("description"));
    assert.ok(t("description").trim());
    assert.ok(t.has("next"), `${locale} is missing Home.particles.next`);
    assert.deepEqual(argumentsIn(parse(catalog.Home.particles.next)), ["shape"]);

    for (const phase of ["monogram", "database", "network", "lattice"]) {
      assert.ok(t.has(phase), `${locale} is missing Home.particles.${phase}`);
      const shapeName = t(phase);
      const label = t("next", { shape: shapeName });
      assert.ok(shapeName.trim());
      assert.ok(label.includes(shapeName), `${locale}.${phase} label omits the current shape`);
      assert.doesNotMatch(label, /Home\.particles\.|\{shape\}/);
    }
  });
}
