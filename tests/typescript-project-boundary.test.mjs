import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Original publication packages intentionally omit standalone previews.
const frontendPresent = existsSync(resolve(root, 'previews/hero-upgrade/tsconfig.json'));
function project(file) {
  const path = resolve(root, file);
  const result = ts.readConfigFile(path, ts.sys.readFile);
  assert.equal(result.error, undefined);
  const config = ts.parseJsonConfigFileContent(result.config, ts.sys, resolve(path, '..'));
  assert.equal(config.errors.length, 0);
  return config;
}
const name = path => relative(root, path).replaceAll('\\', '/');

test('the Node application and bundled frontend keep separate compiler ownership', () => {
  const formal = project('tsconfig.json');
  assert.equal(formal.options.moduleResolution, ts.ModuleResolutionKind.NodeNext);
  assert.equal(formal.options.erasableSyntaxOnly, true);
  assert.equal(formal.fileNames.some(path => name(path).startsWith('previews/hero-upgrade/')), false,
    'the standalone Bundler project must not be compiled again as NodeNext roots');
  if (frontendPresent) {
    const frontend = project('previews/hero-upgrade/tsconfig.json');
    assert.equal(frontend.options.moduleResolution, ts.ModuleResolutionKind.Bundler);
    const owned = new Set(frontend.fileNames.map(name));
    for (const file of ['src/main.ts', 'src/catalog-page.ts', 'integration-server.ts', 'server.ts', 'tests/preview.test.ts']) {
      assert.equal(owned.has('previews/hero-upgrade/' + file), true, 'frontend check retains ' + file);
    }
  }
});

test('formal integration imports are still checked after excluding standalone frontend roots', {skip: !frontendPresent && 'standalone preview sources are not shipped in original publications'}, () => {
  const formal = project('tsconfig.json');
  const program = ts.createProgram(formal.fileNames, formal.options);
  const files = new Set(program.getSourceFiles().map(file => name(file.fileName)));
  for (const file of ['scripts/preview-local-frontends.ts', 'scripts/preview-frontend-integration.ts',
    'previews/hero-upgrade/integration-server.ts', 'previews/hero-upgrade/server-response.ts',
    'previews/hero-upgrade/scripts/build-config.ts']) {
    assert.equal(files.has(file), true, 'formal dependency remains type checked: ' + file);
  }
  assert.equal(files.has('previews/hero-upgrade/src/main.ts'), false);
});

test('frontend type checking has an explicit command without requiring preview sources in original release packages', async () => {
  const packageFile = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageFile.scripts['check:types'], 'tsc --noEmit');
  assert.equal(packageFile.scripts['check:types:frontend-v2'], 'tsc --noEmit -p previews/hero-upgrade/tsconfig.json');
  assert.match(packageFile.scripts.build, /check:types/);
});
