import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {validateArticle} from '../server/author-service.ts';
import {migrateShowcaseCover} from '../server/payload/showcase-cover-migration.mjs';
test('separate showcase cover validates only supported catalogs, including explicit clearing',()=>{
 const value={title:'Test',slug:'test',showcase_cover:'10000000-0000-4000-8000-000000000001'};
 for(const kind of ['works','resources']) {
  assert.equal(validateArticle(value,kind).showcase_cover,value.showcase_cover);
  assert.equal(validateArticle({...value,showcase_cover:null},kind).showcase_cover,null);
  assert.throws(()=>validateArticle({...value,showcase_cover:'https://example.com'},kind));
 }
 assert.equal(validateArticle(value,'software').showcase_cover,undefined);
 assert.equal(validateArticle({title:'Test',slug:'test'},'works').showcase_cover,undefined,'old clients must not clear a newly uploaded image');
});
test('showcase schema migration preserves live and historical content and is repeatable',async t=>{
 const dir=await mkdtemp(resolve(tmpdir(),'showcase-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const db=new DatabaseSync(resolve(dir,'content.db'));
 db.exec("CREATE TABLE library_entries (id TEXT PRIMARY KEY, cover TEXT); CREATE TABLE _library_entries_v (id INTEGER PRIMARY KEY, version_cover TEXT); INSERT INTO library_entries VALUES ('entry','image'); INSERT INTO _library_entries_v VALUES (1,'old-image');");db.close();
 const result=await migrateShowcaseCover(dir);assert(result.changed);
 const after=new DatabaseSync(resolve(dir,'content.db'));
 assert.deepEqual({...after.prepare('SELECT * FROM library_entries').get()},{id:'entry',cover:'image',showcase_cover:null});
 assert.equal(after.prepare('SELECT version_cover FROM _library_entries_v').get().version_cover,'old-image');after.close();
 assert.equal((await migrateShowcaseCover(dir)).changed,false);
});
