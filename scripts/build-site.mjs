import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rename, rm, lstat, readFile } from "node:fs/promises";
import { createBuildManifest } from './build-manifest.mjs';
import { packageStaticFiles } from './static-package.mjs';
import { validateSceneCdnOrigin } from '../src/scene-delivery.mjs';
import { buildCompactCommunityArt } from './community-compact-art.ts';
import { buildCompactCommunityStaffArt } from './community-staff-compact-art.ts';
import { buildCommunityVipFrameArt } from './community-vip-frame-art.ts';
import { buildAdminConsole } from './build-admin-console.ts';
import { resolve, sep } from "node:path";
import { frontendArgument, verifyFrontendBuild } from './frontend-selection.mjs';
import { frontendV3AppPath } from './frontend-v3-release.mjs';

const run = promisify(execFile);
const workspace = resolve(".");
const frontend = frontendArgument();
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
  await buildAdminConsole(next, frontend === 'v3' ? { redesign: true, v3Integrated: true } : undefined);
  await buildCompactCommunityArt(next);
  await buildCompactCommunityStaffArt(next);
  await buildCommunityVipFrameArt(next);
  if(frontend==='v2')
    await run(process.execPath,['scripts/build-frontend-v2.mjs',resolve(next,'frontend-v2')],{cwd:workspace,windowsHide:true,maxBuffer:4*1024*1024});
  let frontendV3;
  if (frontend === 'v3') {
    const { buildFrontendV3 } = await import('./build-frontend-v3.mjs');
    const receipt = await buildFrontendV3(next, workspace);
    frontendV3 = { appDirectory:resolve(workspace, frontendV3AppPath), buildDirectory:receipt.buildDirectory, buildId:receipt.buildId };
  }
  await packageStaticFiles(next,validateSceneCdnOrigin(process.env.SANSPHASE_SCENE_CDN_ORIGIN),frontendV3);
  const { verifySite } = await import("./verify-site.mjs");
  await verifySite(next);
  const {version}=JSON.parse(await readFile('package.json','utf8'));
  const manifest=await createBuildManifest(next,version);
  await verifyFrontendBuild(next,manifest,frontend,workspace);
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
