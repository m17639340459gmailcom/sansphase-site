import test from "node:test";
import assert from "node:assert/strict";
import { publicationFiles } from "../scripts/publication-files.mjs";
import { readFile } from "node:fs/promises";

test("local payment simulations cannot enter the publication source tree or production imports", async () => {
  const files = await publicationFiles();
  assert.ok(files.every((file) => !file.startsWith("previews/")));
  for (const file of files.filter(
    (file) => /^(src|server)\//.test(file) && /\.(?:ts|tsx|mjs|js)$/.test(file),
  )) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /(?:from\s*|import\s*\()['"][^'"]*previews\//,
      file,
    );
    assert.doesNotMatch(
      source,
      /data-outcome=["']|\/demo\/outcome|createDemoOrders/,
      file,
    );
  }
});
