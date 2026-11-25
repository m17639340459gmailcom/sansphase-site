import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { frontendVersion, frontendArgument, verifyFrontendBuild } from '../scripts/frontend-selection.mjs';
import { publicationFiles } from '../scripts/publication-files.mjs';
import { packageStaticFiles } from '../scripts/static-package.mjs';
import { createFrontendV3Receipt } from '../scripts/frontend-v3-release.mjs';

test('frontend selection keeps version 1 by default and rejects unknown or ambiguous values',()=>{
  assert.equal(frontendVersion(undefined),'v1');
  assert.equal(frontendVersion('v1'),'v1');assert.equal(frontendVersion('v2'),'v2');
  assert.equal(frontendArgument([],{}),'v1');assert.equal(frontendArgument([],{SITE_FRONTEND:'v2'}),'v2');
  assert.equal(frontendArgument(['--frontend=v2'],{}),'v2');
  assert.equal(frontendArgument(['--frontend=v3'],{SITE_FRONTEND:'v2'}),'v3');
  assert.equal(frontendArgument(['--frontend','v1'],{SITE_FRONTEND:'v2'}),'v1');
  for(const value of ['', '2', 'V2', '../v2'])assert.throws(()=>frontendVersion(value),/v1.*v2/);
  for(const args of [['--unknown'],['v2'],['--frontend=v1','--frontend=v2']])assert.throws(()=>frontendArgument(args,{}));
});

