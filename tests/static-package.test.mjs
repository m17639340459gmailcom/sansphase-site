import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {pathToFileURL} from 'node:url';
import {createPreviewServer} from '../server.mjs';
import {packageStaticFiles,rewriteStaticHtml} from "../scripts/static-package.mjs";

async function frontendFixture(root,version='A') {
  await mkdir(join(root,'frontend-v2/build'),{recursive:true});
  await writeFile(join(root,'index.html'),'<html><head><script type="module" src="./app.mjs"></script></head></html>');
  await writeFile(join(root,'app.mjs'),'export const original=1;');
  const main=`main-${version.repeat(8)}.js`,lazy=`reader-${version.repeat(8)}.js`,shared=`shared-${version.repeat(8)}.js`,css=`main-${version.repeat(8)}.css`,font=`font-${version.repeat(8)}.woff2`;
  const html=`<html><head><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/build/${css}"></head><body><script type="module" src="/build/${main}"></script><a href="/api/reader/login">Account</a></body></html>`;
  await Promise.all([
    writeFile(join(root,'frontend-v2/index.html'),html),writeFile(join(root,'frontend-v2/style.css'),'body{color:blue}'),
    writeFile(join(root,'frontend-v2/build',main),`import {version} from "./${shared}";export {version};export const later=()=>import("./${lazy}");`),
    writeFile(join(root,'frontend-v2/build',shared),`export const version='${version}';`),
    writeFile(join(root,'frontend-v2/build',lazy),`export const reader='${version}';`),
    writeFile(join(root,'frontend-v2/build',css),`@font-face{font-family:Example;src:url(./${font})}body{font-family:Example}`),
    writeFile(join(root,'frontend-v2/build',font),Buffer.from([0,1,version.charCodeAt(0)])),
    writeFile(join(root,'frontend-v2/build/private.map'),'NEVER_PUBLISH_SOURCE_MAP'),
    writeFile(join(root,'frontend-v2/build/private.ts'),'NEVER_PUBLISH_SOURCE'),
    writeFile(join(root,'frontend-v2/build-manifest.json'),'NEVER_PUBLISH_MANIFEST'),
  ]);
  return {main,lazy,shared,css,font,html};
}

