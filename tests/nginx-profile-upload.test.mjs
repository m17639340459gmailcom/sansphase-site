import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readerImageBytes } from '../src/upload-policy.mjs';
import { communityImageBytes } from '../src/community-rules.mjs';

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

test('tea-room realtime upgrade and image envelope are isolated from existing community routes', async () => {
  const entries = await host('nginx-community.conf', 'community.sansphase.com');
  const socket = location(entries, '/api/teahouse/socket.io/');
  assert.deepEqual(socket.args, ['location', '^~', '/api/teahouse/socket.io/']);
  assert.ok(socket.children.some(entry => entry.args.join(' ') === 'proxy_set_header Upgrade $http_upgrade'));
  assert.ok(socket.children.some(entry => entry.args.join(' ') === 'proxy_set_header Connection "upgrade"'));
  for (const header of ['Host', 'X-Forwarded-Proto', 'X-Real-IP', 'X-Forwarded-For']) {
    assert.ok(socket.children.some(entry => entry.args[0] === 'proxy_set_header' && entry.args[1] === header));
  }
  assert.deepEqual(directive(socket.children, 'proxy_read_timeout'), ['75s']);
  assert.deepEqual(directive(socket.children, 'proxy_buffering'), ['off']);
  assert.equal(limitFor(entries, '/api/teahouse/socket.io/'), 64 * 1024);
  const upload = location(entries, '/api/teahouse/attachments');
  assert.deepEqual(upload.args, ['location', '=', '/api/teahouse/attachments']);
  assert.ok(limitFor(entries, '/api/teahouse/attachments') > 25 * 1024 ** 2);
  assert.deepEqual(directive(upload.children, 'limit_conn'), ['community_upload', '2']);
  assert.deepEqual(directive(upload.children, 'proxy_request_buffering'), ['off']);
  assert.deepEqual(location(entries, '/api/community/session').args, ['location', '/']);
});

test('login puzzle actions have their own bounded request envelopes and never consume the password bucket', async () => {
  const source = await readFile(new URL('../deploy/nginx.conf', import.meta.url), 'utf8');
  const parsed = parseConfig(source), main = await host('nginx.conf', 'www.sansphase.com');
  for (const zone of ['sansphase_login_challenge', 'sansphase_login_match']) {
    assert.ok(parsed.some(entry => entry.args[0] === 'limit_req_zone'
      && entry.args.includes(`zone=${zone}:10m`) && entry.args.includes('rate=30r/m')), zone);
  }
  for (const namespace of ['reader', 'author']) {
    for (const [suffix, size, zone] of [
      ['', 4 * 1024, 'sansphase_login_challenge'],
      ['/verify', 40 * 1024, 'sansphase_login_match'],
    ]) {
      const path = `/api/${namespace}/login-challenge${suffix}`, selected = location(main, path);
      assert.equal(limitFor(main, path), size, path);
      assert.deepEqual(directive(selected.children, 'limit_req'), [`zone=${zone}`, 'burst=10', 'nodelay'], path);
      assert.deepEqual(directive(selected.children, 'limit_req_status'), ['429']);
      assert.deepEqual(directive(selected.children, 'client_body_timeout'), ['10s']);
      assert.deepEqual(directive(selected.children, 'proxy_read_timeout'), ['10s']);
      assert.deepEqual(directive(selected.children, 'proxy_pass'), ['http://127.0.0.1:4176']);
      assert.ok(!selected.children.some(entry => entry.args.includes('Access-Control-Allow-Origin')));
    }
    assert.deepEqual(directive(location(main, `/api/${namespace}/login`).children, 'limit_req'), ['zone=sansphase_login', 'burst=5', 'nodelay']);
    for (const suffix of ['/extra', '/verify/extra', 'x']) {
      const selected = location(main, `/api/${namespace}/login-challenge${suffix}`);
      assert.deepEqual(selected.args, ['location', '/'], 'puzzle overrides must not capture other API paths');
    }
  }
});

