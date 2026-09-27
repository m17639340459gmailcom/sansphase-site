import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("split style sources build one stylesheet in declared cascade order", async () => {
  const entry = await readFile("src/styles.css", "utf8");
  const imports = [...entry.matchAll(/^@import "\.\/(styles-[a-z-]+\.css)";\r?\n/gm)]
    .map((match) => match[1]);
  assert.ok(imports.length >= 2, "the style entry must declare ordered source sections");
  assert.equal(new Set(imports).size, imports.length, "style sections must be unique");
  assert.equal(
    entry.replace(/^@import "\.\/(styles-[a-z-]+\.css)";\r?\n/gm, "").trim(),
    "",
    "the style entry may contain imports only",
  );
  const expected = Buffer.concat(
    await Promise.all(imports.map((file) => readFile(`src/${file}`))),
  );
  assert.deepEqual(
    await readFile("dist/styles.css"),
    expected,
    "the browser must receive the source sections as one unchanged-order stylesheet",
  );
});
