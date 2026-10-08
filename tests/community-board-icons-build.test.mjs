import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { typedBrowserModules } from '../scripts/typed-browser-modules.mjs';

test('the shared board icon registry ships as compiled metadata at its stable browser path', async () => {
  const name = 'community-board-icons';
  assert.ok(typedBrowserModules.has(`${name}.mjs`));
  const adapter = await readFile(`src/${name}.mjs`, 'utf8');
  assert.equal(adapter.trim(), `// Source adapter for Node tests while the browser receives compiled output.\nexport * from './${name}.ts';`);
  const output = await readFile(`dist/${name}.mjs`, 'utf8');
  const source = await readFile(`src/${name}.ts`, 'utf8');
  assert.equal(output, (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code);
  assert.doesNotMatch(output, /(?:from\s*|import\s*\()["'][^"']*\.ts["']/);
  assert.doesNotMatch(output, /(?:from\s*|import\s*\()["']lucide["']/);
  const registry = await import(`../dist/${name}.mjs`);
  assert.equal(registry.communityBoardIconChoices.length, 22);
  assert.equal(registry.communityBoardIcon('brain').zh, 'AI 咨询');
  assert.equal(registry.availableCommunityBoardIcons(registry.communityBoardIconChoices.map(icon => ({ icon: icon.id }))).length, 0);
});
