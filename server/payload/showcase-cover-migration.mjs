import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

// Explicit additive migration; normal Payload startup keeps push:false.
export async function migrateShowcaseCover(directory) {
 const database=resolve(directory,'content.db');await stat(database);
 const db=new DatabaseSync(database);
 try {
  const additions=[];
  for(const [table,column,required] of [['library_entries','showcase_cover','cover'],['_library_entries_v','version_showcase_cover','version_cover']]) {
   const fields=db.prepare(`PRAGMA table_info("${table}")`).all();
   if(!fields.some(f=>f.name===required))throw Error(`Unexpected schema: ${table}`);
   const present=fields.find(f=>f.name===column);
   if(present && present.type.toUpperCase()!=='TEXT')throw Error(`Unexpected column type: ${column}`);
   if(!present)additions.push(`ALTER TABLE "${table}" ADD COLUMN "${column}" TEXT`);
  }
  if(!additions.length)return {changed:false};
  const root=resolve(directory,'schema-backups');await mkdir(root,{recursive:true});
  const snapshot=resolve(root,`before-showcase-${Date.now()}-${randomUUID()}.db`);await backup(db,snapshot);
  db.exec('BEGIN IMMEDIATE');
  try {for(const sql of additions)db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return {changed:true,backup:snapshot};
 }finally {db.close();}
}
