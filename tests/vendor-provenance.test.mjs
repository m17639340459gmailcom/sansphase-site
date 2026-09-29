import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build as bundle } from "esbuild";

test("fingerprinted sky assets retain source bytes without image recompression", async () => {
  const files=await readdir('dist/assets/scene');
  for(const [directory,name] of [['eso-milky-way','eso0932a'],['eso-galactic-centre','eso0934a'],['eso-scene-photographs','eso1105a'],['eso-scene-photographs','eso1424a']]) {
    const matching=files.filter(file=>file.startsWith(name+'-')&&file.endsWith('.jpg'));
    assert.equal(matching.length,1);
    assert.deepEqual(await readFile('dist/assets/scene/'+matching[0]),await readFile(`src/vendor/${directory}/${name}.jpg`));
  }
});

test("later chapter skies retain distinct non-generated ESO photographic sources", async () => {
  const manifest = JSON.parse(
    await readFile("src/vendor/eso-scene-photographs/sources.json", "utf8"),
  );
  const chapterFiles = manifest.files.filter((file) => file.id !== "eso1625a");
  const blogFile = manifest.files.find((file) => file.id === "eso1625a");
  assert.equal(chapterFiles.length, 2);
  assert.ok(blogFile);
  assert.equal(new Set(manifest.files.map((file) => file.sha256)).size, 3);
  for (const file of chapterFiles) {
    const bytes = await readFile(
      `src/vendor/eso-scene-photographs/${file.file}`,
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    assert.equal(file.type, "Observation");
    assert.ok(file.width >= 3900 && file.height >= 3000);
  }
  const blogBytes = await readFile(`src/vendor/eso-scene-photographs/${blogFile.file}`);
  assert.equal(createHash("sha256").update(blogBytes).digest("hex"), blogFile.sha256);
  assert.equal(blogFile.type, "Observation");
  assert.deepEqual([blogFile.width, blogFile.height], [1920, 1200]);
});

test("active effects have pinned third-party source and preserved upstream originals", async () => {
  const manifest = JSON.parse(
    await readFile("src/vendor/react-bits/sources.json", "utf8"),
  );
  for (const entry of manifest.files) {
    const bytes = await readFile(
      `src/vendor/react-bits/upstream/${entry.path}`,
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
    );
    assert.match(
      entry.url,
      /githubusercontent\.com\/DavidHDev\/react-bits\/[a-f0-9]{40}\//,
    );
  }
  assert.match(
    await readFile("src/vendor/react-bits/LICENSE.md", "utf8"),
    /copyright notice and this permission notice/,
  );
  // Check current source by default. The reviewed dist can deliberately remain
  // on the earlier release while an internal candidate is still being evaluated.
  const build = process.env.SCENE_BUILD_META
    ? JSON.parse(await readFile(process.env.SCENE_BUILD_META, "utf8"))
    : (
        await bundle({
          entryPoints: ["src/library-cosmos.tsx", "src/library-ui.tsx"],
          outdir: "outputs/verification/provenance",
          bundle: true,
          format: "esm",
          platform: "browser",
          jsx: "automatic",
          loader: { ".glsl": "text", ".jpg": "file" },
          write: false,
          metafile: true,
          define: { "process.env.NODE_ENV": '"production"' },
          logLevel: "silent",
        })
      ).metafile;
  const inputs = Object.keys(build.inputs);
  for (const old of [
    "signature-r",
    "orbital-field",
    "journey-field",
    "spatial-trail",
    "pointer-flow",
    "galaxy-scene",
  ])
    assert.ok(
      !inputs.some((p) => p === `src/${old}.mjs`),
      `${old} must not ship in the replacement`,
    );
  assert.ok(
    !inputs.some((p) => /vendor\/react-bits\/(Ribbons|Galaxy)\.jsx$/.test(p)),
    "screen-space overlays must not return to the live scene",
  );
  for (const name of ["Stars", "Fbo", "Effects", "Texture"])
    assert.ok(
      inputs.some((p) => p.includes("/drei/") && p.endsWith(`/${name}.js`)),
      `${name} must come from Drei`,
    );
  // The opening is the in-house black hole; the R glass installation and its
  // Quarks particles are detached from the live scene for now.
  assert.ok(inputs.includes("src/library-black-hole.jsx"), "the black hole opening ships");
  assert.ok(!inputs.includes("src/library-opening.jsx"), "the R installation is not in the live scene");
  assert.ok(
    !inputs.some((p) => p.includes("/three.quarks/")),
    "no particle engine ships without the installation that uses it",
  );
  assert.ok(
    !inputs.some((p) => p.includes("threejs-galaxy-shader")),
    "photographic skies replace procedural spirals in every chapter",
  );
  // Chapters 1-3 are one sky compositor over the unchanged ESO photographs;
  // the always-covered Space-3D panorama is detached from the live scene.
  assert.ok(inputs.includes("src/library-sky.jsx"), "the chapter sky compositor ships");
  for (const photograph of ["eso0934a.jpg", "eso1105a.jpg", "eso1424a.jpg", "eso0932a.jpg"])
    assert.ok(inputs.some((p) => p.endsWith(photograph)), `${photograph} ships unchanged`);
  assert.ok(!inputs.some((p) => p.endsWith("vendor/space-3d/nebula.glsl")), "the covered panorama is detached");
  const sources = JSON.parse(
    await readFile("src/vendor/threejs-components/sources.json", "utf8"),
  );
  assert.equal(sources.version, "0.0.19");
  for (const entry of sources.files) {
    const bytes = await readFile(
      `src/vendor/threejs-components/upstream/${entry.output}`,
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
    );
    const adapter = await readFile(
      `src/vendor/threejs-components/${entry.output}`,
      "utf8",
    );
    const body = adapter
      .split("// BEGIN UPSTREAM BODY\n")[1]
      .split("// END UPSTREAM BODY")[0];
    assert.equal(
      createHash("sha256").update(body).digest("hex"),
      entry.bodySha256,
      "upstream effect must remain traceable and unmodified",
    );
  }
  assert.ok(
    !inputs.some((p) => /vendor\/threejs-components\//.test(p)),
    "the previous different cursor effect must not remain in the live scene",
  );
  // The opening's cursor is the black hole's own gravitational lens; the glass
  // tubes stay vendored and verified below but are not in the live scene.
  assert.ok(
    !inputs.some((p) => p.endsWith("vendor/active-theory-tubes/shaders.mjs")),
    "the glass cursor tubes are detached with the R installation",
  );
  for (const folder of ["active-theory-tubes", "active-theory-glass"]) {
    const source = JSON.parse(
      await readFile(`src/vendor/${folder}/sources.json`, "utf8"),
    );
    for (const entry of source.files) {
      const bytes = await readFile(
        `src/vendor/${folder}/upstream/${entry.name}`,
      );
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        entry.sha256,
      );
    }
    const { programs } = await import(`../src/vendor/${folder}/shaders.mjs`);
    const digest = (text) => createHash("sha256").update(text).digest("hex");
    if (folder === "active-theory-tubes") {
      assert.equal(
        digest(
          await readFile(
            `src/vendor/${folder}/${source.frameAdapter.file}`,
            "utf8",
          ),
        ),
        source.frameAdapter.sha256,
      );
      assert.equal(
        source.frameAdapter.source,
        "https://github.com/mrdoob/three.js/blob/r186/src/extras/core/Curve.js",
      );
    }
    for (const [name, program] of Object.entries(programs)) {
      if (typeof program === "string") {
        assert.equal(digest(program), source.programs[name]);
      } else {
        assert.equal(
          digest(program.vertexShader),
          source.programs[name].vertexSha256,
        );
        assert.equal(
          digest(program.fragmentShader),
          source.programs[name].fragmentSha256,
        );
      }
    }
  }
  const materials = JSON.parse(
    await readFile("src/vendor/reference-materials/sources.json", "utf8"),
  );
  for (const entry of materials.files) {
    const bytes = await readFile(
      `src/vendor/reference-materials/${entry.file}`,
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
    );
  }
});

test("the Milky Way image and Space-3D effects retain their source bytes and notices", async () => {
  for (const folder of ["space-3d", "eso-milky-way"]) {
    const source = JSON.parse(
      await readFile(`src/vendor/${folder}/sources.json`, "utf8"),
    );
    for (const file of source.files) {
      const bytes = await readFile(`src/vendor/${folder}/${file.file}`);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
      );
    }
  }
  assert.match(
    await readFile("src/vendor/space-3d/LICENSE", "utf8"),
    /public domain/,
  );
  assert.match(
    await readFile("src/vendor/space-3d/NOISE-LICENSE", "utf8"),
    /Stefan Gustavson/,
  );
});

test("works uses the unchanged ESO photographic source", async () => {
  const source = JSON.parse(
    await readFile("src/vendor/eso-galactic-centre/sources.json", "utf8"),
  );
  const bytes = await readFile(`src/vendor/eso-galactic-centre/${source.file}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
  assert.equal(source.type, "Observation");
  assert.equal(source.page, "https://www.eso.org/public/images/eso0934a/");
});
