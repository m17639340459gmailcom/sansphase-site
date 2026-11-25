import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, mkdir, rm, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { publicationFiles } from '../scripts/publication-files.mjs';
import { verifyBuild } from '../server/production-config.ts';
import { verifyFrontendBuild } from '../scripts/frontend-selection.mjs';

const run=promisify(execFile), repository=resolve('.');
const optional=existsSync(resolve(repository,'previews/hero-upgrade/package-lock.json'));

test('selected version 2 source package builds both frontends without old outputs or private runtime files',{
  skip:!optional&&'version 1 source package intentionally has no optional frontend',timeout:180000,
},async()=>{
  const base=resolve('.build');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(resolve(base,'clean-v2-test-'));
  try {
    const sources=await publicationFiles(repository,{frontend:'v2'});
    for(const path of sources){const target=resolve(directory,path);await mkdir(dirname(target),{recursive:true});await copyFile(resolve(repository,path),target);}
    // Run the real preparer only inside this source-only sandbox. It cannot
    // read the repository's private runtime or change its saved publications.
    const prepared=await run(process.execPath,['scripts/prepare-publication.mjs','--frontend=v2'],{cwd:directory,timeout:120000,maxBuffer:4*1024*1024});
    const publication=JSON.parse(prepared.stdout);assert.equal(publication.status,'prepared-not-published');assert.equal(publication.frontend,'v2');
    await assert.rejects(access(resolve(publication.directory,'outputs')));
    await assert.rejects(access(resolve(publication.directory,'.local/site-env.json')));
    const installed=resolve(repository,'previews/hero-upgrade/node_modules');await access(installed);
    // As in the original clean-build test, use installed dependencies, never
    // generated assets. This link is test-local and is not a publication input.
    await symlink(installed,resolve(publication.directory,'previews/hero-upgrade/node_modules'),process.platform==='win32'?'junction':'dir');
    const built=await run(process.execPath,['scripts/build-site.mjs','--frontend=v2'],{cwd:publication.directory,timeout:150000,maxBuffer:8*1024*1024});
    assert.match(built.stdout,/Clean build verified/);
    const output=resolve(publication.directory,'dist'), manifest=await verifyBuild(output);
    await verifyFrontendBuild(output,manifest,'v2');
    for(const path of ['index.html','admin-console/index.html','frontend-v2/index.html','frontend-v2/build-manifest.json','frontend-v2/third-party-notices.txt'])assert.ok(manifest.files.some(file=>file.path===path),path);
    const original=await readFile(resolve(output,'index.html'),'utf8'), upgraded=await readFile(resolve(output,'frontend-v2/index.html'),'utf8');
    assert.doesNotMatch(original,/id="site-integration"/);assert.doesNotMatch(upgraded,/id="site-integration"/);
    assert.match(upgraded,/\/build\/main-[A-Z0-9]{8}\.js/);
    const delivery=JSON.parse(await readFile(resolve(output,'static-delivery.json'),'utf8'));
    const frontend=JSON.parse(await readFile(resolve(output,'frontend-v2/build-manifest.json'),'utf8'));
    assert.ok(upgraded.includes('/'+delivery.prefix+'/frontend-v2'+frontend.script));
    assert.ok(upgraded.includes('/'+delivery.prefix+'/frontend-v2/style.css'));
    const delivered=new Set(manifest.files.map(file=>file.path));
    for(const asset of frontend.assets) {
      const path='frontend-v2'+asset,snapshot=delivery.prefix+'/'+path;
      assert.ok(delivered.has(snapshot),snapshot);
      const source=await readFile(resolve(output,path));
      assert.deepEqual(await readFile(resolve(output,snapshot)),source,'snapshots preserve public build bytes');
      if(asset.endsWith('.css'))assert.doesNotMatch(source.toString('utf8'),/url\(["']?\/build\//,'fonts must resolve inside their retained CSS snapshot');
      if(asset.endsWith('.js')) {
        const imports=[];
        const visit=node=>{
          if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))imports.push(node.moduleSpecifier.text);
          if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]))imports.push(node.arguments[0].text);
          ts.forEachChild(node,visit);
        };
        visit(ts.createSourceFile(asset,source.toString('utf8'),ts.ScriptTarget.Latest));
        for(const imported of imports) {
          assert.match(imported,/^\.\.?\//,'module imports must remain relative to their snapshot');
          const target=resolve(dirname(resolve(output,snapshot)),imported);
          assert.ok(target.startsWith(resolve(output,delivery.prefix)+sep),'deferred module cannot escape its retained version');
          await access(target);
        }
      }
    }
    assert.ok(!manifest.files.some(file=>/\.map$|(?:^|\/)(?:\.local|outputs|node_modules|src|tests)(?:\/|$)/.test(file.path)));
    await assert.rejects(access(resolve(publication.directory,'outputs/hero-upgrade')));
    await assert.rejects(access(resolve(publication.directory,'.local/site-env.json')));
    const successful=await readFile(resolve(output,'build-info.json'));
    const entry=resolve(publication.directory,'previews/hero-upgrade/src/main.ts');
    await writeFile(entry,(await readFile(entry,'utf8'))+'\nconst invalidFrontendDeliveryFixture: string = 42;\n');
    await assert.rejects(run(process.execPath,['scripts/build-site.mjs','--frontend=v2'],{
      cwd:publication.directory,timeout:150000,maxBuffer:8*1024*1024,
    }),/Frontend V2 type\/dependency check failed/);
    assert.deepEqual(await readFile(resolve(output,'build-info.json')),successful,
      'a failed optional frontend build must preserve the last complete release');
    await verifyBuild(output);
  } finally {
    if(!directory.startsWith(base+sep))throw Error('Unsafe source-only build test cleanup.');
    await rm(directory,{recursive:true,force:true});
  }
});
