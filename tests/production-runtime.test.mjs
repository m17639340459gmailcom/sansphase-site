import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { getPayload } from 'payload';
import { makePayloadConfig } from '../server/payload/config.ts';
import { migrateReaderAccounts } from '../server/payload/reader-migration.ts';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { DatabaseSync } from 'node:sqlite';
import { buildAdminConsole } from '../scripts/build-admin-console.ts';
import { createBuildManifest } from '../scripts/build-manifest.mjs';
import { prepareCommunityHostDirectory } from '../server/community-host-store.ts';

// Use node:http so tests exercise the reverse proxy's exact Host contract;
// browser-style fetch can replace Host when connecting to an ephemeral port.
function diagnosticRequest(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((done, reject) => {
    const call = request(base + path, { method, headers, timeout: 3000 }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('error', reject);
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, json: () => JSON.parse(text), text }));
    });
    call.on('error', reject);
    call.on('timeout', () => call.destroy(Error('Isolated diagnostics request timed out.')));
    call.end(body);
  });
}

async function verifyProductionDiagnostics(base, origin, release) {
  const localConfig = await diagnosticRequest(base, '/api/diagnostics/config');
  assert.equal(localConfig.status, 200);
  assert.equal(localConfig.json().enabled, true);
  assert.equal(localConfig.json().release, release);
  assert.equal(localConfig.json().sampleRate, 0.1);
  const host = new URL(origin).host;
  for (const endpoint of ['config', 'report']) {
    const denied = await diagnosticRequest(base, '/api/diagnostics/' + endpoint, { headers: { Host: host } });
    assert.equal(denied.status, 403, 'the public proxy cannot expose the local operator ' + endpoint);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  }
  const anonymous = { kind: 'vital', route: origin.includes('community.') ? 'community-home' : 'home', name: 'LCP', value: 1234 };
  const submitted = await diagnosticRequest(base, '/api/diagnostics/events', {
    method: 'POST', headers: { Host: host, Origin: origin, 'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.27' },
    body: JSON.stringify({ events: [anonymous] }),
  });
  assert.equal(submitted.status, 202, 'anonymous diagnostics work without account or community entry credentials');
  assert.deepEqual(submitted.json(), { accepted: 1 });
  const reportResponse = await diagnosticRequest(base, '/api/diagnostics/report');
  assert.equal(reportResponse.status, 200);
  const report = reportResponse.json();
  assert.equal(report.release, release);
  assert.equal(report.count, 1);
  assert.deepEqual(report.events.map(({ receivedAt, ...event }) => {
    assert.ok(Number.isSafeInteger(receivedAt));
    return event;
  }), [anonymous]);
  assert.deepEqual(report.summary.vitals.LCP, { count: 1, mean: 1234, max: 1234 });
  assert.equal(reportResponse.headers['cache-control'], 'private, no-store');
  assert.doesNotMatch(reportResponse.text, /198\.51\.100\.27|cookie|userAgent|password|stack/);
}

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
  const workspace=resolve('.'),local=resolve(workspace,'.local');
  await mkdir(local,{recursive:true});
  const directory=await mkdtemp(resolve(local,'production-runtime-test-'));
  const dataDirectory=resolve(directory,'data');await mkdir(dataDirectory);
  const publicDirectory=resolve(directory,'dist');await mkdir(publicDirectory);
  const secret=randomBytes(48).toString('hex');
  const settings={directory:dataDirectory,secret,authorId:randomUUID(),siteOrigin:'https://www.sansphase.com',sourceURL:'http://127.0.0.1:8055'};
  let payload,child;
  let output='';
  const invitationCode = randomBytes(18).toString('base64url');
  try {
    // Exercise the actual production entry against this run's manifest and
    // current admin generator. Never inherit the developer's stale root dist.
    // The public document is minimal here; full-site packaging has its own gate.
    await writeFile(resolve(publicDirectory,'index.html'),'<html><head></head><body>Isolated production entry</body></html>');
    await buildAdminConsole(publicDirectory);
    const manifest=await createBuildManifest(publicDirectory,'production-runtime-test');
    payload=await getPayload({config:makePayloadConfig({...settings,push:true})});
    await payload.create({collection:'site_profile',data:{name:'Production test owner'}});
    await payload.create({collection:'readers',disableVerificationEmail:true,data:{email:'inviter@example.invalid',password:'test-reader-password',nickname:'邀请读者',_verified:true,disabled:false,invitation_code:invitationCode}});
    await payload.destroy();payload.db.client.close();payload=null;
    await writeFile(resolve(dataDirectory,'migration-complete.json'),JSON.stringify({provider:'payload'}));
    await migrateReaderAccounts(dataDirectory);
    await migrateCommunity(dataDirectory);
    const config=resolve(directory,'private.json');await writeFile(config,JSON.stringify(settings),{mode:0o600});
    const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
    const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
    child=spawn(process.execPath,[resolve(workspace,'scripts/start.mjs')],{cwd:directory,env:{...process.env,NODE_ENV:'production',SITE_DIAGNOSTICS:'1',SITE_ORIGIN:settings.siteOrigin,PAYLOAD_CONFIG_FILE:config,HOST:'127.0.0.1',PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
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
    assert.equal(health?.release,manifest.release);
    assert.match(output,/"event":"ready"/);
    await verifyProductionDiagnostics(base,settings.siteOrigin,manifest.release);
    const document=await fetch(base+'/');
    assert.equal(document.status,200);assert.match(await document.text(),/Isolated production entry/);
    for(const path of ['/admin-console/','/admin-console/admin-console.js','/admin-console/admin-console.css']) {
      const asset=await fetch(base+path);assert.equal(asset.status,200,path);await asset.arrayBuffer();
    }
    assert.equal((await fetch(base+'/api/manage/readers')).status,403,'the public admin shell does not grant private account access');
    for(const path of ['/preview-login','/preview-login.js']) {
      const response=await fetch(base+path);assert.equal(response.status,404,path);await response.body?.cancel();
    }
    const previewIdentity=await fetch(base+'/api/community/preview-identity');
    assert.equal(previewIdentity.status,503,'the closed community API cannot expose its local identity picker');
    assert.equal(previewIdentity.headers.has('set-cookie'),false);
    assert.match((await previewIdentity.json()).error,/尚未开放/);
    const publicResponse=await fetch(base+'/api/content');
    assert.equal(publicResponse.status,200);
    const publicData=await publicResponse.json();
    assert.equal(publicData.profile.name,'Production test owner');
    assert.equal(publicData.communityEnabled,false,'a migrated community remains closed unless explicitly enabled');
    const invitation=await fetch(base+'/share/invite/'+invitationCode);
    assert.equal(invitation.status,200,'the formal production entry must pass runtime invitation eligibility into the share server');
    const invitationHtml=await invitation.text();
    assert.ok(invitationHtml.includes(settings.siteOrigin+'/?invite='+invitationCode+'#/account'));
    assert.ok(!invitationHtml.includes('inviter@example.invalid'),'public cards omit private reader data');
    const changed=new DatabaseSync(resolve(dataDirectory,'content.db'));
    try { changed.prepare('UPDATE readers SET disabled=1 WHERE invitation_code=?').run(invitationCode); }
    finally { changed.close(); }
    assert.equal((await fetch(base+'/share/invite/'+invitationCode)).status,404,'runtime eligibility immediately revokes a disabled reader’s public invitation');
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
    assert.equal(await realpath(directory),resolve(await realpath(local),basename(directory)));
    assert.match(basename(directory),/^production-runtime-test-/);
    await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

test('independent community production entry enables bounded diagnostics without opening private community routes', { timeout: 60000 }, async () => {
  const workspace = resolve('.'), local = resolve(workspace, '.local');
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(resolve(local, 'production-runtime-test-community-'));
  const dataDirectory = resolve(directory, 'private-community');
  const publicDirectory = resolve(directory, 'dist');
  const bridgeSecret = randomBytes(48).toString('hex');
  const settings = { directory: dataDirectory, siteOrigin: 'https://community.sansphase.com',
    mainSiteOrigin: 'https://www.sansphase.com', authorId: randomUUID(), bridgeSecret };
  let child, output = '';
  try {
    await mkdir(publicDirectory);
    await writeFile(resolve(publicDirectory, 'index.html'), '<html><head></head><body>Isolated community production entry</body></html>');
    await buildAdminConsole(publicDirectory);
    const manifest = await createBuildManifest(publicDirectory, 'production-community-diagnostics-test');
    await prepareCommunityHostDirectory(dataDirectory);
    const config = resolve(directory, 'private.json');
    await writeFile(config, JSON.stringify(settings), { mode: 0o600 });
    const socket = createServer();
    await new Promise(done => socket.listen(0, '127.0.0.1', done));
    const port = socket.address().port;
    await new Promise(done => socket.close(done));
    child = spawn(process.execPath, [resolve(workspace, 'scripts/start-community.mjs')], {
      cwd: directory, env: { ...process.env, NODE_ENV: 'production', SITE_DIAGNOSTICS: '1',
        SITE_ORIGIN: settings.siteOrigin, COMMUNITY_CONFIG_FILE: config, HOST: '127.0.0.1', PORT: String(port) },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', bytes => { output += bytes.toString(); });
    child.stderr.on('data', bytes => { output += bytes.toString(); });
    const exited = new Promise(done => child.once('close', (code, signal) => done({ code, signal })));
    const base = `http://127.0.0.1:${port}`;
    let health;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw Error('Isolated community process exited before readiness: ' + output.replaceAll(bridgeSecret, '[redacted]'));
      try {
        const response = await fetch(base + '/healthz', { signal: AbortSignal.timeout(500) });
        if (response.ok) { health = await response.json(); break; }
      } catch {}
      await pause(100);
    }
    assert.equal(health?.release, manifest.release);
    await verifyProductionDiagnostics(base, settings.siteOrigin, manifest.release);
    const community = await diagnosticRequest(base, '/api/community/summary', { headers: { Host: new URL(settings.siteOrigin).host } });
    assert.equal(community.status, 401, 'metrics opt-in must not bypass the community entry requirement');
    assert.equal(community.json().code, 'COMMUNITY_ENTRY_REQUIRED');
    assert.ok(!output.includes(bridgeSecret), 'process logs must not expose the synthetic bridge secret');
    assert.match(output, /"event":"ready"/);
    child.kill('SIGTERM'); await exited; child = null;
  } finally {
    if (child && child.exitCode === null) {
      const done = new Promise(resolve => child.once('close', resolve)); child.kill('SIGTERM'); await done;
    }
    assert.equal(await realpath(directory), resolve(await realpath(local), basename(directory)));
    assert.match(basename(directory), /^production-runtime-test-community-/);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
