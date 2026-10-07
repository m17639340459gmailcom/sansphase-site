import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Payload } from 'payload';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { createReaderProfileCommands } from '../server/reader-profile-commands.ts';

const run=promisify(execFile);
// The last committed release implementation is exercised without modifying it.
// Relative policy/file helpers resolve to formal source; the two old profile
// decision/schema modules themselves come verbatim from the pinned Git object.
const previousRelease='43737fb1bfb24c47b25a5ca2e5d38fd25d700852';

test('previous release opens the wider workflow without narrowing it and refuses nickname decisions',async t=>{
  const project=resolve(import.meta.dirname,'..');
  try {await run('git',['cat-file','-e',`${previousRelease}^{commit}`],{cwd:project});}
  catch {t.skip('Previous-release Git object is absent from this exported/shallow checkout; run the forensic rollback check from the complete formal source checkout.');return;}
  const local=resolve(project,'.local');await mkdir(local,{recursive:true});
  const directory=await mkdtemp(resolve(local,'profile-rollback-check-'));
  t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const storage=resolve(directory,'data');await mkdir(storage);
  for(const name of ['reader-workflow.ts','reader-profile-commands.ts']) {
    const {stdout}=await run('git',['show',`${previousRelease}:server/${name}`],{cwd:project});
    const source=stdout.replace(/from '(\.\/[a-z-]+\.ts)'/g,(_,reference:string)=>`from '${pathToFileURL(resolve(project,'server',reference)).href}'`);
    await writeFile(resolve(directory,name),source);
  }
  const workflow=createReaderWorkflow(storage,'r'.repeat(64)),readerId=randomUUID(),row={id:readerId,nickname:'已批准',signature:'原个签',avatar:null,_verified:true,disabled:false};
  const proposal=workflow.putProfile(readerId,'nickname','待审昵称');workflow.putProfileAdvice(proposal.id,'reject','修改用语',{kind:'owner',id:randomUUID()});
  let writes=0;
  const payload={findByID:async()=>({...row}),update:async()=>{writes++;throw Error('old approval must never write');}} as unknown as Payload;
  const oldWorkflowModule=await import(pathToFileURL(resolve(directory,'reader-workflow.ts')).href) as {createReaderWorkflow:typeof createReaderWorkflow};
  const oldCommandsModule=await import(pathToFileURL(resolve(directory,'reader-profile-commands.ts')).href) as {createReaderProfileCommands:typeof createReaderProfileCommands};
  const legacyWorkflow=oldWorkflowModule.createReaderWorkflow(storage,'r'.repeat(64));
  const legacy=oldCommandsModule.createReaderProfileCommands({payload,directory:storage,workflow:legacyWorkflow,uidStore:{get:()=> '10001'}});
  assert.deepEqual(await legacy.reviews(),[]);
  await assert.rejects(legacy.review(proposal.id,'approve',{kind:'owner',id:randomUUID(),source:'main'}),{status:403});
  await assert.rejects(legacy.review(proposal.id,'reject',{kind:'owner',id:randomUUID(),source:'main'}),{status:403});
  assert.equal(writes,0);assert.equal(workflow.profile(proposal.id)?.proposed_value,'待审昵称');assert.equal(workflow.profileAdvice(proposal.id)[0].reason,'修改用语');
  const db=new DatabaseSync(resolve(storage,'reader-workflow.db'),{readOnly:true});
  try {assert.match(String(db.prepare("SELECT sql FROM sqlite_master WHERE name='reader_profile_requests'").get()?.sql),/'nickname'/);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='reader_profile_advice'").get());}
  finally {db.close();}
});
