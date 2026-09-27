import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { productionOptions, verifyBuild, verifyPrivateConfig } from '../server/production-config.mjs';
import { createBuildManifest } from '../scripts/build-manifest.mjs';

test('production rejects insecure origins, public listeners and relative private paths',()=>{
  const env={NODE_ENV:'production',SITE_ORIGIN:'https://www.sansphase.com',PAYLOAD_CONFIG_FILE:resolve('private.json')};
  assert.equal(productionOptions(env).host,'127.0.0.1');
  for(const changed of [{NODE_ENV:'development'},{SITE_ORIGIN:'http://www.sansphase.com'},{SITE_ORIGIN:'https://www.sansphase.com/notes'},{SITE_ORIGIN:'https://user:pass@www.sansphase.com'},{HOST:'0.0.0.0'},{PORT:'NaN'},{PAYLOAD_CONFIG_FILE:'.local/private.json'}])
    assert.throws(()=>productionOptions({...env,...changed}));
});

test('release checksum rejects modified files and private data under dist',async t=>{
  const root=await mkdtemp(resolve(tmpdir(),'sansphase-release-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dist=resolve(root,'dist'),data=resolve(root,'data');
  await mkdir(dist);await mkdir(data);
  await writeFile(resolve(dist,'index.html'),'<h1>SANSPHASE</h1>');
  const first=await createBuildManifest(dist,'test');
  assert.equal((await verifyBuild(dist)).release,first.release);
  const second=await createBuildManifest(dist,'test');
  assert.equal(second.release,first.release,'identical output has identical release identity');
  await writeFile(resolve(dist,'index.html'),'<h1>changed</h1>');
  await assert.rejects(verifyBuild(dist),/verification failed/);
  const config=resolve(root,'private.json');
  const settings={directory:data,secret:'test-only-'.repeat(5),authorId:'test-owner'};
  await writeFile(config,JSON.stringify(settings));
  assert.equal((await verifyPrivateConfig(config,dist)).authorId,'test-owner');
  await writeFile(config,JSON.stringify({...settings,directory:dist}));
  await assert.rejects(verifyPrivateConfig(config,dist),/public directory/);
  await writeFile(resolve(dist,'private.json'),JSON.stringify(settings));
  await assert.rejects(verifyPrivateConfig(resolve(dist,'private.json'),dist),/public directory/);
});
