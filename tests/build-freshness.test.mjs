import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifySite } from "../scripts/verify-site.mjs";
import { rewriteStaticHtml } from "../scripts/static-package.mjs";
import { composeSiteStyles } from "../scripts/compose-site-styles.mjs";
import { transform } from 'esbuild';
import { loaderDial } from '../src/loader-dial.mjs';
import { typedBrowserModules } from '../scripts/typed-browser-modules.mjs';

const canonicalFiles = [
  "index.html",
  "app.mjs",
  "admin-route.mjs",
  "catalog.mjs",
  "catalog.css",
  "page-session.js",
  "core.mjs",
  "image-sources.mjs",
  "content-reader.mjs",
  "navigation-prefetch.mjs",
  "home-preload.mjs",
  "route-assets.mjs",
  "route-styles.mjs",
  "scene-delivery.mjs",
  "data.mjs",
  "universe.mjs",
  "universe-scenes.mjs",
  "black-hole-view.mjs",
  "route-transition.mjs",
  "journey.mjs",
  "nav-slider.mjs",
  "loader-dial.mjs",
  "styles.css",
  "blog-background.css",
  "author.css",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("the single generated site stays synchronized with source and has all referenced assets", async () => {
  for (const file of canonicalFiles) {
    let source = file === "styles.css"
      ? await composeSiteStyles()
      : typedBrowserModules.has(file)
        ? (await transform(await readFile(`src/${file.slice(0, -'.mjs'.length)}.ts`, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' })).code
        : await readFile(`src/${file}`);
    if(file==='index.html') {
      // The only HTML build substitution is the shared loading dial;
      // validate the rest of the template byte for byte as before.
      const placeholder='<span class="startup-icon" aria-hidden="true"></span>';
      assert.equal(source.toString().split(placeholder).length,2);
      assert.match(loaderDial,/^<span class="loader-dial" aria-hidden="true">/);
      source=Buffer.from(source.toString().replace(placeholder,loaderDial));
      const delivery=await readFile('dist/static-delivery.json','utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error});
      source=Buffer.from(rewriteStaticHtml(source.toString(),delivery));
    }
    assert.equal(digest(await readFile(`dist/${file}`)), digest(source), `dist/${file} is stale; run pnpm build`);
  }
  for (const [source, output] of [["library-home.css", "home.css"], ["library-cosmos.css", "cosmos.bundle.css"]]) {
    assert.equal(digest(await readFile(`dist/${output}`)), digest(await readFile(`src/${source}`)));
  }
  await verifySite("dist");
});

test('a typed browser module is emitted as runnable JavaScript', async () => {
  const source = await readFile('src/access-policy.ts', 'utf8');
  const output = await readFile('dist/access-policy.mjs', 'utf8');
  assert.ok(source.includes('publicRoute'));
  assert.ok(!output.includes('export * from'));
  const { publicRoute, publicKind } = await import('../dist/access-policy.mjs');
  assert.equal(publicRoute('note'), true);
  assert.equal(publicRoute('resource-center'), false);
  assert.equal(publicKind('notes'), true);
  assert.equal(publicKind('books'), false);
});
