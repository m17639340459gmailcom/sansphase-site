import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { buildCommunityConsole } from "../scripts/build-community-console.ts";

test("community console compatibility entry returns to the original UI without another admin framework", async (t) => {
  const base = resolve(".local");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, "community-console-build-"));
  t.after(async () => {
    assert.ok(root.startsWith(base + sep));
    await rm(root, { recursive: true, force: true });
  });
  const release = resolve(root, "release"),
    preview = resolve(root, "preview");
  await mkdir(release);
  await mkdir(preview);
  const result = await buildCommunityConsole(release);
  const js = await readFile(
    resolve(release, "community-console/community-console.js"),
    "utf8",
  );
  const html = await readFile(
    resolve(release, "community-console/index.html"),
    "utf8",
  );
  assert.match(html, /\.\/community-console\.js/);
  assert.doesNotMatch(html, /stylesheet|<style|id="root"/);
  assert.match(html, /href="\/#\/community\/manage"/);
  assert.doesNotMatch(js, /react-admin|@mui\/|React|createRoot/);
  assert.ok(
    Object.keys(result.metafile.inputs).every(
      (input) => !input.replaceAll("\\", "/").includes("node_modules/"),
    ),
  );
  assert.ok(
    Buffer.byteLength(js) < 12_000,
    "Compatibility navigation must remain a small entry, not another UI bundle",
  );
  assert.doesNotMatch(
    js,
    /preview-identity|owner@example\.test|DemoLogin2026|__SANSPHASE_COMMUNITY_CONSOLE_PREVIEW__/,
  );
  assert.doesNotMatch(html, /本地预览/);
  const notices = JSON.parse(
    await readFile(
      resolve(release, "community-console/assets/licenses/sources.json"),
      "utf8",
    ),
  );
  assert.deepEqual(notices, []);
  await assert.rejects(buildCommunityConsole(release), /EEXIST/);
  await buildCommunityConsole(preview, { preview: true });
  assert.equal(
    await readFile(
      resolve(preview, "community-console/community-console.js"),
      "utf8",
    ),
    js,
  );
  assert.match(
    await readFile(resolve(preview, "community-console/index.html"), "utf8"),
    /本地预览/,
  );
});
