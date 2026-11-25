import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { materializeFrontendV3Shared } from './frontend-v3-shared.mjs';
import { frontendV3AppPath, frontendV3ReceiptPath, createFrontendV3Receipt } from './frontend-v3-release.mjs';

const run = promisify(execFile);

export async function buildFrontendV3(output, workspace) {
  const appDirectory = resolve(workspace, frontendV3AppPath);
  const next = resolve(appDirectory, 'node_modules/next/dist/bin/next');
  const buildDirectory = '.next-release-' + randomBytes(12).toString('hex');
  await access(next).catch(cause => { throw Error('Install V3 dependencies with npm ci --prefix previews/frontend-v3.', { cause }); });
  await materializeFrontendV3Shared(appDirectory);
  try {
    await run(process.execPath, [next, 'build'], {
      cwd: appDirectory, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', SANSPHASE_V3_DIST_DIR: buildDirectory, SANSPHASE_V3_SITE_BACKEND: '', SANSPHASE_V3_LOCAL_READER_ORIGIN: '' },
    });
  } catch (error) {
    throw Error(`V3 build failed.\n${error.stdout || ''}\n${error.stderr || error.message}`);
  }
  const receipt = await createFrontendV3Receipt(appDirectory, buildDirectory);
  await writeFile(resolve(output, frontendV3ReceiptPath), JSON.stringify(receipt), { flag: 'wx' });
  return receipt;
}