test('version 2 joins the existing public snapshot without exposing its document or source and keeps a separate static preload graph',async t=>{
  const root=await mkdtemp(join(tmpdir(),'sansphase-static-v2-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const files=await frontendFixture(root), delivery=await packageStaticFiles(root,'https://static.example');
  for(const name of [files.main,files.lazy,files.shared,files.css,files.font])assert.ok(delivery.files.some(file=>file.path==='frontend-v2/build/'+name),name);
  assert.ok(delivery.files.some(file=>file.path==='frontend-v2/style.css'));
  assert.ok(!delivery.files.some(file=>/index\.html|build-manifest|private\.(?:map|ts)/.test(file.path)));
  assert.deepEqual(delivery.modulepreloads,[]);
  assert.deepEqual(delivery.frontendV2Modulepreloads,['frontend-v2/build/'+files.shared]);
  const html=await readFile(join(root,'frontend-v2/index.html'),'utf8'),base=`https://static.example/${delivery.prefix}/`;
  for(const name of [files.main,files.css])assert.ok(html.includes(base+'frontend-v2/build/'+name),name);
  assert.ok(html.includes(base+'frontend-v2/style.css'));
  assert.ok(html.includes(`data-static-base="${base}"`));
  assert.ok(!html.includes('/'+files.lazy),'lazy reader must not be preloaded');
  assert.ok(html.includes('href="/api/reader/login"'),'business URLs remain same-origin');
});

test('two V2 releases keep delayed reader imports and fonts available through retained public snapshots, including same-origin delivery',async t=>{
  const root=await mkdtemp(join(tmpdir(),'sansphase-static-v2-switch-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const retained=join(root,'public'), releases=[];
  for(const version of ['A','B']) {
    const directory=join(root,version),files=await frontendFixture(directory,version),delivery=await packageStaticFiles(directory,'');
    assert.ok(delivery,'V2 same-origin builds need the public snapshot too');
    for(const file of delivery.files){const destination=join(retained,delivery.prefix,file.path);await mkdir(dirname(destination),{recursive:true});await copyFile(join(directory,delivery.prefix,file.path),destination);}
    releases.push({directory,files,delivery});
  }
  assert.notEqual(releases[0].delivery.prefix,releases[1].delivery.prefix);
  const server=createPreviewServer({root:retained});await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>new Promise(done=>server.close(done)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const [index,release] of releases.entries()) {
    const base=release.delivery.prefix+'/frontend-v2/build/';
    for(const name of [release.files.main,release.files.lazy,release.files.font]){
      const response=await fetch(origin+'/'+base+name);assert.equal(response.status,200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(retained,base,name)));
    }
    // Import the old entry only after the new release has also been installed.
    // Its relative lazy import must still resolve within its immutable snapshot.
    const entry=await import(pathToFileURL(join(retained,base,release.files.main)).href);
    assert.equal((await entry.later()).reader,index===0?'A':'B');
    const html=await readFile(join(release.directory,'frontend-v2/index.html'),'utf8');
    assert.ok(html.includes('/'+base+release.files.main));
  }
});

test("static package preserves bytes, excludes HTML and private files, and creates a new version when content changes",async()=>{
  const root=await mkdtemp(join(tmpdir(),"sansphase-static-"));
  try {
    await mkdir(join(root,"assets/materials"),{recursive:true});
    await mkdir(join(root,"assets/scene"),{recursive:true});
    await writeFile(join(root,"app.mjs"),'export const value=1;');
    await writeFile(join(root,"assets/materials/normal.png"),Buffer.from([0,1,2,3]));
    await writeFile(join(root,"assets/scene/sky.jpg"),"unchanged separate scene delivery");
    await writeFile(join(root,"secret.env"),"must never be published");
    const html='<html lang="zh-CN"><head><script type="module" src="./app.mjs?v=1"></script></head><body><a href="#/notes">Notes</a><img src="/api/media/test"></body></html>';
    await writeFile(join(root,"index.html"),html);
    assert.equal(await packageStaticFiles(root,''),null,'default V1 same-origin builds retain their established behavior');
    assert.equal(await readFile(join(root,'index.html'),'utf8'),html);
    const first=await packageStaticFiles(root,"https://static.example");
    assert.deepEqual(first.files.map(x=>x.path),["app.mjs","assets/materials/normal.png"]);
    assert.deepEqual(await readFile(join(root,first.prefix,"assets/materials/normal.png")),Buffer.from([0,1,2,3]));
    const output=await readFile(join(root,"index.html"),"utf8");
    assert(output.includes(`src="https://static.example/${first.prefix}/app.mjs?v=1" crossorigin="anonymous"`));
    assert(output.includes('href="#/notes"'));assert(output.includes('src="/api/media/test"'));
    assert.equal(rewriteStaticHtml(html,null),html);
    await writeFile(join(root,"app.mjs"),'export const value=2;');
    await writeFile(join(root,"index.html"),html);
    const second=await packageStaticFiles(root,"https://static.example");
    assert.notEqual(first.prefix,second.prefix);
    assert.equal(await readFile(join(root,first.prefix,"app.mjs"),"utf8"),'export const value=1;');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('preloads only the transitive static app graph, including shared chunks and re-exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sansphase-preload-'));
  try {
    await mkdir(join(root, 'chunks'));
    await writeFile(join(root, 'index.html'), '<html><head><script type="module" src="./app.mjs"></script></head></html>');
    await writeFile(join(root, 'app.mjs'), 'import "./a.mjs"; import {b} from "./b.mjs"; const later=()=>import("./author.mjs");');
    await writeFile(join(root, 'a.mjs'), 'export {c} from "./chunks/c.mjs";');
    await writeFile(join(root, 'b.mjs'), 'import "./a.mjs"; export const b=1;');
    await writeFile(join(root, 'chunks/c.mjs'), 'import "../a.mjs"; export const c=1;');
    await writeFile(join(root, 'author.mjs'), 'export const privateEditor=1;');
    const delivery = await packageStaticFiles(root, 'https://static.example');
    assert.deepEqual(delivery.modulepreloads, ['a.mjs', 'b.mjs', 'chunks/c.mjs']);
    const html = await readFile(join(root, 'index.html'), 'utf8');
    for (const path of delivery.modulepreloads) assert.ok(html.includes(`rel="modulepreload" href="https://static.example/${delivery.prefix}/${path}" crossorigin="anonymous"`));
    assert.ok(!html.includes('/author.mjs'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('community-specific early loading is recorded separately and never preloads the forum on the main site', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sansphase-community-preload-'));
  try {
    await writeFile(join(root, 'index.html'), '<html><head><script type="module" src="./app.mjs"></script></head></html>');
    await writeFile(join(root, 'app.mjs'), 'import "./shared.mjs"; const forum=()=>import("./community-runtime-client.mjs");');
    await writeFile(join(root, 'shared.mjs'), 'export const value=1;');
    await writeFile(join(root, 'community-runtime-client.mjs'), 'export * from "./community-ui.mjs";');
    await writeFile(join(root, 'community-ui.mjs'), 'import "./shared.mjs"; export const forum=1;');
    const delivery = await packageStaticFiles(root, 'https://static.example');
    assert.deepEqual(delivery.modulepreloads, ['shared.mjs']);
    assert.deepEqual(delivery.communityModulepreloads, ['community-runtime-client.mjs', 'community-ui.mjs', 'shared.mjs']);
    const html = await readFile(join(root, 'index.html'), 'utf8');
    assert.ok(!html.includes('/community-ui.mjs')); assert.ok(!html.includes('/community-runtime-client.mjs'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
