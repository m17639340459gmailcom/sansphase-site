import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { publicationFiles, scanPublication } from '../scripts/publication-files.mjs';

test('publication includes relative imports of every shipped build script and test',async()=>{
  const root=resolve('.');
  const files=new Set(await publicationFiles(root));
  for(const file of files) {
    if(!/^(scripts|tests)\//.test(file)||!/\.(mjs|ts)$/.test(file))continue;
    const text=await readFile(resolve(root,file),'utf8');
    const imports=[];
    const visit=node=>{
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node,visit);
    };
    visit(ts.createSourceFile(file,text,ts.ScriptTarget.Latest));
    for(const imported of imports.filter(path=>path.startsWith('.')&&/\.(mjs|ts)$/.test(path))) {
      const dependency=relative(root,resolve(dirname(resolve(root,file)),imported)).replaceAll('\\','/');
      // These modules are built before the tests import them; generated output is never shipped as source.
      if (dependency.startsWith('dist/') || ['outputs/verification/library-scene-test.mjs', 'outputs/verification/opening-sky-test.mjs'].includes(dependency)) continue;
      assert.ok(files.has(dependency),`${file} imports missing publication file ${dependency}`);
    }
  }
});

test('publication retains growth asset generators and internal community rules for collaborators', async () => {
  const files = new Set(await publicationFiles());
  for (const file of ['scripts/build-growth-constellation.mjs', 'scripts/growth-constellation.ts', 'scripts/build-trust-moon.mjs', 'scripts/trust-moon.ts', 'scripts/build-vip-badge.mjs', 'scripts/vip-badge.ts', 'scripts/vip-badge-glyphs.ts', 'scripts/community-staff-compact-art.ts', 'docs/COMMUNITY-STARDUST-RULES.md', 'docs/COMMUNITY-CONVENTION.md', 'docs/COMMUNITY-EXPERIENCE-RULES.md']) {
    assert.ok(files.has(file), `the prepared source is missing ${file}`);
  }
});

test('publication keeps the complete community repair acceptance checklist', async () => {
  assert.ok(new Set(await publicationFiles()).has('docs/COMMUNITY-REPAIR-20261007.md'));
});

test('publication retains hierarchical moderation rules and the explicit profile migration', async () => {
  const files = new Set(await publicationFiles());
  for (const file of ['docs/COMMUNITY-STAFF.md', 'scripts/migrate-reader-profiles.mjs', 'server/reader-profile-workflow-migration.ts', 'server/reader-profile-backup.ts']) assert.ok(files.has(file), `missing staff/profile maintenance source ${file}`);
});

test('publication includes the explicit profile workflow upgrade, durable backup/restore helpers and maintenance contract',async()=>{
  const files=new Set(await publicationFiles());
  for(const file of ['scripts/migrate-reader-profiles.mjs','server/reader-profile-workflow-migration.ts','server/reader-profile-backup.ts','server/reader-workflow.ts','scripts/backup-payload.mjs','scripts/restore-payload.mjs','docs/COMMUNITY-PROFILES.md'])
    assert.ok(files.has(file),`profile maintenance publication is missing ${file}`);
});

test('publication retains the complete banner source, migration and linked maintenance guide', async () => {
  const files = new Set(await publicationFiles());
  for (const file of [
    'src/community-banners.ts',
    'src/community-banner-controller.ts', 'src/community-banner-controller.mjs',
    'src/community-banner-editor.ts', 'src/community-banner-editor.mjs',
    'src/community-frame-banners.ts', 'src/community-frame-banners.mjs',
    'src/community-layout/feed-showcase.ts',
    'server/community-banners.ts', 'server/payload/community-migration.ts',
    'scripts/migrate-community.mjs', 'docs/COMMUNITY-BANNERS.md',
  ]) assert.ok(files.has(file), `the release source is missing ${file}`);
  const guide = await readFile('docs/COMMUNITY-LOCAL-INTEGRATION.md', 'utf8');
  assert.match(guide, /\]\(COMMUNITY-BANNERS\.md\)/);
});

test('publication scan rejects credentials without revealing their values',async t=>{
  const root=await mkdtemp(resolve(tmpdir(),'sansphase-publication-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const secret='isolated-test-secret-value';
  await writeFile(resolve(root,'leak.json'),JSON.stringify({value:secret}));
  await writeFile(resolve(root,'safe.mjs'),'export const publicValue=1;');
  const report=await scanPublication(root,['.local/private.json','leak.json','safe.mjs'],[secret]);
  assert.equal(report.length,2);
  assert.ok(report.some(x=>x.reason==='known-private-value'));
  assert.ok(report.some(x=>x.reason==='private-or-generated-path'));
  assert.ok(!JSON.stringify(report).includes(secret));
});
