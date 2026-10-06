import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readerImageBytes } from '../src/upload-policy.mjs';

// Parse blocks and directives so the checks apply to each selected host/location,
// rather than matching a limit or proxy setting elsewhere in the same file.
function parseConfig(source) {
  const tokens = [...source.matchAll(/#[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};]+/g)]
    .map(match => match[0]).filter(token => !token.startsWith('#'));
  let offset = 0;
  function block(nested = false) {
    const entries = [];
    while (offset < tokens.length) {
      if (tokens[offset] === '}') { assert.ok(nested, 'unexpected closing block'); offset++; return entries; }
      const args = [];
      while (offset < tokens.length && !['{', '}', ';'].includes(tokens[offset])) args.push(tokens[offset++]);
      assert.ok(args.length, 'empty directive');
      const delimiter = tokens[offset++];
      if (delimiter === '{') entries.push({ args, children: block(true) });
      else { assert.equal(delimiter, ';', 'directive must end with a semicolon'); entries.push({ args }); }
    }
    assert.equal(nested, false, 'unclosed block');
    return entries;
  }
  return block();
}

const directive = (entries, name) => entries.find(entry => entry.args[0] === name)?.args.slice(1);
const bodyBytes = value => {
  assert.ok(value, 'missing request body limit');
  const match = /^(\d+)([km])?$/i.exec(value);
  assert.ok(match, 'invalid request body limit');
  return Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1024 ** 2 : match[2]?.toLowerCase() === 'k' ? 1024 : 1);
};
async function host(file, name) {
  const parsed = parseConfig(await readFile(new URL(`../deploy/${file}`, import.meta.url), 'utf8'));
  const server = parsed.find(entry => entry.args[0] === 'server'
    && directive(entry.children, 'server_name')?.includes(name)
    && directive(entry.children, 'listen')?.includes('443'));
  assert.ok(server, `missing HTTPS host ${name}`);
  return server.children;
}
function location(entries, path) {
  const blocks = entries.filter(entry => entry.args[0] === 'location');
  const exact = blocks.find(entry => entry.args[1] === '=' && entry.args[2] === path);
  if (exact) return exact;
  const prefix = blocks.filter(entry => !['=', '~', '~*'].includes(entry.args[1]))
    .map(entry => ({ entry, prefix: entry.args[1] === '^~' ? entry.args[2] : entry.args[1] }))
    .filter(entry => path.startsWith(entry.prefix)).sort((left, right) => right.prefix.length - left.prefix.length)[0];
  if (prefix?.entry.args[1] === '^~') return prefix.entry;
  return blocks.find(entry => ['~', '~*'].includes(entry.args[1])
    && new RegExp(entry.args[2], entry.args[1] === '~*' ? 'i' : '').test(path)) || prefix?.entry;
}
const limitFor = (entries, path) => bodyBytes((directive(location(entries, path)?.children || [], 'client_max_body_size')
  || directive(entries, 'client_max_body_size'))?.[0]);

test('exact profile upload locations accept a 2MiB file and its multipart envelope with existing streaming controls', async () => {
  const main = await host('nginx.conf', 'www.sansphase.com');
  const community = await host('nginx-community.conf', 'community.sansphase.com');
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(readerImageBytes)], { type: 'image/png' }), 'background.png');
  const multipartBytes = (await new Request('https://example.test/upload', { method: 'POST', body: form }).arrayBuffer()).byteLength;
  assert.equal(readerImageBytes, 2 * 1024 ** 2, 'application file limit remains 2MiB');
  assert.ok(multipartBytes > readerImageBytes, 'multipart headers add request bytes');
  for (const [entries, path, zone] of [
    [main, '/api/reader/avatar', 'sansphase_upload'],
    [community, '/api/community/profile/avatar', 'community_upload'],
    [community, '/api/community/profile/background', 'community_upload'],
  ]) {
    const selected = location(entries, path);
    assert.deepEqual(selected?.args, ['location', '=', path], `upload override must be exact: ${path}`);
    assert.equal(limitFor(entries, path), 2112 * 1024, path);
    assert.ok(multipartBytes <= limitFor(entries, path), `valid multipart upload fits ${path}`);
    assert.deepEqual(directive(selected.children, 'limit_conn'), [zone, '2'], path);
    assert.deepEqual(directive(selected.children, 'limit_conn_status'), ['429'], path);
    assert.deepEqual(directive(selected.children, 'proxy_request_buffering'), ['off'], path);
    assert.deepEqual(directive(selected.children, 'proxy_pass'), ['http://127.0.0.1:4176'], path);
    assert.ok(!selected.children.some(entry => entry.args.includes('Access-Control-Allow-Origin')), 'profile uploads do not add CORS');
  }
});

test('profile overrides preserve other API request limits and do not cover profile actions or image reads', async () => {
  const main = await host('nginx.conf', 'www.sansphase.com');
  const community = await host('nginx-community.conf', 'community.sansphase.com');
  for (const entries of [main, community]) assert.equal(bodyBytes(directive(entries, 'client_max_body_size')?.[0]), 2 * 1024 ** 2);
  for (const path of ['/api/reader/avatar/remove', '/api/reader/avatar/123.webp', '/api/reader/profile', '/api/community-identity'])
    assert.equal(limitFor(main, path), 2 * 1024 ** 2, path);
  for (const path of ['/api/community/profile', '/api/community/profile/avatar/pending.webp', '/api/community/profile/avatar/remove',
    '/api/community/profile/background/remove', '/api/community/shop/equip', '/api/community/manage/profile-background'])
    assert.equal(limitFor(community, path), 2 * 1024 ** 2, path);
  assert.equal(limitFor(main, '/api/reader/login'), 16 * 1024);
  assert.equal(limitFor(main, '/api/author/upload'), 15361 * 1024 ** 2);
  assert.equal(limitFor(community, '/api/community-entry'), 8 * 1024);
  assert.equal(limitFor(community, '/api/community/images'), 21 * 1024 ** 2);
});
