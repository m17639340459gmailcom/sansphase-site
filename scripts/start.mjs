import { resolve } from 'node:path';
import { productionOptions, productionDiagnosticsEnabled, verifyBuild, verifyPrivateConfig } from '../server/production-config.ts';
import { createProductionDiagnostics } from '../server/production-diagnostics.ts';
import { createPayloadRuntime } from '../server/payload/runtime.ts';
import { createPreviewServer } from '../server.mjs';
import { createFrontendV2Middleware } from '../server/frontend-v2.ts';
import { openFrontendV3 } from '../server/frontend-v3.ts';
import { frontendVersion, verifyFrontendBuild } from './frontend-selection.mjs';

// The production entry never initializes a database or falls back to fixtures.
const options=productionOptions(process.env);
const frontend=frontendVersion(process.env.SITE_FRONTEND);
const diagnosticsEnabled=productionDiagnosticsEnabled(process.env);
const root=resolve('dist');
const manifest=await verifyBuild(root);
const frontendRelease=await verifyFrontendBuild(root,manifest,frontend);
await verifyPrivateConfig(options.configPath,root);
const runtime=await createPayloadRuntime(options.configPath);
await runtime.healthCheck();
const log=event=>process.stdout.write(JSON.stringify({...event,at:new Date().toISOString()})+'\n');
const diagnosticsService=diagnosticsEnabled ? createProductionDiagnostics({ origin:options.origin,port:options.port,release:manifest.release }) : undefined;
let v3;
if (frontend === 'v3') {
  process.env.SANSPHASE_V3_DIST_DIR = frontendRelease.buildDirectory;
  process.env.SANSPHASE_V3_SITE_BACKEND = options.origin;
  delete process.env.SANSPHASE_V3_LOCAL_READER_ORIGIN;
  try {
    v3=await openFrontendV3({appDirectory:frontendRelease.appDirectory,origin:options.origin});
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
const requestMiddleware=frontend==='v2'
  ? createFrontendV2Middleware({origin:options.origin,generatedRoot:resolve(root,'frontend-v2'),allowOriginal:true}) : v3?.middleware;
const closeRuntime=async()=>{try{await v3?.close();}finally{await runtime.close();}};
const server=createPreviewServer({...runtime,root,release:manifest.release,requestLogger:log,diagnosticsService,requestMiddleware,mainFrontend:frontend});
server.on('error',async error=>{
  log({event:'server-error',code:error.code||'SERVER_ERROR'});
  await closeRuntime();
  process.exitCode=1;
});
server.listen(options.port,options.host,()=>log({event:'ready',release:manifest.release,origin:options.origin}));
runtime.readerRetention.start();
let closing=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  if(closing) return;
  closing=true;
  log({event:'shutdown',signal});
  server.close(async()=>{
    await closeRuntime();
    process.exitCode=0;
  });
  server.closeIdleConnections();
});
