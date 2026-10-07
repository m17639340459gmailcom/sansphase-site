import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateReaderProfileWorkflow } from '../server/reader-profile-workflow-migration.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';

test('existing profile workflow requires explicit backed-up migration and retains rows, custom columns, indexes and triggers', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'reader-profile-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, 'reader-workflow.db'), db = new DatabaseSync(path);
  db.exec(`CREATE TABLE reader_profile_requests(id TEXT PRIMARY KEY,reader_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('avatar','signature')),proposed_value TEXT NOT NULL,created_at TEXT NOT NULL,extra TEXT,UNIQUE(reader_id,kind));
    CREATE INDEX private_profile_extra ON reader_profile_requests(extra);
    CREATE TABLE private_profile_updates(id TEXT);
    CREATE TRIGGER private_profile_trigger AFTER UPDATE OF extra ON reader_profile_requests BEGIN INSERT INTO private_profile_updates VALUES(NEW.id); END;`);
  db.prepare('INSERT INTO reader_profile_requests VALUES(?,?,?,?,?,?)').run('old', 'reader', 'signature', '原签名', '2026-10-07', 'keep'); db.close();
  const workflow = createReaderWorkflow(directory, 'a'.repeat(64));
  assert.throws(() => workflow.putProfile('reader', 'nickname', '新昵称'), { status: 503 });
  const before = new DatabaseSync(path, { readOnly: true });
  assert.equal(before.prepare("SELECT 1 FROM sqlite_master WHERE name='reader_profile_advice'").get(), undefined); before.close();
  assert.equal((await migrateReaderProfileWorkflow(directory)).changed, true);
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1);
  const upgraded = new DatabaseSync(path);
  assert.equal(upgraded.prepare('SELECT proposed_value,extra FROM reader_profile_requests WHERE id=?').get('old')?.extra, 'keep');
  assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE name='private_profile_extra'").get());
  upgraded.prepare('UPDATE reader_profile_requests SET extra=? WHERE id=?').run('changed', 'old');
  assert.equal(upgraded.prepare('SELECT id FROM private_profile_updates').get()?.id, 'old'); upgraded.close();
  workflow.putProfile('reader', 'nickname', '新昵称');
  assert.equal((await migrateReaderProfileWorkflow(directory)).changed, false);
  assert.equal((await readdir(resolve(directory, 'schema-backups'))).length, 1);
});

test('profile migration preserves foreign-key dependants without deleting their rows', async t => {
  const directory=await mkdtemp(resolve(tmpdir(),'reader-profile-related-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=resolve(directory,'reader-workflow.db'),db=new DatabaseSync(path);
  db.exec(`CREATE TABLE reader_profile_requests(id TEXT PRIMARY KEY,reader_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('avatar','signature')),proposed_value TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(reader_id,kind));
    CREATE TABLE private_profile_references(profile_id TEXT REFERENCES reader_profile_requests(id) ON DELETE CASCADE,note TEXT);
    INSERT INTO reader_profile_requests VALUES('old','reader','signature','原签名','2026-10-07');
    INSERT INTO private_profile_references VALUES('old','preserve');`);db.close();
  await migrateReaderProfileWorkflow(directory);
  const result=new DatabaseSync(path);
  try {assert.equal(result.prepare('SELECT note FROM private_profile_references').get()?.note,'preserve');assert.deepEqual(result.prepare('PRAGMA foreign_key_check').all(),[]);}
  finally {result.close();}
});

test('replacing a proposal and removing its advice is one atomic workflow mutation', async t => {
  const directory=await mkdtemp(resolve(tmpdir(),'reader-profile-atomic-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const workflow=createReaderWorkflow(directory,'z'.repeat(64)),old=workflow.putProfile('reader','nickname','旧申请');
  workflow.putProfileAdvice(old.id,'reject','修改用语',{kind:'reader',id:'reviewer'});
  const db=new DatabaseSync(resolve(directory,'reader-workflow.db'));
  db.exec("CREATE TRIGGER fail_advice_cleanup BEFORE DELETE ON reader_profile_advice BEGIN SELECT RAISE(ABORT,'test cleanup unavailable'); END;");db.close();
  assert.throws(()=>workflow.putProfile('reader','nickname','新申请'),/test cleanup unavailable/);
  assert.equal(workflow.profileFor('reader','nickname')?.id,old.id);
  assert.equal(workflow.profileAdvice(old.id).length,1);
});
