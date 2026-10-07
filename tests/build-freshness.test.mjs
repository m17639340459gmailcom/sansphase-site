import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifySite } from "../scripts/verify-site.mjs";
import { rewriteStaticHtml } from "../scripts/static-package.mjs";
import { composeSiteStyles } from "../scripts/compose-site-styles.mjs";
import { composeCommunityStyles } from "../scripts/compose-community-styles.mjs";
import { transform } from 'esbuild';
import { loaderDial } from '../src/loader-dial.mjs';
import { typedBrowserModules } from '../scripts/typed-browser-modules.mjs';

const canonicalFiles = [
  "index.html",
  "app.mjs",
  "admin-route.mjs",
  "catalog.mjs",
  "catalog.css",
  "page-session.js",
  "core.mjs",
  "image-sources.mjs",
  "content-reader.mjs",
  "navigation-prefetch.mjs",
  "home-preload.mjs",
  "route-assets.mjs",
  "route-styles.mjs",
  "scene-delivery.mjs",
  "data.mjs",
  "universe.mjs",
  "universe-scenes.mjs",
  "black-hole-view.mjs",
  "route-transition.mjs",
  "journey.mjs",
  "nav-slider.mjs",
  "loader-dial.mjs",
  "styles.css",
  "blog-background.css",
  "author.css",
  "community.css",
  "community-banner-controller.mjs",
  "community-banner-editor.mjs",
  "community-frame-banners.mjs",
  "community-write-request.mjs",
  "community-growth.mjs",
  "community-pages.mjs",
  "community-ui.mjs",
  "community-passive-refresh.mjs",
  "community-staff.mjs",
  "community-profile.mjs",
  "reader-frames.mjs",
  "community-level-explorer.mjs",
  "community-growth-art.mjs",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("the single generated site stays synchronized with source and has all referenced assets", async () => {
  for (const file of canonicalFiles) {
    let source = file === "styles.css"
      ? await composeSiteStyles()
      : file === "community.css"
        ? await composeCommunityStyles()
        : typedBrowserModules.has(file)
          ? (await transform(await readFile(`src/${file.slice(0, -'.mjs'.length)}.ts`, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' })).code
          : await readFile(`src/${file}`);
    if(file==='index.html') {
      // The only HTML build substitution is the shared loading dial;
      // validate the rest of the template byte for byte as before.
      const placeholder='<span class="startup-icon" aria-hidden="true"></span>';
      assert.equal(source.toString().split(placeholder).length,2);
      assert.match(loaderDial,/^<span class="loader-dial" aria-hidden="true">/);
      source=Buffer.from(source.toString().replace(placeholder,loaderDial));
      const delivery=await readFile('dist/static-delivery.json','utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error});
      source=Buffer.from(rewriteStaticHtml(source.toString(),delivery));
    }
    assert.equal(digest(await readFile(`dist/${file}`)), digest(source), `dist/${file} is stale; run pnpm build`);
  }
  for (const [source, output] of [["library-home.css", "home.css"], ["library-cosmos.css", "cosmos.bundle.css"]]) {
    assert.equal(digest(await readFile(`dist/${output}`)), digest(await readFile(`src/${source}`)));
  }
  await verifySite("dist");
});

test('a typed browser module is emitted as runnable JavaScript', async () => {
  const source = await readFile('src/access-policy.ts', 'utf8');
  const output = await readFile('dist/access-policy.mjs', 'utf8');
  assert.ok(source.includes('publicRoute'));
  assert.ok(!output.includes('export * from'));
  const { publicRoute, publicKind } = await import('../dist/access-policy.mjs');
  assert.equal(publicRoute('note'), true);
  assert.equal(publicRoute('community', 'rules'), false);
  assert.equal(publicRoute('community', 'manage'), false);
  assert.equal(publicRoute('resource-center'), false);
  assert.equal(publicKind('notes'), true);
  assert.equal(publicKind('books'), false);
});

test('passive refresh ships as compiled JavaScript at its browser import path', async () => {
  const file = 'community-passive-refresh.mjs';
  assert.ok(typedBrowserModules.has(file), 'the scheduler must use the typed browser emitter');
  const adapter = await readFile(`src/${file}`, 'utf8');
  assert.equal(adapter.trim(), "// Source adapter for Node tests while the browser receives compiled output.\nexport * from './community-passive-refresh.ts';");
  const source = await readFile('src/community-passive-refresh.ts', 'utf8');
  const output = await readFile(`dist/${file}`, 'utf8');
  assert.equal(output, (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code);
  assert.doesNotMatch(output, /(?:from\s*|import\s*\()["'][^"']*\.ts["']/);
  const { createCommunityPassiveRefresh } = await import('../dist/community-passive-refresh.mjs');
  assert.equal(typeof createCommunityPassiveRefresh, 'function');
  await verifySite('dist');
});

test('page DTO cache bundles its dependency at the stable browser module path', async () => {
  const file = 'community-page-cache.mjs';
  assert.equal(typedBrowserModules.has(file), false, 'a bare dependency requires the bundled entry, not the source-copy emitter');
  const output = await readFile(`dist/${file}`, 'utf8');
  assert.doesNotMatch(output, /(?:from\s*|import\s*\()["'](?:lru-cache|[^"']*\.ts)["']/);
  const { createCommunityPageCache, communityPageCacheLimits } = await import('../dist/community-page-cache.mjs');
  assert.deepEqual(communityPageCacheLimits, { threads: 24, members: 48, lists: 64 });
  const cache = createCommunityPageCache(2);
  cache.set('old', { title: 'old' }).set('recent', { title: 'recent' }).set('current', { title: 'current' });
  assert.equal(cache.size, 2);
  assert.equal(cache.has('old'), false);
  assert.equal(cache.get('current').title, 'current');
  await verifySite('dist');
});

test('shared staff catalogs ship at the compiled browser path without TypeScript imports', async () => {
  const file = 'community-staff.mjs';
  assert.ok(typedBrowserModules.has(file));
  const output = await readFile(`dist/${file}`, 'utf8');
  assert.doesNotMatch(output, /(?:from\s*|import\s*\()["'][^"']*\.ts["']/);
  const { communityStaffRoles, communityStaffNextRole, communityStaffCapabilities } = await import('../dist/community-staff.mjs');
  assert.deepEqual(communityStaffRoles.map(item => item.id), ['owner', 'general', 'moderator', 'assistant']);
  assert.equal(communityStaffNextRole('moderator'), 'assistant');
  assert.ok(communityStaffCapabilities.some(item => item.id === 'profile.nickname.advise'));
  for (const name of ['community', 'community-ui', 'community-pages', 'community-management', 'community-stewards', 'community-level-explorer'])
    assert.doesNotMatch(await readFile(`dist/${name}.mjs`, 'utf8'), /(?:from\s*|import\s*\()["'][^"']*\.ts["']/);
});
