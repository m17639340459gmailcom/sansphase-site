import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {migrateContentOrder} from '../server/payload/content-order-migration.mjs';
test('order migration backs up the old schema, preserves data, and is idempotent',async t=>{
  const dir=await mkdtemp(resolve(tmpdir(),'sansphase-order-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await assert.rejects(migrateContentOrder(dir),{code:'ENOENT'});
  const path=resolve(dir,'content.db'),db=new DatabaseSync(path);
  db.exec("CREATE TABLE site_profile (id TEXT PRIMARY KEY, name TEXT, appearance TEXT); INSERT INTO site_profile VALUES ('owner','Author','{\"accent\":\"blue\"}');");db.close();
  const result=await migrateContentOrder(dir);assert(result.changed);
  const old=new DatabaseSync(result.backup,{readOnly:true});
  assert.equal(old.prepare('PRAGMA table_info(site_profile)').all().length,3);old.close();
  const migrated=new DatabaseSync(path);const row=migrated.prepare('SELECT * FROM site_profile').get();
  assert.equal(row.name,'Author');assert.equal(row.appearance,'{"accent":"blue"}');assert.equal(row.content_order,null);migrated.close();
  assert.deepEqual(await migrateContentOrder(dir),{changed:false});
});
