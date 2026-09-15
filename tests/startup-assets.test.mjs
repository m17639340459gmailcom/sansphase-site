import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

test("startup build can enable CDN delivery or roll back to same-origin without moving scripts", async () => {
  const paths = ["./assets/scene/panorama.jpg", "./assets/scene/chapter.jpg"];
  for (const origin of ["", "https://static.sansphase.com"]) {
    const result = await build({
      entryPoints: ["src/startup-assets.mjs"], bundle: true, format: "iife", write: false,
      define: {
        __SANSPHASE_SCENE_CDN_ORIGIN__: JSON.stringify(origin),
        __SANSPHASE_SCENE_IMAGES__: JSON.stringify(paths),
      },
    });
    const dom = new JSDOM("", {url: "https://www.sansphase.com/#/home", runScripts: "outside-only"});
    dom.window.eval(result.outputFiles[0].text);
    const links = [...dom.window.document.querySelectorAll("link[as=image]")];
    assert.deepEqual(links.map(link => link.href), paths.map(path =>
      (origin || "https://www.sansphase.com") + path.slice(1)));
    assert.equal(dom.window.document.querySelector("link[rel=modulepreload]").href,
      "https://www.sansphase.com/cosmos.bundle.mjs");
    dom.window.close();
  }
});

test("homepage begins original scene downloads early, while a direct blog visit downloads none", async () => {
  const code = await readFile("dist/startup-assets.js", "utf8");
  for (const hash of ["", "#/home", "#/notes"]) {
    const dom = new JSDOM("", {
      url: "https://www.sansphase.com/" + hash,
      runScripts: "outside-only",
    });
    dom.window.eval(code);
    const images = [...dom.window.document.querySelectorAll("link[as=image]")];
    assert.equal(images.length, hash === "#/notes" ? 0 : 4);
    if (images.length) {
      assert.match(images[0].href, /eso0932a-/);
      assert.equal(new Set(images.map((image) => image.href)).size, 4);
      for (const image of images) {
        assert.equal(image.crossOrigin, "anonymous");
        assert(
          (await stat("dist" + new URL(image.href).pathname)).size > 1_000_000,
        );
      }
      assert(dom.window.document.querySelector("link[rel=modulepreload]"));
    }
    dom.window.close();
  }
});