test('main proxy preserves upstream referrer policies for canonical and normalized routes without changing public defaults', async () => {
  const parsed = parseConfig(await readFile(new URL('../deploy/nginx.conf', import.meta.url), 'utf8'));
  const policyMaps = parsed.filter(entry => entry.args[0] === 'map' && entry.args[2] === '$sansphase_referrer_policy');
  assert.equal(policyMaps.length, 1, 'one HTTP-level policy map');
  assert.deepEqual(policyMaps[0].args, ['map', '$upstream_http_referrer_policy', '$sansphase_referrer_policy']);
  assert.deepEqual(policyMaps[0].children.map(entry => entry.args), [
    ['default', '$upstream_http_referrer_policy'],
    ["''", 'strict-origin-when-cross-origin'],
  ], 'an existing upstream policy, including no-referrer, passes through; only an absent policy uses the public default');
  const main = await host('nginx.conf', 'www.sansphase.com');
  const added = main.filter(entry => entry.args[0] === 'add_header').map(entry => entry.args.slice(1));
  assert.deepEqual(added.filter(args => args[0] === 'Referrer-Policy'), [['Referrer-Policy', '$sansphase_referrer_policy', 'always']]);
  assert.deepEqual(added.filter(args => args[0] === 'X-Frame-Options'), [['X-Frame-Options', 'SAMEORIGIN', 'always']]);
  assert.deepEqual(added.filter(args => args[0] === 'Strict-Transport-Security'), [['Strict-Transport-Security', '"max-age=86400"', 'always']]);
  assert.deepEqual(main.filter(entry => entry.args[0] === 'proxy_hide_header').map(entry => entry.args[1]).sort(), ['Referrer-Policy', 'X-Preview-App'], 'replace the upstream policy once and retain preview-header suppression');
  assert.ok(!added.some(args => ['content-security-policy', 'cache-control', 'x-robots-tag'].includes(args[0].toLowerCase())), 'application CSP, private cache and noindex headers stay authoritative');
  for (const path of ['/admin-console/', '/admin-console/index.html', '/admin-console/assets/admin.js', '/admin-console/missing.js',
    '/%5cadmin-console/index.html', '/\\admin-console/index.html', '/admin-console', '/admin-console-other/', '/manage', '/manage/', '/', '/api/manage/readers']) {
    const selected = location(main, path);
    assert.deepEqual(selected.args, ['location', '/'], path);
    assert.deepEqual(directive(selected.children, 'proxy_pass'), ['http://127.0.0.1:4176']);
    assert.equal(directive(selected.children, 'add_header'), undefined, 'inherit the single mapped policy and security headers');
    assert.equal(directive(selected.children, 'proxy_hide_header'), undefined, 'inherit both hidden headers');
    assert.equal(directive(selected.children, 'proxy_ignore_headers'), undefined);
    assert.deepEqual(directive(selected.children, 'proxy_cache') || directive(main, 'proxy_cache'), ['off']);
  }
  for (const path of ['/assets/scene/example.webp', '/assets/site/release/app.js']) {
    const selected = location(main, path);
    assert.equal(directive(selected.children, 'proxy_pass'), undefined, 'public static files still bypass the application');
    assert.deepEqual(selected.children.filter(entry => entry.args[0] === 'add_header' && entry.args[1] === 'Referrer-Policy').map(entry => entry.args.slice(1)), [['Referrer-Policy', 'strict-origin-when-cross-origin', 'always']], path);
  }
});

