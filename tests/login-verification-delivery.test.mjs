import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPreviewServer} from '../server.mjs';
test('slider ships a lazy local adapter without old computation workers or remote images',async t=>{
 const manifest=JSON.parse(await readFile('dist/build-info.json','utf8')),html=await readFile('dist/index.html','utf8');
 // The shared reader form imports the small control and request adapter, so
 // production's modulepreload graph may include those two modules. Only the
 // interactive puzzle must stay out of the initial graph, including on CDN.
 assert.doesNotMatch(html,/(?:src|href)=["'][^"']*(?:altcha|login-verification-library\.mjs)/i);
 const meta=JSON.parse(await readFile('outputs/verification/library-build-meta.json','utf8'));
 const library=Object.entries(meta.outputs).find(([p])=>p.endsWith('/login-verification-library.mjs'));assert.ok(library);
 const closure=(p,seen=new Set())=>{if(seen.has(p))return seen;seen.add(p);for(const e of meta.outputs[p]?.imports||[])if(e.kind==='import-statement')closure(e.path,seen);return seen;};
 for(const [p,out] of Object.entries(meta.outputs)){
  if(!out.entryPoint||/login-verification-library\.(?:ts|mjs)$/.test(out.entryPoint))continue;
  for(const dependency of closure(p))assert.equal(Object.keys(meta.outputs[dependency]?.inputs||{}).some(input=>input.endsWith('/login-verification-library.ts')),false,p+' must not eagerly load puzzle UX');
 }
 for(const [p,out] of Object.entries(meta.outputs))if(p!==library[0])for(const e of out.imports||[])if(e.path.endsWith('/login-verification-library.mjs'))assert.equal(e.kind,'dynamic-import',p);
 assert.equal(manifest.files.some(f=>/login-verification-(?:pbkdf2|sha)\.worker/.test(f.path)),false,'retired ALTCHA outputs are not copied');
 assert.ok(manifest.files.some(f=>f.path==='login-verification.css'));
 const server=createPreviewServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const origin='http://127.0.0.1:'+server.address().port;
 for(const p of ['login-verification.mjs','login-verification-control.mjs','login-verification-library.mjs','login-verification.css']){
  const res=await fetch(origin+'/'+p);assert.equal(res.status,200,p);assert.match(res.headers.get('content-type'),p.endsWith('.css')?/text\/css/:/javascript/);assert.ok((await res.arrayBuffer()).byteLength>0);
 }
 for(const name of ['reader.css','author.css'])assert.match(await readFile('dist/'+name,'utf8'),/login-verification\.css/);
 const inputs=Object.keys(meta.inputs);assert.equal(inputs.some(p=>/node_modules\/.*altcha/.test(p)),false);
});
