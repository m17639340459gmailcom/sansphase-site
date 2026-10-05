import test from "node:test";
import assert from "node:assert/strict";
import { publicationFiles } from "../scripts/publication-files.mjs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

test("local payment simulations cannot enter the publication source tree or production imports", async () => {
  const files = await publicationFiles();
  assert.ok(files.every((file) => !file.startsWith("previews/")));
  for (const file of files.filter(
    (file) => /^(src|server)\//.test(file) && /\.(?:ts|tsx|mjs|js)$/.test(file),
  )) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /(?:from\s*|import\s*\()['"][^'"]*previews\//,
      file,
    );
    assert.doesNotMatch(
      source,
      /data-outcome=["']|\/demo\/outcome|createDemoOrders/,
      file,
    );
  }
});

test('production entry and its source import graph never mount sample-account identity selection', async () => {
  const root = resolve('.');
  const files = new Set(await publicationFiles(root));
  const pending = ['scripts/start.mjs', 'server.mjs'];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.ok(files.has(file), `production dependency is not in the source package: ${file}`);
    assert.ok(!file.startsWith('scripts/fixtures/') && file !== 'scripts/catalog-fixture-preview.mjs', `production imported a sample-account service: ${file}`);
    const text = await readFile(resolve(root, file), 'utf8');
    assert.doesNotMatch(text, /createCommunityPreviewService|previewIdentityPath|preview_as/, `production source must use real sessions: ${file}`);
    const imports = [];
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest));
    for (const imported of imports.filter(path => path.startsWith('.') && /\.(mjs|js|ts|tsx|jsx)$/.test(path))) {
      pending.push(relative(root, resolve(dirname(resolve(root, file)), imported)).replaceAll('\\', '/'));
    }
  }
  assert.ok(visited.has('server/payload/runtime.ts'));
  assert.ok(visited.has('server/community-runtime.ts'));
  assert.ok(visited.has('server/community-banners.ts'));
});
