import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { verifySite } from '../scripts/verify-site.mjs';

test('production tea-room has no local identity UI and compiles all browser dependencies', async () => {
  const html = await readFile('src/teahouse/index.html', 'utf8');
  assert.equal(/local\/identities|本地身份|演示消息|sample-|id="notice-role"|preview_as/.test(html), false);
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelector('script[type="module"]').getAttribute('src'), '/teahouse-client.mjs');
  assert.equal(dom.window.document.querySelector('script[src*="vendor/lucide"]'), null);
  assert.equal(dom.window.document.querySelector('#messages').children.length, 0);
  assert.equal(dom.window.document.querySelector('#member-list').children.length, 0);
  dom.window.close();
  const root = resolve('.build'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, 'teahouse-test-'));
  try {
    const result = await build({ entryPoints: { 'teahouse-client': 'src/teahouse/client.ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, splitting: true, outdir: directory, outExtension: { '.js': '.mjs' }, chunkNames: 'chunks/[name]-[hash]', metafile: true });
    assert.ok(Object.keys(result.metafile.inputs).some(path => path.includes('socket.io-client/')));
    assert.ok(Object.keys(result.metafile.inputs).some(path => path.includes('compressorjs/')));
    assert.ok(Object.keys(result.metafile.inputs).every(path => !/(?:previews|scripts\/fixtures|\.local)\//.test(path)));
    const compiled = await readFile(resolve(directory, 'teahouse-client.mjs'), 'utf8');
    assert.doesNotMatch(compiled, /(?:from\s*|import\s*\()["'][^"']*\.ts["']/);
    assert.ok(Buffer.byteLength(compiled) < 200000, 'tea-room initial module must stay small');
  } finally {
    if (!directory.startsWith(root + sep)) throw Error('Unsafe isolated tea-room build path');
    await rm(directory, { recursive: true, force: true });
  }
});

test('release validation catches a missing resource on the independent tea-room page', async () => {
  const root = resolve('.build'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, 'teahouse-assets-test-'));
  try {
    await writeFile(resolve(directory, 'index.html'), '<!doctype html><title>Community</title>');
    await writeFile(resolve(directory, 'teahouse.html'), '<!doctype html><link rel="stylesheet" href="/teahouse.css"><script type="module" src="/teahouse-client.mjs"></script>');
    await assert.rejects(verifySite(directory), /ENOENT|Missing build asset/);
    await writeFile(resolve(directory, 'teahouse.css'), 'body { color: black; }');
    await writeFile(resolve(directory, 'teahouse-client.mjs'), 'export {};');
    await mkdir(resolve(directory, 'admin-console'));
    await writeFile(resolve(directory, 'admin-console/index.html'), '<link rel="stylesheet" href="./admin-console.css"><script type="module" src="./admin-console.js"></script>');
    await writeFile(resolve(directory, 'admin-console/admin-console.js'), 'export {};');
    await writeFile(resolve(directory, 'admin-console/admin-console.css'), 'body {}');
    await verifySite(directory);
  } finally {
    if (!directory.startsWith(root + sep)) throw Error('Unsafe isolated tea-room build path');
    await rm(directory, { recursive: true, force: true });
  }
});
