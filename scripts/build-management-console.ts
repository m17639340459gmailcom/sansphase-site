import { build, type BuildResult } from 'esbuild';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preserveBrowserPackageNotices } from './browser-package-notices.ts';
import { adminConsoleDocument } from '../server/admin-console-assets.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));
type ConsoleName = 'admin-console' | 'community-console';

/** Shared packaging only; each console retains its own identity and API adapter. */
export async function buildManagementConsole(
  name: ConsoleName, outputRoot: string, preview: boolean, redesign = false, v3Integrated = false,
): Promise<BuildResult<{ metafile: true }>> {
  const root = await realpath(outputRoot), source = await realpath(repository);
  if (!root.startsWith(source + sep)) throw Error('Management console output must remain inside the source workspace.');
  const output = resolve(root, name);
  await mkdir(output); // Deliberately refuse to overwrite an existing console.
  const productionV3 = name === 'admin-console' && v3Integrated && !preview;
  const authorWorkspace = name === 'admin-console' && redesign && (preview || productionV3);
  const result = await build({
    absWorkingDir: repository,
    entryPoints: {
      [name]: `src/${name}/main.tsx`,
      ...(authorWorkspace && { 'author-workspace': 'src/admin-console/author-workspace.css' }),
    },
    outdir: output, chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]',
    splitting: true, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: false, metafile: true,
    define: {
      'process.env.NODE_ENV': '"production"',
      [name === 'admin-console' ? '__SANSPHASE_ADMIN_PREVIEW__' : '__SANSPHASE_COMMUNITY_CONSOLE_PREVIEW__']: String(preview),
      __SANSPHASE_ADMIN_REDESIGN__: String(authorWorkspace),
      __SANSPHASE_ADMIN_V3__: String(productionV3),
    },
    loader: { '.woff2': 'file', '.woff': 'file' },
  });
  const html = await readFile(resolve(repository, `src/${name}/index.html`), 'utf8');
  let consoleHtml = preview ? html.replace('</title>', '（本地预览）</title>') : html;
  if (productionV3) consoleHtml = adminConsoleDocument(consoleHtml, 'v3');
  if (authorWorkspace && preview && v3Integrated) consoleHtml = consoleHtml.replace('<html ', '<html data-v3-preview-origin="http://localhost:4308" ');
  await writeFile(resolve(output, 'index.html'), authorWorkspace
    ? consoleHtml.replace('</head>', '<link rel="stylesheet" href="./author-workspace.css">\n  </head>')
    : consoleHtml);
  const licenses = resolve(output, 'assets/licenses');
  const notices = await preserveBrowserPackageNotices(result.metafile, licenses, repository);
  await writeFile(resolve(licenses, 'sources.json'), JSON.stringify(notices, null, 2));
  return result;
}
