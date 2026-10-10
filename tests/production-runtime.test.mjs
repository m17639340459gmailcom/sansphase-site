import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { migrateReaderAccounts } from '../server/payload/reader-migration.ts';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { DatabaseSync } from 'node:sqlite';

test('production startup rejects an unprepared auth schema before opening the account runtime', {timeout:30000}, async()=>{
  const directory=await mkdtemp(resolve(tmpdir(),'sansphase-auth-readiness-'));
  const dataDirectory=resolve(directory,'data');await mkdir(dataDirectory);
  const dbPath=resolve(dataDirectory,'content.db');
  const db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE authors (id TEXT PRIMARY KEY, email TEXT); CREATE TABLE readers (id TEXT PRIMARY KEY, email TEXT); INSERT INTO authors VALUES ('fixture-author','owner@example.test');");
  db.close();
  const before=await readFile(dbPath);
  const config=resolve(directory,'private.json');
  await writeFile(config,JSON.stringify({directory:dataDirectory,secret:randomBytes(48).toString('hex'),authorId:randomUUID(),siteOrigin:'https://www.sansphase.com'}));
  await writeFile(resolve(dataDirectory,'migration-complete.json'),JSON.stringify({provider:'payload'}));
  try {
    const result=await new Promise((done,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',"import {createPayloadRuntime} from './server/payload/runtime.ts'; await createPayloadRuntime(process.argv[1]);",config],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
      child.on('error',reject);child.on('close',code=>done({code,output}));
    });
    assert.notEqual(result.code,0);
    assert.match(result.output,/auth.*schema.*(?:ready|prepared|migration)|(?:ready|prepared|migration).*auth.*schema/is);
    assert.deepEqual(await readFile(dbPath),before,'failed readiness must not change account data');
  } finally { await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
});

test('production entry starts with an isolated restored database and exposes only public routes',{timeout:60000},async()=>{
  const directory=await mkdtemp(resolve(tmpdir(),'sansphase-production-'));
  const dataDirectory=resolve(directory,'data');await mkdir(dataDirectory);
  const secret=randomBytes(48).toString('hex');
  const settings={directory:dataDirectory,secret,authorId:randomUUID(),siteOrigin:'https://www.sansphase.com',sourceURL:'http://127.0.0.1:8055'};
  let payload,child;
  let output='';
  try {
    payload=await getPayload({config:makePayloadConfig({...settings,push:true})});
    await payload.create({collection:'site_profile',data:{name:'Production test owner'}});
    await payload.destroy();payload.db.client.close();payload=null;
    await writeFile(resolve(dataDirectory,'migration-complete.json'),JSON.stringify({provider:'payload'}));
    await migrateReaderAccounts(dataDirectory);
    await migrateCommunity(dataDirectory);
    const config=resolve(directory,'private.json');await writeFile(config,JSON.stringify(settings),{mode:0o600});
    const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
    const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
    child=spawn(process.execPath,['scripts/start.mjs'],{env:{...process.env,NODE_ENV:'production',SITE_ORIGIN:settings.siteOrigin,PAYLOAD_CONFIG_FILE:config,HOST:'127.0.0.1',PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',bytes=>{output+=bytes.toString();});
    child.stderr.on('data',bytes=>{output+=bytes.toString();});
    const exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    const base=`http://127.0.0.1:${port}`;
    let health;
    for(let attempt=0;attempt<100;attempt++) {
      if(child.exitCode!==null) throw Error('Production process exited before readiness: '+output.replaceAll(secret,'[redacted]'));
      try {const response=await fetch(base+'/healthz',{signal:AbortSignal.timeout(500)});if(response.ok){health=await response.json();break;}} catch {}
      await pause(100);
    }
    const manifest=JSON.parse(await readFile('dist/build-info.json','utf8'));
    assert.equal(health?.release,manifest.release);
    const publicResponse=await fetch(base+'/api/content');
    assert.equal(publicResponse.status,200);
    const publicData=await publicResponse.json();
    assert.equal(publicData.profile.name,'Production test owner');
    assert.equal(publicData.communityEnabled,false,'a migrated community remains closed unless explicitly enabled');
    const community=await fetch(base+'/api/community/summary');
    assert.equal(community.status,503);
    assert.match((await community.json()).error,/尚未开放/);
    for(const path of ['/.local/payload-env.json','/server.mjs','/package.json','/api/debug']) {
      const response=await fetch(base+path);assert.equal(response.status,404,path);await response.body?.cancel();
    }
    const upload=await fetch(base+'/api/author/upload',{method:'POST',headers:{Origin:settings.siteOrigin,'X-Author-Request':'1'}});
    assert.equal(upload.status,401);await upload.body?.cancel();
    assert.ok(!output.includes(secret),'logs must not contain the private secret');
    child.kill('SIGTERM');await exited;child=null;
  } finally {
    if(child && child.exitCode===null) {const done=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await done;}
    if(payload){await payload.destroy();payload.db.client.close();}
    await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
