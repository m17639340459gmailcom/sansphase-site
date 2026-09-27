import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rename, rm, lstat, readFile } from "node:fs/promises";
import { createBuildManifest } from './build-manifest.mjs';
import { packageStaticFiles } from './static-package.mjs';
import { validateSceneCdnOrigin } from '../src/scene-delivery.mjs';
import { resolve, sep } from "node:path";

const run = promisify(execFile);
const workspace = resolve(".");
const buildRoot = resolve(".build");
const target = resolve("dist");
for (const path of [buildRoot, target]) {
  if (!path.startsWith(workspace + sep))
    throw new Error("Build paths must stay in the workspace");
  const stat = await lstat(path).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  if (stat?.isSymbolicLink())
    throw new Error(`Refusing symlink build path: ${path}`);
}
await mkdir(buildRoot, { recursive: true });
const job = await mkdtemp(resolve(buildRoot, "site-"));
const next = resolve(job, "next");
const previous = resolve(job, "previous");
let preserveJob = false;
try {
  // Every build starts empty. A failed compilation leaves the running site intact.
  await run(process.execPath, ["scripts/build-cosmos.mjs", next]);
  await packageStaticFiles(next,validateSceneCdnOrigin(process.env.SANSPHASE_SCENE_CDN_ORIGIN));
  const { verifySite } = await import("./verify-site.mjs");
  await verifySite(next);
  const {version}=JSON.parse(await readFile('package.json','utf8'));
  await createBuildManifest(next,version);
  let hadPrevious = false;
  try {
    await rename(target, previous);
    hadPrevious = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    await rename(next, target);
  } catch (e) {
    if (hadPrevious) {
      try {
        await rename(previous, target);
      } catch (restoreError) {
        preserveJob = true;
        throw new AggregateError(
          [e, restoreError],
          `Build swap failed; recover the previous build from ${previous}`,
        );
      }
    }
    throw e;
  }
  console.log(
    "Clean build verified and published to dist/. Preview reads this one output.",
  );
} finally {
  if (!job.startsWith(buildRoot + sep))
    throw new Error("Unsafe temporary build path");
  if (!preserveJob) await rm(job, { recursive: true, force: true });
}
