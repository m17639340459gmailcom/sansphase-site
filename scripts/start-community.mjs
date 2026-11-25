import { resolve } from 'node:path';
import { productionDiagnosticsEnabled, verifyBuild } from '../server/production-config.ts';
import { createProductionDiagnostics } from '../server/production-diagnostics.ts';
import { communityHostProductionOptions, createCommunityHostRuntime, readCommunityHostConfig } from '../server/community-host-runtime.ts';
import { prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { prepareTeahouseDirectory } from '../server/teahouse-store.ts';
import { createPreviewServer } from '../server.mjs';

// Provisioning is explicit and does not require a main-site Payload secret.
// Production startup always refuses to create or migrate a database.
const options = communityHostProductionOptions(process.env);
const diagnosticsEnabled = productionDiagnosticsEnabled(process.env);
const root = resolve('dist');
const manifest = await verifyBuild(root);
if (process.argv.includes('--prepare')) {
  // A new data directory may be absent before preparation. Only this explicit
  // maintenance mode reads the minimal config without normal startup checks.
  const { readFile, lstat } = await import('node:fs/promises');
  const { isAbsolute, sep } = await import('node:path');
  const configStat = await lstat(options.configPath);
  if (!configStat.isFile() || configStat.isSymbolicLink() || process.platform !== 'win32' && (configStat.mode & 0o077)) throw Error('Private community config required.');
  const settings = JSON.parse(await readFile(options.configPath, 'utf8'));
  const data = settings.directory;
  if (!data || !isAbsolute(data) || resolve(data) === root || resolve(data).startsWith(root + sep) || settings.siteOrigin !== options.origin || settings.mainSiteOrigin !== 'https://www.sansphase.com' || !settings.bridgeSecret || Buffer.byteLength(settings.bridgeSecret) < 32 || !settings.authorId || settings.secret || settings.payload) throw Error('Invalid independent community preparation config.');
  console.log(JSON.stringify(await prepareCommunityHostDirectory(data)));
  process.exit(0);
}
const config = await readCommunityHostConfig(options.configPath, root);
if (process.argv.includes('--prepare-teahouse')) {
  if (!config.teahouse?.enabled) throw Error('Explicit enabled teahouse configuration is required for preparation.');
  prepareTeahouseDirectory(config.teahouse.directory);
  console.log(JSON.stringify({ prepared: 'teahouse', initialized: true }));
  process.exit(0);
}
const runtime = createCommunityHostRuntime(config);
try { await runtime.healthCheck(); await runtime.drainFileQueue(); }
catch (error) { await runtime.close(); throw error; }
const log = event => process.stdout.write(JSON.stringify({ ...event, at: new Date().toISOString() }) + '\n');
const diagnosticsService = diagnosticsEnabled ? createProductionDiagnostics({ origin: options.origin, port: options.port, release: manifest.release }) : undefined;
const server = createPreviewServer({ ...runtime, root, release: manifest.release, requestLogger: log, diagnosticsService });
try { await runtime.attachTeahouse(server); }
catch (error) { await runtime.close(); throw error; }
server.on('error', error => {
  log({ event: 'server-error', code: error.code || 'SERVER_ERROR' });
  process.exitCode = 1;
  void runtime.close().catch(() => { log({ event: 'shutdown-error' }); });
});
server.listen(options.port, options.host, () => log({ event: 'ready', release: manifest.release, origin: options.origin, communityOnly: true }));
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  log({ event: 'shutdown', signal });
  try {
    try { await runtime.closeTeahouse(); }
    finally {
      if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      await runtime.close();
    }
    process.exitCode = 0;
  } catch { log({ event: 'shutdown-error' }); process.exitCode = 1; }
});
