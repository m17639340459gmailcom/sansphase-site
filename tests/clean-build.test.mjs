import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { publicationFiles } from "../scripts/publication-files.mjs";
import { adminConsoleRequiredFiles } from "../server/admin-console-assets.ts";
const run = promisify(execFile);

test("the prepared publication source builds without existing dist, private settings or preview files", async () => {
  const base = resolve(".build");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, "clean-test-"));
  try {
    const sources = await publicationFiles();
    for (const path of sources) {
      const destination = resolve(directory, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(path, destination);
    }
    // Use the actual release preparation entry in a source-only workspace. Its
    // private-settings checks cannot read the real workspace's .local files.
    const prepared = await run(process.execPath, ["scripts/prepare-publication.mjs"], {
      cwd: directory,
      env: {...process.env,SITE_FRONTEND:'v1'},
      timeout: 120000,
    });
    const publication = JSON.parse(prepared.stdout);
    assert.equal(publication.status, "prepared-not-published");
    assert.equal(publication.privateValueMatches, 0);
    assert.equal(publication.files, sources.length);
    assert.ok(publication.directory.startsWith(resolve(directory, ".local/publication") + sep));
    const manifest = JSON.parse(await readFile(resolve(directory, ".local/publication/latest.json"), "utf8"));
    assert.deepEqual(manifest.files.map(entry => entry.file).sort(), sources);
    for (const path of ["src/community-frame-banners.ts", "server/community-banners.ts", "server/payload/community-migration.ts", "docs/COMMUNITY-BANNERS.md"])
      assert.ok(manifest.files.some(entry => entry.file === path));
    // Installed dependencies resolve from the workspace ancestor. No generated
    // website files, preview copy, archives or database are available here.
    const { stdout } = await run(process.execPath, ["scripts/build-site.mjs"], {
      cwd: publication.directory,
      env: {...process.env,SITE_FRONTEND:'v1'},
      timeout: 120000,
    });
    assert.match(stdout, /Clean build verified/);
    const files = await readdir(resolve(publication.directory, "dist"));
    assert.ok(files.includes("index.html"));
    assert.ok(!files.includes("flight.mjs"));
    const build = JSON.parse(await readFile(resolve(publication.directory, "dist/build-info.json"), "utf8"));
    for (const asset of adminConsoleRequiredFiles) {
      assert.ok(build.files.some(entry => entry.path === asset), `the clean release is missing ${asset}`);
      assert.ok((await readFile(resolve(publication.directory, "dist", asset))).length > 0);
    }
    assert.ok(
      (
        await readFile(
          resolve(publication.directory, "dist/assets/learning-journal.md"),
          "utf8",
        )
      ).length > 0,
    );
    // The default source package must also run its delivery regressions without
    // optional preview files being present elsewhere in this temporary tree.
    await run(process.execPath,["--test","tests/frontend-release.test.mjs","tests/frontend-v2.test.ts","tests/typescript-project-boundary.test.mjs","tests/publication-files.test.mjs"],{
      cwd:publication.directory,env:{...process.env,SITE_FRONTEND:'v1'},timeout:120000,maxBuffer:4*1024*1024,
    });
  } finally {
    if (!directory.startsWith(base + sep))
      throw new Error("Unsafe clean-build test path");
    await rm(directory, { recursive: true, force: true });
  }
});
