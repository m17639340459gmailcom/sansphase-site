import type { Metafile } from "esbuild";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

type PackageNotice = {
  name: string;
  version: string;
  license?: unknown;
  repository?: unknown;
};

// Shared by the visitor and standalone admin builds: include only packages in
// the actual browser graph, with their original license/notice files intact.
export async function preserveBrowserPackageNotices(
  metafile: Pick<Metafile, "inputs">,
  destination: string,
  sourceRoot = resolve("."),
) {
  await mkdir(destination, { recursive: true });
  const packages = new Map<string, { directory: string; pkg: PackageNotice }>();
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.replaceAll("\\", "/").includes("node_modules/")) continue;
    let directory = dirname(resolve(sourceRoot, input));
    while (
      basename(directory) !== "node_modules" &&
      dirname(directory) !== directory
    ) {
      try {
        const pkg: unknown = JSON.parse(
          await readFile(resolve(directory, "package.json"), "utf8"),
        );
        if (
          pkg &&
          typeof pkg === "object" &&
          "name" in pkg &&
          typeof pkg.name === "string" &&
          "version" in pkg &&
          typeof pkg.version === "string"
        ) {
          packages.set(`${pkg.name}@${pkg.version}`, {
            directory,
            pkg: {
              name: pkg.name,
              version: pkg.version,
              license: "license" in pkg ? pkg.license : undefined,
              repository: "repository" in pkg ? pkg.repository : undefined,
            },
          });
          break;
        }
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
      directory = dirname(directory);
    }
  }
  const sources = [];
  for (const [id, { directory, pkg }] of packages) {
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(licen[sc]e|copying|notice)(\.|$)/i.test(entry.name),
      )
      .map((entry) => entry.name);
    for (const file of files)
      await copyFile(
        resolve(directory, file),
        resolve(destination, `${id.replaceAll("/", "-")}-${file}`),
      );
    sources.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      repository: pkg.repository,
      notices: files,
    });
  }
  return sources;
}
