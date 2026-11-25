import { build, type BuildResult } from "esbuild";
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { buildManagementConsole } from './build-management-console.ts';

// Deliberately separate from the visitor entry points and shared chunks. The
// preview and release share the same packaging and dependency checks.
export async function buildAdminConsole(
  outputRoot: string,
  { preview = false, redesign = false, v3Integrated = false }: { preview?: boolean; redesign?: boolean; v3Integrated?: boolean } = {},
): Promise<BuildResult<{ metafile: true }>> {
  if (v3Integrated && !redesign) throw Error("The V3 integration requires the redesigned console.");
  if (redesign && !preview && !v3Integrated) throw Error("The admin redesign requires a local preview or V3 integration build.");
  return buildManagementConsole('admin-console', outputRoot, preview, redesign, v3Integrated);
}

// Reuse esbuild's actual JS/CSS resolver rather than a second custom import or
// CSS parser. write:false keeps this a read-only check of the emitted files.
export async function verifyAdminConsoleDependencies(
  outputRoot: string,
  entryPoints: string[],
) {
  const base = await realpath(outputRoot);
  const adminRoot = await realpath(resolve(base, "admin-console"));
  if (adminRoot !== resolve(base, "admin-console"))
    throw Error("Unsafe admin-console asset directory.");
  const result = await build({
    absWorkingDir: base,
    entryPoints,
    bundle: true,
    write: false,
    metafile: true,
    treeShaking: false,
    platform: "browser",
    format: "esm",
    logLevel: "silent",
    outdir: resolve(base, ".admin-console-verification"),
    loader: {
      ".woff2": "file",
      ".woff": "file",
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".webp": "file",
      ".svg": "file",
      ".gif": "file",
    },
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input.startsWith("data:")) continue;
    const actual = await realpath(resolve(base, input));
    if (!actual.startsWith(adminRoot + sep))
      throw Error("The admin-console assets must be self-contained: " + input);
  }
  for (const output of Object.values(result.metafile.outputs))
    for (const imported of output.imports)
      if (imported.external && !imported.path.startsWith("data:"))
        throw Error(
          "The admin-console assets must be same-origin: " + imported.path,
        );
}
