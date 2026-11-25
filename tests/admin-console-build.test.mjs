import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  unlink,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import { verifySite } from "../scripts/verify-site.mjs";
import { createBuildManifest } from "../scripts/build-manifest.mjs";
import { verifyBuild } from "../server/production-config.ts";
import { adminConsoleDocument } from "../server/admin-console-assets.ts";
import { packageStaticFiles } from "../scripts/static-package.mjs";

async function isolated(t) {
  const base = resolve(".local");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, "admin-build-test-"));
  t.after(async () => {
    assert.ok(root.startsWith(base + sep));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    resolve(root, "index.html"),
    '<!doctype html><html><head><script type="module" src="./app.mjs"></script></head><body>Public site</body></html>',
  );
  await writeFile(resolve(root, "app.mjs"), "export const publicSite = true;");
  return root;
}

async function fixture(root) {
  await mkdir(resolve(root, "admin-console/chunks"), { recursive: true });
  await writeFile(
    resolve(root, "admin-console/index.html"),
    '<!doctype html><link rel="stylesheet" href="./admin-console.css"><script type="module" src="./admin-console.js"></script>',
  );
  await writeFile(
    resolve(root, "admin-console/admin-console.js"),
    'export const open = () => import("./chunks/detail.js");',
  );
  await writeFile(
    resolve(root, "admin-console/chunks/detail.js"),
    'export { label } from "./labels.js";',
  );
  await writeFile(
    resolve(root, "admin-console/chunks/labels.js"),
    'export const label = "用户";',
  );
  await writeFile(
    resolve(root, "admin-console/admin-console.css"),
    '@import "./details.css";',
  );
  await writeFile(
    resolve(root, "admin-console/details.css"),
    'body { color: #25344a; background-image: url("./tile.svg"); }',
  );
  await writeFile(
    resolve(root, "admin-console/tile.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
}

test("release validation refuses an otherwise healthy site missing the admin console", async (t) => {
  const root = await isolated(t);
  await assert.rejects(verifySite(root), /admin-console/);
  await createBuildManifest(root, "test");
  await assert.rejects(verifyBuild(root), /admin-console/);
});

test("admin validation follows nested dynamic JS, CSS imports and images without ignoring missing assets", async (t) => {
  const root = await isolated(t);
  await fixture(root);
  await verifySite(root);
  const missing = resolve(root, "admin-console/chunks/labels.js");
  const bytes = await readFile(missing);
  await unlink(missing);
  await assert.rejects(verifySite(root), /admin|labels|resolve/i);
  await writeFile(missing, bytes);
  await unlink(resolve(root, "admin-console/tile.svg"));
  await assert.rejects(verifySite(root), /admin|tile|resolve/i);
});

test("admin assets must stay same-origin and inside their own output directory", async (t) => {
  const root = await isolated(t);
  await fixture(root);
  await writeFile(
    resolve(root, "admin-console/admin-console.js"),
    'import "../app.mjs";',
  );
  await assert.rejects(
    verifySite(root),
    /admin-console|self-contained|outside/i,
  );
  await writeFile(
    resolve(root, "admin-console/admin-console.js"),
    "export {};",
  );
  await writeFile(
    resolve(root, "admin-console/admin-console.css"),
    '@import "https://example.invalid/theme.css";',
  );
  await assert.rejects(verifySite(root), /admin-console|same-origin|external/i);
  await writeFile(
    resolve(root, "admin-console/index.html"),
    '<script type="module" src="https://example.invalid/admin.js"></script>',
  );
  await assert.rejects(verifySite(root), /admin-console|same-origin|external/i);
});

test("the redesigned admin console remains available in local preview", { timeout: 120000 }, async (t) => {
  const root = await isolated(t);
  const { buildAdminConsole } = await import("../scripts/build-admin-console.ts");
  await assert.rejects(buildAdminConsole(root, { redesign: true }), /preview/i);
  const result = await buildAdminConsole(root, { preview: true, redesign: true });
  const javascript = await readFile(resolve(root, "admin-console/admin-console.js"), "utf8");
  assert.match(javascript, /sansphase-admin-redesign-local/);
  assert.ok(Object.values(result.metafile.outputs).some(
    (output) => output.entryPoint === "src/admin-console/author-workspace.tsx",
  ), "the author workspace loads as its own entry");
  assert.match(await readFile(resolve(root, "admin-console/index.html"), "utf8"), /\.\/author-workspace\.css/);
  await verifySite(root);
});

test("the V3 production console includes the embedded author workspace and skips demo settings", { timeout: 120000 }, async (t) => {
  const root = await isolated(t);
  const { buildAdminConsole } = await import("../scripts/build-admin-console.ts");
  await assert.rejects(buildAdminConsole(root, { v3Integrated: true }), /redesign/i);
  const result = await buildAdminConsole(root, { redesign: true, v3Integrated: true });
  const html = await readFile(resolve(root, "admin-console/index.html"), "utf8");
  assert.match(html, /data-main-frontend="v3"/);
  assert.match(html, /\.\/author-workspace\.css/);
  assert.equal(adminConsoleDocument(html, "v3"), html);
  assert.match(adminConsoleDocument(html, "v2"), /data-main-frontend="v2"/);
  assert.equal((adminConsoleDocument(html, "v2").match(/data-main-frontend/g) ?? []).length, 1);
  const output = await Promise.all(Object.entries(result.metafile.outputs)
    .filter(([path]) => path.endsWith(".js"))
    .map(([path]) => readFile(resolve(path), "utf8")));
  const javascript = output.join("\n");
  assert.match(javascript, /sansphase-admin-v3/);
  assert.match(javascript, /\/account\?adminReturn=/);
  const demoMarkers = (html + javascript).match(/localhost:4308|data-v3-preview-origin|sansphase-admin-redesign-local|preview-login|DemoLogin2026|owner@example\.test|当前使用演示数据/g);
  assert.equal(demoMarkers, null, "production includes a demo marker");
  assert.ok(Object.values(result.metafile.outputs).some(
    (entry) => entry.entryPoint === "src/admin-console/author-workspace.tsx",
  ));
  await verifySite(root);
});

test(
  "production build isolates the console, publishes its manifest and leaves visitor preloads unchanged",
  { timeout: 120000 },
  async (t) => {
    const root = await isolated(t);
    const { buildAdminConsole } =
      await import("../scripts/build-admin-console.ts");
    const result = await buildAdminConsole(root);
    assert.ok(result.metafile);
    assert.ok(
      Object.keys(result.metafile.inputs).every(
        (path) => !/(?:scripts\/fixtures|previews|\.local)\//.test(path),
      ),
    );
    assert.ok(!Object.keys(result.metafile.inputs).includes("src/admin-console/author-workspace.tsx"));
    const files = await readdir(resolve(root, "admin-console"));
    assert.ok(
      files.includes("index.html") &&
        files.includes("admin-console.js") &&
        files.includes("admin-console.css"),
    );
    const notices = JSON.parse(
      await readFile(
        resolve(root, "admin-console/assets/licenses/sources.json"),
        "utf8",
      ),
    );
    for (const name of [
      "ra-core",
      "ra-ui-materialui",
      "@mui/material",
      "@emotion/react",
    ]) {
      const notice = notices.find((item) => item.name === name);
      assert.ok(notice?.notices.length, `missing shipped license for ${name}`);
      for (const file of notice.notices)
        assert.ok(
          (
            await readFile(
              resolve(
                root,
                "admin-console/assets/licenses",
                `${name.replaceAll("/", "-")}@${notice.version}-${file}`,
              ),
            )
          ).length > 0,
        );
    }
    const html = await readFile(
      resolve(root, "admin-console/index.html"),
      "utf8",
    );
    const javascript = await readFile(
      resolve(root, "admin-console/admin-console.js"),
      "utf8",
    );
    assert.ok(!javascript.includes("sansphase-admin-redesign-local"));
    assert.ok(!javascript.includes("localhost:4308"));
    assert.ok(!javascript.includes("console-tool-arrow"), "the preview dashboard must not ship in release JS");
    assert.equal(
      /preview-login|DemoLogin2026|owner@example\.test|local-preview-owner|当前使用演示数据/.test(
        html + javascript,
      ),
      false,
      "the production console must not contain local demonstration login or identity",
    );
    await verifySite(root);
    const delivery = await packageStaticFiles(
      root,
      "https://static.example.test",
    );
    assert.deepEqual(
      delivery.files.map((file) => file.path),
      ["app.mjs"],
    );
    assert.deepEqual(delivery.modulepreloads, []);
    assert.equal(
      await readFile(resolve(root, "admin-console/index.html"), "utf8"),
      html,
    );
    await verifySite(root);
    const manifest = await createBuildManifest(root, "test");
    assert.equal((await verifyBuild(root)).release, manifest.release);
    assert.ok(
      manifest.files.some(
        (file) => file.path === "admin-console/admin-console.js",
      ),
    );
    await writeFile(
      resolve(root, "admin-console/admin-console.js"),
      javascript + "\n// modified",
    );
    await assert.rejects(verifyBuild(root), /verification failed/);
  },
);
