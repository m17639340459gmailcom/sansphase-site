import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { JSDOM } from "jsdom";

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