test('anonymous share pages and covers use their own burst bucket without capturing protected API paths', async () => {
  for (const [file, name, zone] of [['nginx.conf', 'www.sansphase.com', 'sansphase_share'], ['nginx-community.conf', 'community.sansphase.com', 'community_share']]) {
    const source = parseConfig(await readFile(new URL(`../deploy/${file}`, import.meta.url), 'utf8'));
    const entries = await host(file, name);
    assert.ok(source.some(entry => entry.args[0] === 'limit_req_zone' && entry.args.includes('$binary_remote_addr')
      && entry.args.includes(`zone=${zone}:10m`) && entry.args.includes('rate=10r/s')));
    for (const path of ['/share/site', '/share/invite/AbCdEfGh12345678_abc-123', '/share/post/example/cover.jpg']) {
      const selected = location(entries, path);
      assert.deepEqual(selected.args, ['location', '^~', '/share/']);
      assert.deepEqual(directive(selected.children, 'limit_req'), [`zone=${zone}`, 'burst=30', 'nodelay']);
      assert.deepEqual(directive(selected.children, 'limit_req_status'), ['429']);
      assert.deepEqual(directive(selected.children, 'proxy_pass'), ['http://127.0.0.1:4176']);
      assert.deepEqual(directive(selected.children, 'proxy_cache') || directive(entries, 'proxy_cache'), ['off']);
      assert.equal(directive(selected.children, 'proxy_ignore_headers'), undefined, 'upstream withdrawal/cache headers stay authoritative');
    }
    for (const path of ['/share-other', '/api/community/summary', '/api/reader/login', '/api/community-entry'])
      assert.ok(!directive(location(entries, path).children, 'limit_req')?.includes(`zone=${zone}`), path);
  }
});

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

test('banner upload alone accepts existing moderator and owner file limits plus multipart headers', async () => {
  const community = await host('nginx-community.conf', 'community.sansphase.com');
  const path = '/api/community/manage/banner-image', selected = location(community, path);
  assert.deepEqual(selected?.args, ['location', '=', path]);
  assert.equal(limitFor(community, path), 26 * 1024 ** 2);
  for (const owner of [false, true]) {
    const form = new FormData(); form.set('file', new Blob([new Uint8Array(communityImageBytes(owner))], { type: 'image/png' }), 'banner.png');
    const bytes = (await new Request('https://example.test/upload', { method: 'POST', body: form }).arrayBuffer()).byteLength;
    assert.ok(bytes > communityImageBytes(owner));
    assert.ok(bytes < limitFor(community, path), 'multipart does not reduce the advertised file allowance');
  }
  assert.deepEqual(directive(selected.children, 'limit_conn'), ['community_upload', '2']);
  assert.deepEqual(directive(selected.children, 'limit_conn_status'), ['429']);
  assert.deepEqual(directive(selected.children, 'proxy_request_buffering'), ['off']);
  assert.deepEqual(directive(selected.children, 'proxy_pass'), ['http://127.0.0.1:4176']);
  for (const other of ['/api/community/manage/banners', '/api/community/manage/banner-image/extra', '/api/community/topics'])
    assert.equal(limitFor(community, other), 2 * 1024 ** 2);
});

test('author product artwork accepts the existing 25MiB file allowance without expanding other management endpoints', async () => {
  const community = await host('nginx-community.conf', 'community.sansphase.com');
  const path = '/api/community/manage/item-image', selected = location(community, path);
  assert.deepEqual(selected?.args, ['location', '=', path], 'product uploads need their own exact envelope override');
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(communityImageBytes(true))], { type: 'image/png' }), 'product.png');
  const bytes = (await new Request('https://example.test/upload', { method: 'POST', body: form }).arrayBuffer()).byteLength;
  assert.equal(communityImageBytes(true), 25 * 1024 ** 2);
  assert.ok(bytes > communityImageBytes(true));
  assert.ok(bytes < limitFor(community, path), 'valid owner artwork and its multipart envelope must reach the application');
  assert.equal(limitFor(community, path), 26 * 1024 ** 2);
  assert.deepEqual(directive(selected.children, 'limit_conn'), ['community_upload', '2']);
  assert.deepEqual(directive(selected.children, 'limit_conn_status'), ['429']);
  assert.deepEqual(directive(selected.children, 'proxy_request_buffering'), ['off']);
  assert.deepEqual(directive(selected.children, 'proxy_pass'), ['http://127.0.0.1:4176']);
  for (const other of ['/api/community/manage/items', '/api/community/manage/item-image/extra', '/api/community/manage/items/new', '/api/community/topics'])
    assert.equal(limitFor(community, other), 2 * 1024 ** 2, other);
});