test('the V3 source package includes reproducible inputs and omits generated files and reference identities',{
  skip:!existsSync(resolve('previews/frontend-v3/package-lock.json')),
},async()=>{
  const files=new Set(await publicationFiles(resolve('.'),{frontend:'v3'}));
  for(const file of ['scripts/frontend-v3-shared.mjs','scripts/build-frontend-v3.mjs','scripts/preview-captcha.ts','previews/frontend-v3/package-lock.json','previews/frontend-v3/LICENSE','previews/frontend-v3/src/proxy.ts','previews/frontend-v3/public/hero-particles-dark.webp']) assert.ok(files.has(file),file);
  for(const file of ['previews/frontend-v3/.env.local','previews/frontend-v3/.next/BUILD_ID','previews/frontend-v3/src/shared/site/login-verification.ts','previews/frontend-v3/public/contact/wechat-qr.jpg','previews/frontend-v3/public/peach-cat-avatar.png','previews/frontend-v3/public/avatar.png']) assert.ok(!files.has(file),file);
  assert.equal([...files].some(file=>/^previews\/frontend-v3\/src\/app\/(?:admin|api)\//.test(file)),false);
  assert.ok(!files.has('previews/frontend-v3/src/lib/fde.ts'));
  assert.equal([...files].some(file=>file.startsWith('previews/hero-upgrade/')),false);
});

test('V3 startup requires a packaged, sealed private runtime next to the public release', async t=>{
  const workspace=await mkdtemp(resolve(tmpdir(),'sansphase-frontend-selection-'));
  t.after(()=>rm(workspace,{recursive:true,force:true}));
  const root=resolve(workspace,'dist');
  await mkdir(root);
  await assert.rejects(verifyFrontendBuild(root,{files:[]},'v3'),/Missing frontend-v3/);
  const files=[{path:'frontend-v3.json'}];
  for (const selected of [undefined, 'v1', 'v2']) {
    await assert.rejects(verifyFrontendBuild(root, { files }, selected), /requires SITE_FRONTEND=v3/);
  }
  const app=resolve(workspace,'previews/frontend-v3');
  const buildDirectory='.next-release-0123456789abcdef';
  const build=resolve(app,buildDirectory);
  await mkdir(resolve(build,'server'),{recursive:true});
  await mkdir(resolve(build,'static'),{recursive:true});
  await writeFile(resolve(app,'package-lock.json'),'fixture lock');
  await writeFile(resolve(build,'BUILD_ID'),'example-build');
  for(const path of ['routes-manifest.json','required-server-files.json','server/app-paths-manifest.json']) await writeFile(resolve(build,path),'{}');
  await writeFile(resolve(build,'static','example.js'),'const ok = true;');
  const receipt=await createFrontendV3Receipt(app,buildDirectory);
  await writeFile(resolve(root,'frontend-v3.json'),JSON.stringify(receipt));
  assert.deepEqual(await verifyFrontendBuild(root,{files},'v3'),{appDirectory:app,buildDirectory});
  await writeFile(resolve(build,'static','example.js'),'const ok = false;');
  await assert.rejects(verifyFrontendBuild(root,{files},'v3'),/integrity/i);
  await writeFile(resolve(root,'frontend-v3.json'),JSON.stringify({...receipt,buildDirectory:'../outside'}));
  await assert.rejects(verifyFrontendBuild(root,{files},'v3'),/Invalid frontend-v3/);
});

test('V3 puts only its compiled public assets in the retained static delivery root', async t => {
  const workspace = await mkdtemp(resolve(tmpdir(), 'sansphase-v3-static-'));
  t.after(() => rm(workspace, { recursive:true, force:true }));
  const root = resolve(workspace, 'dist');
  const app = resolve(workspace, 'previews/frontend-v3');
  const id = '0123456789abcdef01234567';
  const buildDirectory = `.next-release-${id}`;
  const build = resolve(app, buildDirectory);
  const buildId = 'example-build';
  const assetPrefix = `assets/site/${id}`;
  const write = async (path, value) => {
    await mkdir(resolve(path, '..'), { recursive:true });
    await writeFile(path, value);
  };
  await write(resolve(root, 'index.html'), '<html><head></head></html>');
  await write(resolve(app, 'package-lock.json'), 'fixture lock');
  await write(resolve(build, 'BUILD_ID'), buildId);
  await write(resolve(build, 'routes-manifest.json'), '{}');
  await write(resolve(build, 'required-server-files.json'), JSON.stringify({ config:{ assetPrefix:`/${assetPrefix}` } }));
  await write(resolve(build, 'server/app-paths-manifest.json'), '{}');
  await write(resolve(build, 'server/private.js'), 'server marker');
  await write(resolve(build, 'static/chunks/scene-abc.js.map'), 'private source map marker');
  await write(resolve(build, 'static/chunks/debug.json'), 'debug marker');
  await write(resolve(app, 'public/uploads/user.png'), 'outside static');
  const assets = ['chunks/scene-abc.js', 'chunks/page-abc.css', 'media/body-abc.woff2', 'media/icon.abc.svg', `${buildId}/_buildManifest.js`];
  for (const path of assets) await write(resolve(build, 'static', path), path);

  const delivery = await packageStaticFiles(root, undefined, { appDirectory:app, buildDirectory, buildId });
  assert.equal(delivery.prefix, assetPrefix);
  assert.equal(delivery.origin, '');
  assert.deepEqual(delivery.files.map(({path}) => path).sort(), assets.map(path => `_next/static/${path}`).sort());
  for (const path of assets) assert.equal(await readFile(resolve(root, assetPrefix, '_next/static', path), 'utf8'), path);

  const receipt = await createFrontendV3Receipt(app, buildDirectory);
  await write(resolve(root, 'frontend-v3.json'), JSON.stringify(receipt));
  const manifest = { files:[{path:'frontend-v3.json'}, ...delivery.files.map(file => ({...file, path:`${assetPrefix}/${file.path}`}))] };
  assert.deepEqual(await verifyFrontendBuild(root,manifest,'v3'),{appDirectory:app,buildDirectory});
  await assert.rejects(verifyFrontendBuild(root,{ files:manifest.files.slice(0,-1) },'v3'), /missing retained frontend-v3 asset/i);
});

test('version 1 source packages remain independent of optional frontend and local test harnesses',async()=>{
  const files=new Set(await publicationFiles());
  assert.ok(files.has('scripts/frontend-selection.mjs'));
  assert.equal([...files].some(file=>file.startsWith('previews/')),false);
  for(const file of ['scripts/build-frontend-v2.mjs','scripts/preview-local-frontends.ts','tests/local-frontends-preview.test.ts','tests/frontend-integration-preview.test.ts','tests/fixtures/frontend-versions-backup.ts','tests/local-test-readers.test.ts'])assert.equal(files.has(file),false,file);
});

test('optional version 2 source packages contain its pinned clean-build sources and regression harnesses only',{
  skip:!existsSync(resolve('previews/hero-upgrade/package-lock.json'))&&'optional frontend source is absent from a version 1 publication',
},async()=>{
  const files=new Set(await publicationFiles(resolve('.'),{frontend:'v2'}));
  for(const file of ['scripts/build-frontend-v2.mjs','previews/hero-upgrade/package.json','previews/hero-upgrade/package-lock.json','previews/hero-upgrade/tsconfig.json','previews/hero-upgrade/src/main.ts','previews/hero-upgrade/scripts/build-config.ts','previews/hero-upgrade/www/index.html','previews/hero-upgrade/www/third-party-notices.txt','previews/hero-upgrade/vendor/tdx/LICENSE','previews/hero-upgrade/tests/integration-content.test.mjs','scripts/preview-local-frontends.ts','scripts/fixtures/frontend-integration.ts','tests/local-frontends-preview.test.ts','docs/FRONTEND-DELIVERY.md'])assert.ok(files.has(file),file);
  for(const file of files){assert.doesNotMatch(file,/(?:^|\/)(?:outputs|\.local|node_modules|dist|archive)(?:\/|$)/,file);if(file.startsWith('previews/'))assert.ok(file.startsWith('previews/hero-upgrade/'),file);}
  await assert.rejects(publicationFiles(resolve('.'),{frontend:'demo'}),/v1.*v2/);
});

test('version 2 startup fails closed if a verified release lacks its manifest or hashed assets',async t=>{
  const root=await mkdtemp(resolve(tmpdir(),'sansphase-frontend-selection-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await verifyFrontendBuild(root,{files:[]},'v1');
  await assert.rejects(verifyFrontendBuild(root,{files:[]},'v2'),/frontend-v2/);
  const dir=resolve(root,'frontend-v2');await mkdir(dir);
  const build={version:1,script:'/build/main-ABCDEFGH.js',stylesheet:'/build/main-ABCDEFGH.css',assets:['/build/main-ABCDEFGH.js','/build/main-ABCDEFGH.css','/build/photoswipe.esm-ABCDEFGH.js']};
  await writeFile(resolve(dir,'build-manifest.json'),JSON.stringify(build));
  const files=['frontend-v2/index.html','frontend-v2/style.css','frontend-v2/third-party-notices.txt','frontend-v2/build-manifest.json',...build.assets.map(path=>'frontend-v2'+path)].map(path=>({path}));
  await verifyFrontendBuild(root,{files},'v2');
  await assert.rejects(verifyFrontendBuild(root,{files:files.slice(0,-1)},'v2'),/Missing/);
  await writeFile(resolve(dir,'build-manifest.json'),JSON.stringify({...build,script:'/api/content'}));
  await assert.rejects(verifyFrontendBuild(root,{files},'v2'),/Invalid/);
});

test('production startup retains the original runtime and mounts version 2 only by explicit selection',async()=>{
  const start=await readFile('scripts/start.mjs','utf8');
  assert.match(start,/frontendVersion\(process\.env\.SITE_FRONTEND\)/);
  assert.match(start,/verifyFrontendBuild\(root,\s*manifest,\s*frontend\)/);
  assert.match(start,/frontend\s*===\s*['"]v2['"]/);
  assert.match(start,/allowOriginal:\s*true/);
  assert.match(start,/requestMiddleware/);
  assert.doesNotMatch(start,/preview-local-frontends|preview-frontend-integration|\.local\/|outputs\//);
});
