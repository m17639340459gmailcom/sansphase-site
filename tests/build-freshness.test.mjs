import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifySite } from "../scripts/verify-site.mjs";

const canonicalFiles = [
  "index.html",
  "app.mjs",
  "catalog.mjs",
  "catalog.css",
  "page-session.js",
  "core.mjs",
  "data.mjs",
  "universe.mjs",
  "universe-scenes.mjs",
  "styles.css",
  "blog-background.css",
  "author.css",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("the single generated site stays synchronized with source and has all referenced assets", async () => {
  for (const file of canonicalFiles) {
    const source = await readFile(`src/${file}`);
    assert.equal(digest(await readFile(`dist/${file}`)), digest(source), `dist/${file} is stale; run pnpm build`);
  }
  for (const [source, output] of [["library-home.css", "home.css"], ["library-cosmos.css", "cosmos.bundle.css"]]) {
    assert.equal(digest(await readFile(`dist/${output}`)), digest(await readFile(`src/${source}`)));
  }
  await verifySite("dist");
});
