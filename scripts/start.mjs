import { resolve } from 'node:path';
import { productionOptions, verifyBuild, verifyPrivateConfig } from '../server/production-config.mjs';
import { createPayloadRuntime } from '../server/payload/runtime.mjs';
import { createPreviewServer } from '../server.mjs';

// The production entry never initializes a database or falls back to fixtures.
const options=productionOptions(process.env);
const root=resolve('dist');
const manifest=await verifyBuild(root);
await verifyPrivateConfig(options.configPath,root);
const runtime=await createPayloadRuntime(options.configPath);
await runtime.healthCheck();
const log=event=>process.stdout.write(JSON.stringify({...event,at:new Date().toISOString()})+'\n');
const server=createPreviewServer({...runtime,root,release:manifest.release,requestLogger:log});
server.on('error',async error=>{
  log({event:'server-error',code:error.code||'SERVER_ERROR'});
  await runtime.close();
  process.exitCode=1;
});
server.listen(options.port,options.host,()=>log({event:'ready',release:manifest.release,origin:options.origin}));
let closing=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  if(closing) return;
  closing=true;
  log({event:'shutdown',signal});
  server.close(async()=>{
    await runtime.close();
    process.exitCode=0;
  });
  server.closeIdleConnections();
});
