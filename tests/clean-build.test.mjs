import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

test("a source-only checkout builds without any existing dist or preview files", async () => {
  const base = resolve(".build");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, "clean-test-"));
  try {
    for (const path of [
      "src",
      "public",
      "scripts",
      "package.json",
      "pnpm-lock.yaml",
    ])
      await cp(path, resolve(directory, path), { recursive: true });
    // Installed dependencies resolve from the workspace ancestor. No generated
    // website files, preview copy, archives or database are available here.
    const { stdout } = await run(process.execPath, ["scripts/build-site.mjs"], {
      cwd: directory,
      timeout: 120000,
    });
    assert.match(stdout, /Clean build verified/);
    const files = await readdir(resolve(directory, "dist"));
    assert.ok(files.includes("index.html"));
    assert.ok(!files.includes("flight.mjs"));
    assert.ok(
      (
        await readFile(
          resolve(directory, "dist/assets/learning-journal.md"),
          "utf8",
        )
      ).length > 0,
    );
  } finally {
    if (!directory.startsWith(base + sep))
      throw new Error("Unsafe clean-build test path");
    await rm(directory, { recursive: true, force: true });
  }
});
