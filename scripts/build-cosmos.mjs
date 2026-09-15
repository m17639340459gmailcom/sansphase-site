import { build } from "esbuild";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
  realpath,
  unlink,
  cp,
} from "node:fs/promises";
import { dirname, resolve, basename, relative, isAbsolute } from "node:path";
import { JSDOM } from "jsdom";
import { createElement, ArrowRight, LoaderCircle } from "lucide";

const outdir = process.argv[2] || "dist";
const outputRelative = relative(resolve("."), resolve(outdir));
if (
  !outputRelative ||
  outputRelative.startsWith("..") ||
  isAbsolute(outputRelative)
)
  throw new Error("Build output must remain inside this workspace");
await mkdir(outdir, { recursive: true });
await cp("public", outdir, { recursive: true });
const result = await build({
  entryPoints: {
    "cosmos.bundle": "src/library-cosmos.jsx",
    "ui.bundle": "src/library-ui.jsx",
    "blog-galaxy": "src/blog-galaxy.jsx",
    "author.bundle": "src/author-entry.mjs",
    "music.bundle": "src/music-player.mjs",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  jsx: "automatic",
  loader: { ".glsl": "text", ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
  metafile: true,
  legalComments: "eof",
  outdir,
});
// Site pages and their styles have one source of truth under src/. The build
// output is disposable; it is never edited by hand.
for (const file of [
  "index.html",
  "app.mjs",
  "visitor-controls.css",
  "visitor-location.mjs",
  "catalog.mjs",
  "catalog.css",
  "page-session.js",
  "core.mjs",
  "image-sources.mjs",
  "home-preload.mjs",
  "data.mjs",
  "universe.mjs",
  "universe-scenes.mjs",
  "styles.css",
  "blog-background.css",
  "author.css",
]) {
  await copyFile(`src/${file}`, `${outdir}/${file}`);
}
await mkdir("outputs/verification", { recursive: true });
await writeFile(
  "outputs/verification/library-build-meta.json",
  JSON.stringify(result.metafile, null, 2),
);
const destination = `${outdir}/assets/licenses`;
await mkdir(destination, { recursive: true });
await mkdir(`${outdir}/assets/fonts`, { recursive: true });
await copyFile(new URL("./files/new-tegomin-latin-400-normal.woff2", import.meta.resolve("@fontsource/new-tegomin/latin.css")), `${outdir}/assets/fonts/new-tegomin-latin.woff2`);
await copyFile(new URL("./LICENSE", import.meta.resolve("@fontsource/new-tegomin/latin.css")), `${destination}/new-tegomin-OFL.txt`);
await copyFile(new URL("./LICENSE.md", import.meta.resolve("simple-icons")), `${destination}/simple-icons-LICENSE.md`);
await copyFile(new URL("../LICENSE", import.meta.resolve("react-colorful")), `${destination}/react-colorful-LICENSE.txt`);
await copyFile(new URL("../LICENSE.md", import.meta.resolve("plyr")), `${destination}/plyr-LICENSE.md`);
await copyFile(new URL("./plyr.css", import.meta.resolve("plyr")), `${outdir}/plyr.css`);
await copyFile(new URL("./plyr.svg", import.meta.resolve("plyr")), `${outdir}/assets/plyr.svg`);
await copyFile("src/library-home.css", `${outdir}/home.css`);
await copyFile("src/library-cosmos.css", `${outdir}/cosmos.bundle.css`);
await mkdir(`${outdir}/assets/materials`, { recursive: true });
await copyFile(
  "src/vendor/eso-milky-way/eso0932a.jpg",
  `${outdir}/assets/materials/eso-milky-way.jpg`,
);
await copyFile(
  "src/vendor/eso-milky-way/sources.json",
  `${destination}/eso-milky-way-sources.json`,
);
await copyFile(
  "src/vendor/eso-galactic-centre/eso0934a.jpg",
  `${outdir}/assets/materials/eso-galactic-centre.jpg`,
);
await copyFile(
  "src/vendor/eso-galactic-centre/sources.json",
  `${destination}/eso-galactic-centre-sources.json`,
);
await copyFile(
  "src/vendor/eso-scene-photographs/eso1625a-wallpaper.jpg",
  `${outdir}/assets/materials/eso-orion.jpg`,
);
await copyFile(
  "src/vendor/user-space-assets/blog-space.png",
  `${outdir}/assets/materials/blog-space.png`,
);
await copyFile(
  "src/vendor/user-space-assets/sources.json",
  `${destination}/user-space-assets-sources.json`,
);
await copyFile(
  "src/vendor/react-bits/Galaxy.css",
  `${outdir}/blog-galaxy.css`,
);
await copyFile(
  "src/vendor/react-bits/GlassSurface.css",
  `${outdir}/blog-glass-surface.css`,
);
for (const [original, name] of [
  ["eso1105a", "eso-m78"],
  ["eso1424a", "eso-triangulum"],
])
  await copyFile(
    `src/vendor/eso-scene-photographs/${original}.jpg`,
    `${outdir}/assets/materials/${name}.jpg`,
  );
await copyFile(
  "src/vendor/eso-scene-photographs/sources.json",
  `${destination}/eso-scene-photographs-sources.json`,
);
for (const file of ["sources.json", "LICENSE", "NOISE-LICENSE"])
  await copyFile(
    `src/vendor/space-3d/${file}`,
    `${destination}/space-3d-${file}`,
  );
await copyFile(
  "src/vendor/reference-materials/alien-cracked-normal.png",
  `${outdir}/assets/materials/reference-glass-normal.png`,
);
await copyFile(
  "src/vendor/reference-materials/matcap-test.jpg",
  `${outdir}/assets/materials/reference-matcap.jpg`,
);
await copyFile(
  "src/vendor/reference-materials/cliffs-MRO.png",
  `${outdir}/assets/materials/reference-cliffs-MRO.png`,
);
await copyFile(
  "src/vendor/reference-materials/sources.json",
  `${destination}/reference-materials-sources.json`,
);
await copyFile(
  "src/vendor/active-theory-glass/sources.json",
  `${destination}/reference-glass-sources.json`,
);
await copyFile(
  "src/vendor/active-theory-tubes/sources.json",
  `${destination}/reference-tubes-sources.json`,
);
// Preserve notices for packages actually included in the browser graph.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let directory = dirname(resolve(input));
  while (
    basename(directory) !== "node_modules" &&
    dirname(directory) !== directory
  ) {
    try {
      const pkg = JSON.parse(
        await readFile(resolve(directory, "package.json"), "utf8"),
      );
      if (pkg.name) {
        packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg });
        break;
      }
    } catch {}
    directory = dirname(directory);
  }
}
const sources = [];
for (const [id, { directory, pkg }] of packages) {
  const files = (await readdir(directory)).filter((name) =>
    /^(licen[sc]e|copying|notice)(\.|$)/i.test(name),
  );
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
await copyFile(
  "src/vendor/react-bits/LICENSE.md",
  `${destination}/react-bits-LICENSE.md`,
);
await copyFile(
  "src/vendor/react-bits/sources.json",
  `${destination}/react-bits-sources.json`,
);
await copyFile(
  "src/vendor/three-font/source.json",
  `${destination}/helvetiker-font-source.json`,
);
await copyFile(
  "src/vendor/threejs-components/sources.json",
  `${destination}/threejs-components-sources.json`,
);
await writeFile(
  `${destination}/packages.json`,
  JSON.stringify(sources, null, 2),
);
// Build the chapter arrow from the same Lucide family; the controller stays
// DOM-independent and can be tested without importing React rendering code.
const dom = new JSDOM();
globalThis.document = dom.window.document;
const chapterArrow = createElement(ArrowRight, {
  "aria-hidden": "true",
  focusable: "false",
}).outerHTML;
const loadingIcon = createElement(LoaderCircle, {"aria-hidden":"true", focusable:"false"}).outerHTML;
await writeFile(`${outdir}/index.html`, (await readFile(`${outdir}/index.html`, 'utf8')).replace('<span class="startup-icon" aria-hidden="true"></span>', loadingIcon));
delete globalThis.document;
dom.window.close();
await writeFile(
  `${outdir}/chapter-icons.mjs`,
  `// Generated from lucide@1.45.0. See assets/licenses.\nexport const chapterArrow=${JSON.stringify(chapterArrow)};\nexport const loadingIcon=${JSON.stringify(loadingIcon)};\n`,
);
// Remove only obsolete, generated chunk files from this build's own directory.
const chunkDir = await realpath(`${outdir}/chunks`),
  distDir = await realpath(outdir);
if (dirname(chunkDir) !== distDir)
  throw new Error("Unexpected chunk output location");
const activeChunks = new Set(
  Object.keys(result.metafile.outputs)
    .filter((p) => dirname(resolve(p)) === chunkDir)
    .map((p) => basename(p)),
);
for (const file of await readdir(chunkDir))
  if (/^chunk-[A-Z0-9]+\.mjs$/.test(file) && !activeChunks.has(file))
    await unlink(resolve(chunkDir, file));
console.log(
  `Library build complete: ${sources.length} third-party packages, local assets and source notices.`,
);
