import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url));

test("the small Chinese UI face precedes the complete Noto fallback", () => {
  const config = readSource("fonts.ts").toString("utf8");
  const subset = config.match(/const zhUi = localFont\(\{([\s\S]*?)\n\}\);/)?.[1];

  assert.ok(subset);
  assert.match(subset, /src: "\.\/typefaces\/noto-sans-sc-ui\.woff2"/);
  assert.match(subset, /weight: "100 900"/);
  assert.match(subset, /preload: false/);
  assert.match(subset, /adjustFontFallback: false/);
  assert.match(config, /const zh = Noto_Sans_SC\(\{\s*variable: "--font-zh-full"/);
  assert.match(config, /\$\{zhUi\.variable\}/);
  assert.match(config, /\$\{zh\.variable\}/);

  const stack = readSource("font-stack.css").toString("utf8");
  assert.match(stack, /--font-zh: var\(--font-zh-ui\), var\(--font-zh-full\);/);

  const binary = readSource("typefaces/noto-sans-sc-ui.woff2");
  assert.equal(binary.toString("ascii", 0, 4), "wOF2");
  assert.equal(binary.readUInt32BE(8), binary.length);
  assert.ok(binary.length < 140 * 1024, `UI font is ${binary.length} bytes`);
});

test("decorative Latin fonts keep their faces without eager preloads on every page", () => {
  const config = readSource("fonts.ts").toString("utf8");
  for (const [name, font] of [
    ["display", "Bricolage_Grotesque"],
    ["serif", "Instrument_Serif"],
    ["mono", "IBM_Plex_Mono"],
  ]) {
    const settings = config.match(new RegExp("const " + name + " = " + font + "\\(\\{([\\s\\S]*?)\\n\\}\\);"))?.[1];
    assert.ok(settings, font);
    assert.match(settings, /preload: false/, font);
    assert.match(settings, /display: "swap"/, font);
    assert.ok(config.includes("$" + "{" + name + ".variable}"), font);
  }
});
