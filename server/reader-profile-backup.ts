import { chmod, lstat } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const avatar = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fingerprint = (path: string) => {
  try {
    const file=lstatSync(path);
    if(!file.isFile() || file.isSymbolicLink()) throw Error('Backup source must be a regular private file.');
    return `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
  } catch(error) {if(error && typeof error==='object' && 'code' in error && error.code==='ENOENT')return null;throw error;}
};
/** Keep the same observer connections alive across both snapshots and copying.
 * This is a conservative consistency check, not an atomic two-database backup.
 * A commit anywhere during the backup makes the caller retry without a success
 * manifest, including profile approvals between the two SQLite snapshots.
 */
export function createReaderProfileBackupGuard(source: string) {
  const contentPath=resolve(source,'content.db'),workflowPath=resolve(source,'reader-workflow.db'),auditPath=resolve(source,'reader-admin-audit.jsonl');
  const contentFile=fingerprint(contentPath),workflowFile=fingerprint(workflowPath),auditFile=fingerprint(auditPath);
  if(contentFile===null) throw Error('The content database is missing.');
  const content=new DatabaseSync(contentPath,{readOnly:true});let workflow: DatabaseSync | undefined;
  try {
    if(workflowFile!==null)workflow=new DatabaseSync(workflowPath,{readOnly:true});
    const contentVersion=content.prepare('PRAGMA data_version').get()?.data_version,workflowVersion=workflow?.prepare('PRAGMA data_version').get()?.data_version;
    return {
      content,
      assertUnchanged() {
        if(content.prepare('PRAGMA data_version').get()?.data_version!==contentVersion
          || workflow?.prepare('PRAGMA data_version').get()?.data_version!==workflowVersion
          || fingerprint(contentPath)!==contentFile || fingerprint(workflowPath)!==workflowFile || fingerprint(auditPath)!==auditFile)
          throw Error('Source data changed during backup; retry in a quiet window.');
      },
      close() {workflow?.close();content.close();},
    };
  } catch(error) {workflow?.close();content.close();throw error;}
}
function pendingAvatars(db: DatabaseSync) {
  const values = db.prepare("SELECT proposed_value FROM reader_profile_requests WHERE kind='avatar'").all() as Array<{proposed_value:string}>;
  if (values.some(row => !avatar.test(row.proposed_value))) throw Error('Profile backup contains an invalid pending avatar reference.');
  return [...new Set(values.map(row => row.proposed_value))];
}
/** Persist profiles/retry jobs without reviving expired verification or auth limits. */
export async function snapshotReaderProfileWorkflow(source: string, destination: string) {
  const path = resolve(source,'reader-workflow.db');
  try { const file=await lstat(path); if (!file.isFile() || file.isSymbolicLink()) throw Error('Profile workflow must be a regular private file.'); }
  catch(error) { if(error && typeof error==='object' && 'code' in error && error.code==='ENOENT') return null; throw error; }
  const original=new DatabaseSync(path,{readOnly:true});
  try {
    if(!original.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reader_profile_requests'").get()) return null;
    await backup(original,resolve(destination,'reader-workflow.db'));
    if(process.platform!=='win32') await chmod(resolve(destination,'reader-workflow.db'),0o600);
  } finally {original.close();}
  const snapshot=new DatabaseSync(resolve(destination,'reader-workflow.db'));
  try {
    snapshot.exec('BEGIN IMMEDIATE');
    for(const table of ['reader_registration_requests','reader_auth_attempts']) if(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) snapshot.exec(`DELETE FROM ${table}`);
    snapshot.exec('COMMIT');
    if(snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok') throw Error('Profile workflow backup integrity failed.');
    return pendingAvatars(snapshot);
  } finally {snapshot.close();}
}
export function verifyReaderProfileWorkflowSnapshot(directory: string, files: readonly {path:string}[]) {
  const paths=new Set(files.map(file=>file.path));
  if(!paths.has('reader-workflow.db')) throw Error('Durable profile workflow backup is incomplete.');
  const db=new DatabaseSync(resolve(directory,'reader-workflow.db'),{readOnly:true});
  try {
    if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok' || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reader_profile_requests'").get()) throw Error('Profile workflow snapshot is invalid.');
    for(const id of pendingAvatars(db)) if(!paths.has(`uploads/pending-reader-avatar-${id}.webp`)) throw Error('A pending avatar is missing from the profile backup.');
    for(const table of ['reader_registration_requests','reader_auth_attempts']) if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      && Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n)!==0) throw Error('Profile snapshot must not restore transient authentication requests.');
  } finally {db.close();}
}
