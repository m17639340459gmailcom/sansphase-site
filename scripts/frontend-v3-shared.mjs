import { copyFile, mkdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
export const frontendV3SharedFiles = [
  'admin-console-navigation.mjs', 'admin-console-navigation.ts',
  'book-image-viewer.mjs', 'book-progress.ts',
  'core.mjs', 'core.ts',
  'image-compression-library.mjs', 'image-compression-library.ts',
  'login-verification-control.mjs', 'login-verification-control.ts',
  'login-verification-library.mjs', 'login-verification-library.ts',
  'login-verification.mjs', 'login-verification.ts', 'login-verification.css',
  'reader-membership.mjs', 'reader-membership.ts',
  'reader-policy.mjs', 'reader-policy.ts',
  'section-reading-position.mjs',
  'upload-image-metadata.mjs', 'upload-image-metadata.ts',
  'upload-image.mjs', 'upload-image.ts', 'upload-policy.mjs',
];

// The root src/ files remain the source of truth for both frontends.
export async function materializeFrontendV3Shared(appDirectory = resolve(repository, 'previews/frontend-v3')) {
  for (const path of ['src', 'src/shared', 'src/shared/site']) {
    const folder = resolve(appDirectory, path);
    const info = await lstat(folder).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!info) await mkdir(folder);
    else if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsafe shared V3 source directory');
  }
  const target = resolve(appDirectory, 'src/shared/site');
  for (const name of frontendV3SharedFiles) {
    const destination = resolve(target, name);
    const metadata = await lstat(destination).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) throw Error('Unsafe shared V3 source file');
    await copyFile(resolve(repository, 'src', name), destination);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await materializeFrontendV3Shared(process.argv[2]);
}
