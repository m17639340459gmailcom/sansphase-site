import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderProfileBackupGuard, snapshotReaderProfileWorkflow } from '../server/reader-profile-backup.ts';

const run = promisify(execFile);

test('private backups include approved reader avatars but omit temporary verification requests', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'sansphase-reader-backup-'));
  const directory = resolve(root, 'source'), target = resolve(root, 'backup');
  try {
    await mkdir(resolve(directory, 'uploads'), { recursive: true });
    const avatar = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const db = new DatabaseSync(resolve(directory, 'content.db'));
    try {
      db.exec('CREATE TABLE media (filename TEXT); CREATE TABLE readers (avatar TEXT);');
      db.prepare('INSERT INTO readers (avatar) VALUES (?)').run(avatar);
    } finally { db.close(); }
    const temporary = new DatabaseSync(resolve(directory, 'reader-workflow.db'));
    try { temporary.exec('CREATE TABLE reader_registration_requests (email TEXT);'); }
    finally { temporary.close(); }
    await writeFile(resolve(directory, 'uploads', `reader-avatar-${avatar}.webp`), 'approved-image');
    await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
    const config = resolve(root, 'settings.json');
    await writeFile(config, JSON.stringify({ directory }));
    await run(process.execPath, ['scripts/backup-payload.mjs', target], {
      cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, PAYLOAD_CONFIG_FILE: config },
    });
    assert.equal(await readFile(resolve(target, 'uploads', `reader-avatar-${avatar}.webp`), 'utf8'), 'approved-image');
    assert(!(await readFile(resolve(target, 'backup-manifest.json'), 'utf8')).includes('reader-workflow.db'));
    const restored = resolve(root, 'restored'), restoredConfig = resolve(root, 'restored-settings.json');
    const restoreArgs = ['scripts/restore-payload.mjs', target, restored, restoredConfig];
    await run(process.execPath, restoreArgs, { cwd: resolve(import.meta.dirname, '..') });
    assert.equal(await readFile(resolve(restored, 'uploads', `reader-avatar-${avatar}.webp`), 'utf8'), 'approved-image');
    const restoredDb = new DatabaseSync(resolve(restored, 'content.db'), { readOnly: true });
    try { assert.equal(restoredDb.prepare('SELECT avatar FROM readers').get().avatar, avatar); }
    finally { restoredDb.close(); }
    assert.equal(JSON.parse(await readFile(restoredConfig, 'utf8')).directory, restored);
    await assert.rejects(run(process.execPath, restoreArgs, { cwd: resolve(import.meta.dirname, '..') }), 'existing data cannot be overwritten');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('durable profile workflow backups preserve pending images, nickname proposals and advice while removing transient authentication requests', async () => {
  const root=await mkdtemp(resolve(tmpdir(),'reader-profile-backup-')),directory=resolve(root,'source'),target=resolve(root,'backup');
  try {
    await mkdir(resolve(directory,'uploads'),{recursive:true});
    const db=new DatabaseSync(resolve(directory,'content.db')); db.exec('CREATE TABLE media(filename TEXT); CREATE TABLE readers(avatar TEXT);'); db.close();
    const workflow=createReaderWorkflow(directory,'x'.repeat(64)),pending='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    workflow.putProfile('reader','avatar',pending); const name=workflow.putProfile('reader','nickname','新昵称');
    workflow.putProfileAdvice(name.id,'reject','修改用语',{kind:'reader',id:'reviewer'});
    workflow.putRegistration({email:'temporary@example.test',nickname:'读者',phone:'13800138000',password:'password-value'});
    await writeFile(resolve(directory,'uploads',`pending-reader-avatar-${pending}.webp`),'pending-image');
    const audit='{"action":"profile-rejected","actorId":"reviewer","reason":"修改用语"}\n';
    await writeFile(resolve(directory,'reader-admin-audit.jsonl'),audit);
    await writeFile(resolve(directory,'migration-complete.json'),JSON.stringify({provider:'payload'}));
    const config=resolve(root,'settings.json'); await writeFile(config,JSON.stringify({directory}));
    await run(process.execPath,['scripts/backup-payload.mjs',target],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,PAYLOAD_CONFIG_FILE:config}});
    const manifest=JSON.parse(await readFile(resolve(target,'backup-manifest.json'),'utf8'));
    assert.equal(manifest.profileWorkflow,'durable-v1'); assert.ok(manifest.files.some(file=>file.path==='reader-workflow.db'));
    assert.ok(manifest.files.some(file=>file.path==='reader-admin-audit.jsonl'));
    assert.equal(await readFile(resolve(target,'uploads',`pending-reader-avatar-${pending}.webp`),'utf8'),'pending-image');
    const restored=resolve(root,'restored'),restoredConfig=resolve(root,'restored-settings.json');
    await run(process.execPath,['scripts/restore-payload.mjs',target,restored,restoredConfig],{cwd:resolve(import.meta.dirname,'..')});
    const recovered=createReaderWorkflow(restored,'x'.repeat(64));
    assert.equal(recovered.profileFor('reader','nickname').proposed_value,'新昵称'); assert.equal(recovered.profileAdvice(name.id)[0].reason,'修改用语');
    assert.equal(recovered.registrationByEmail('temporary@example.test'),null); assert.ok(workflow.registrationByEmail('temporary@example.test'),'backup never mutates the source');
    assert.equal(await readFile(resolve(restored,'uploads',`pending-reader-avatar-${pending}.webp`),'utf8'),'pending-image');
    assert.equal(await readFile(resolve(restored,'reader-admin-audit.jsonl'),'utf8'),audit);
    const rejectedTarget=resolve(root,'incomplete-restore'),rejectedConfig=resolve(root,'incomplete-settings.json');
    await writeFile(resolve(target,'backup-manifest.json'),JSON.stringify({...manifest,files:manifest.files.filter(file=>!file.path.startsWith('uploads/pending-reader-avatar-'))}));
    await assert.rejects(run(process.execPath,['scripts/restore-payload.mjs',target,rejectedTarget,rejectedConfig],{cwd:resolve(import.meta.dirname,'..')}),/pending avatar is missing/);
    await assert.rejects(access(rejectedTarget));await assert.rejects(access(rejectedConfig));
    await writeFile(resolve(target,'backup-manifest.json'),JSON.stringify({...manifest,profileWorkflow:'unknown-future-format'}));
    await assert.rejects(run(process.execPath,['scripts/restore-payload.mjs',target,rejectedTarget,rejectedConfig],{cwd:resolve(import.meta.dirname,'..')}),/Unsupported profile workflow backup version/);
    await assert.rejects(access(rejectedTarget));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('a missing pending-avatar file fails backup instead of declaring an incomplete workflow restorable',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'reader-backup-missing-')),directory=resolve(root,'source'),target=resolve(root,'backup');
  try {
    await mkdir(resolve(directory,'uploads'),{recursive:true});
    const db=new DatabaseSync(resolve(directory,'content.db'));db.exec('CREATE TABLE media(filename TEXT);CREATE TABLE readers(avatar TEXT);');db.close();
    const workflow=createReaderWorkflow(directory,'m'.repeat(64));workflow.putProfile('reader','avatar','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await writeFile(resolve(directory,'migration-complete.json'),JSON.stringify({provider:'payload'}));const config=resolve(root,'settings.json');await writeFile(config,JSON.stringify({directory}));
    await assert.rejects(run(process.execPath,['scripts/backup-payload.mjs',target],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,PAYLOAD_CONFIG_FILE:config}}),/ENOENT/);
    await assert.rejects(access(resolve(target,'backup-manifest.json')));
    assert.ok(workflow.profileFor('reader','avatar'));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('backup refuses old content plus a new workflow when avatar approval crosses the two snapshots',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'reader-backup-cross-snapshot-')),source=resolve(root,'source'),target=resolve(root,'backup');
  try {
    await mkdir(resolve(source,'uploads'),{recursive:true});await mkdir(target);
    const content=new DatabaseSync(resolve(source,'content.db'));content.exec('CREATE TABLE readers(id TEXT PRIMARY KEY,avatar TEXT);INSERT INTO readers VALUES(\'reader\',NULL);');content.close();
    const workflow=createReaderWorkflow(source,'g'.repeat(64)),avatar='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const pending=workflow.putProfile('reader','avatar',avatar);
    await writeFile(resolve(source,'uploads',`pending-reader-avatar-${avatar}.webp`),'image');
    const guard=createReaderProfileBackupGuard(source);
    try {
      await backup(guard.content,resolve(target,'content.db'));
      await rename(resolve(source,'uploads',`pending-reader-avatar-${avatar}.webp`),resolve(source,'uploads',`reader-avatar-${avatar}.webp`));
      const approved=new DatabaseSync(resolve(source,'content.db'));approved.prepare('UPDATE readers SET avatar=? WHERE id=?').run(avatar,'reader');approved.close();workflow.removeProfile(pending.id);
      await snapshotReaderProfileWorkflow(source,target);
      const oldContent=new DatabaseSync(resolve(target,'content.db'),{readOnly:true});assert.equal(oldContent.prepare('SELECT avatar FROM readers').get().avatar,null);oldContent.close();
      const newWorkflow=new DatabaseSync(resolve(target,'reader-workflow.db'),{readOnly:true});assert.equal(newWorkflow.prepare('SELECT COUNT(*) AS n FROM reader_profile_requests').get().n,0);newWorkflow.close();
      assert.throws(()=>guard.assertUnchanged(),/Source data changed during backup/);
    } finally {guard.close();}
  } finally {await rm(root,{recursive:true,force:true});}
});
