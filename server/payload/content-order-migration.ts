import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

// Explicit, additive upgrade. Normal startup retains push:false.
export async function migrateContentOrder(directory:string) {
  const database=resolve(directory,'content.db');await stat(database);
  const db=new DatabaseSync(database);
  try {
    const columns=db.prepare('PRAGMA table_info(site_profile)').all();
    if(!columns.some(c=>c.name==='name')||!columns.some(c=>c.name==='id'))throw Error('Expected the existing Payload site_profile table.');
    const existing=columns.find(c=>c.name==='content_order');
    if(existing){if(String(existing.type).toUpperCase()!=='TEXT')throw Error('Unexpected content_order column type.');return {changed:false};}
    const backups=resolve(directory,'schema-backups');await mkdir(backups,{recursive:true});
    const snapshot=resolve(backups,'before-content-order-'+Date.now()+'-'+randomUUID()+'.db');
    await backup(db,snapshot);
    db.exec('BEGIN IMMEDIATE');
    try {db.exec('ALTER TABLE site_profile ADD COLUMN content_order TEXT');db.exec('COMMIT');}
    catch(error){db.exec('ROLLBACK');throw error;}
    return {changed:true,backup:snapshot};
  } finally {db.close();}
}
