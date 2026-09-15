import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifySite } from "../scripts/verify-site.mjs";
import { loadingIcon } from '../dist/chapter-icons.mjs';

const canonicalFiles = [
  "index.html",
  "app.mjs",
  "catalog.mjs",
  "catalog.css",
  "page-session.js",
  "core.mjs",
  "image-sources.mjs",
  "home-preload.mjs",
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
    let source = await readFile(`src/${file}`);
    if(file==='index.html') {
      // The only HTML build substitution is the pinned Lucide boot icon;
      // validate the rest of the template byte for byte as before.
      const placeholder='<span class="startup-icon" aria-hidden="true"></span>';
      assert.equal(source.toString().split(placeholder).length,2);
      assert.match(loadingIcon,/^<svg\b/);
      source=Buffer.from(source.toString().replace(placeholder,loadingIcon));
    }
    assert.equal(digest(await readFile(`dist/${file}`)), digest(source), `dist/${file} is stale; run pnpm build`);
  }
  for (const [source, output] of [["library-home.css", "home.css"], ["library-cosmos.css", "cosmos.bundle.css"]]) {
    assert.equal(digest(await readFile(`dist/${output}`)), digest(await readFile(`src/${source}`)));
  }
  await verifySite("dist");
});
