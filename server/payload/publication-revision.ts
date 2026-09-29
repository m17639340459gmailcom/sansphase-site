import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';

export function createPublicationRevision(directory:string) {
  // A dedicated, stable read-only connection sees commits by Payload and by
  // maintenance tools. No timestamps, TTL, or author UI callback can miss a
  // committed withdrawal. Database replacement still requires a runtime restart.
  const database=new DatabaseSync(resolve(directory,'content.db'),{readOnly:true});
  const query=database.prepare('PRAGMA data_version');
  return {read:()=>{
    const row=query.get();
    if(!row) throw Error('Unable to read database revision');
    return row.data_version;
  },close:()=>database.close()};
}
