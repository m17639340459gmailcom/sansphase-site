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
import { makePayloadConfig } from '../server/payload/config.mjs';

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
    assert.equal(publicResponse.status,200);assert.equal((await publicResponse.json()).profile.name,'Production test owner');
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
