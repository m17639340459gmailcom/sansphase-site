import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import { createCommunityDemo } from '../scripts/fixtures/community-demo.mjs';
import { createCommunityPreviewService, previewIdentityPath } from '../scripts/fixtures/community-preview-identity.ts';

test('local role picker switches fixture identities and keeps management permissions separate', async t => {
  const demo = await createCommunityDemo();
  let service: ReturnType<typeof createCommunityPreviewService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    demo.close();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  service = createCommunityPreviewService(demo.service(port), port);
  const read = (path: string, cookie = '') => fetch(`${origin}/api/community/${path}`, { headers: { cookie } });
  const switchRole = (role: string, requestOrigin = origin, extra = '') => fetch(`${origin}${previewIdentityPath}`, {
    method: 'POST', redirect: 'manual',
    headers: { origin: requestOrigin, 'content-type': 'application/x-www-form-urlencoded' },
    body: `role=${encodeURIComponent(role)}&theme=light${extra}`,
  });
  const picker = await fetch(`${origin}${previewIdentityPath}?theme=light`);
  assert.equal(picker.status, 200);
  assert.equal(picker.headers.get('cache-control'), 'no-store');
  const html = await picker.text();
  assert.match(html, /本地身份预览/);
  assert.match(html, /作者.*無相/s);
  assert.match(html, /版主.*守望/s);
  assert.match(html, /method="post"/);
  assert.doesNotMatch(html, /作者和协管会直接进入/);
  assert.equal(picker.headers.get('set-cookie'), null, 'opening the picker never changes the sample account');
  const initialPicker = await (await fetch(`${origin}${previewIdentityPath}`)).text();
  assert.match(initialPicker, /data-theme="dark"/, 'the manual developer tool starts in dark mode');
  const defaultMe = await (await read('me')).json();
  assert.equal(defaultMe.convention.agreed, false, 'preview accounts also read the convention on their first visit');
  assert.equal(defaultMe.previewIdentityHref, undefined, 'the community account response never advertises the manual developer tool');
  const queryRole = await fetch(`${origin}${previewIdentityPath}?role=owner&theme=light`);
  assert.equal(queryRole.headers.get('set-cookie'), null);
  assert.match(await queryRole.text(), /当前身份：<strong>预览读者/);
  assert.equal((await read('manage')).status, 403);

  for (const [role, name, owner, mod] of [
    ['owner', '無相', true, true], ['general', '统筹', false, true], ['steward', '守望', false, true], ['assistant', '协助', false, true], ['demo', '预览读者', false, false],
  ] as const) {
    const response = await switchRole(role);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/?communityTheme=light#/community/home', 'selecting an account leaves management entry to the user');
    const setCookie = response.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly; SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    const me = await (await read('me', cookie)).json();
    assert.equal(me.convention.agreed, false, 'switching sample identity does not fabricate consent');
    assert.deepEqual([me.name, me.owner, me.mod], [name, owner, mod]);
    if (role === 'steward') assert.deepEqual(me.moderationBoards, ['qa', 'tools'], 'the sample moderator demonstrates explicit board assignments');
    if (role === 'general' || role === 'steward' || role === 'assistant') {
      assert.equal(me.staff.role, role === 'steward' ? 'moderator' : role);
      assert.equal(me.staff.permissions.includes('staff.appoint'), role !== 'assistant');
      assert.equal(me.staff.delegable.length > 0, role !== 'assistant');
      assert.equal(me.staff.parent.kind, role === 'general' ? 'owner' : 'reader');
      assert.equal(me.staff.parent.id, role === 'general' ? 'owner' : role === 'steward' ? 'general' : 'steward');
    }
    assert.equal(me.previewIdentityHref, undefined);
    assert.equal((await read('manage', cookie)).status, mod ? 200 : 403);
    assert.equal((await read('manage?tab=items', cookie)).status, owner || role === 'general' ? 200 : 403);
    if (role === 'general') assert.deepEqual([me.level, me.trustLevel], [3, 3], 'the local preview uses the same effective general level as production');
    assert.equal((await read('manage?tab=orders', cookie)).status, owner ? 200 : 403);
    const profile = await (await read('members/10002', cookie)).json();
    assert.equal(profile.canAppoint, ['owner', 'general', 'steward'].includes(role));
    const rosterResponse = await read('manage?tab=stewards', cookie);
    assert.equal(rosterResponse.status, ['owner', 'general', 'steward'].includes(role) ? 200 : 403);
    if (role === 'general' || role === 'steward') {
      const roster = await rosterResponse.json();
      assert.equal(roster.actorStaff.role, role === 'steward' ? 'moderator' : role);
      const subordinate = roster.stewards.find((person: { uid: string }) => person.uid === (role === 'general' ? '10006' : '10010'));
      assert.ok(subordinate, 'the configured role has its actual downstream member to manage');
      assert.equal(subordinate.canAppoint, true);
    }
  }
  const defaultThemeSwitch = await fetch(`${origin}${previewIdentityPath}`, {
    method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'role=owner',
  });
  assert.equal(defaultThemeSwitch.headers.get('location'), '/?communityTheme=dark#/community/home');
  assert.equal((await switchRole('owner', 'https://evil.example')).status, 403);
  assert.equal((await switchRole('admin')).status, 400);
  assert.equal((await switchRole('owner', origin, `&padding=${'x'.repeat(2048)}`)).status, 413);
  const unsafeTheme = await fetch(`${origin}${previewIdentityPath}?theme=%22%3E%3Cscript%3E`);
  assert.doesNotMatch(await unsafeTheme.text(), /<script>/);
  const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${origin}${previewIdentityPath}`, { headers: { host: 'evil.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(invalidHost, 403);
  const invalidMethod = await fetch(`${origin}${previewIdentityPath}`, { method: 'DELETE' });
  assert.equal(invalidMethod.status, 405);
});

test('the production community service never interprets the role picker or preview cookie', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-role-isolation-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [{ kind: 'reader', id: 'real-reader' }]);
  let origin = '';
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({
    store, siteOrigin: origin,
    identify: async () => ({ kind: 'reader', id: 'real-reader', name: '真实读者', vip: false }),
    people: async () => new Map([['reader:real-reader', { name: '真实读者', uid: '10001', avatar: null, vip: false, joinedAt: null, bio: '' }]]),
  });
  for (const fakeIdentity of ['owner', 'general', 'steward', 'assistant']) {
    const headers = { cookie: `preview_as=${fakeIdentity}` };
    const me = await (await fetch(`${origin}/api/community/me`, { headers })).json();
    assert.deepEqual([me.name, me.owner, me.mod], ['真实读者', false, false]);
    assert.equal(me.management, null);
    assert.equal(me.previewIdentityHref, undefined);
    assert.equal((await fetch(`${origin}/api/community/manage`, { headers })).status, 403);
    assert.equal((await fetch(`${origin}${previewIdentityPath}`, { headers })).status, 404);
    assert.equal((await fetch(`${origin}${previewIdentityPath}`, {
      method: 'POST', headers: { ...headers, origin, 'x-reader-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ role: fakeIdentity }),
    })).status, 404);
    assert.equal((await fetch(`${origin}/api/community/browse-mode`, {
      method: 'POST', headers: { ...headers, origin, 'x-reader-request': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ reader: false }),
    })).status, 403, 'a forged fixture cookie never grants real account mode switching');
  }
});

test('the local wrapper forwards every account response unchanged without intercepting response overloads', async t => {
  let service: ReturnType<typeof createCommunityPreviewService>;
  let completed = 0;
  let restored = 0;
  const server = createServer((req, res) => { void service.handle(req, res); });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  service = createCommunityPreviewService({ handle: async (req, res) => {
    const wrapped = res.end;
    const mode = new URL(req.url!, origin).searchParams.get('case');
    res.writeHead(mode === 'error' ? 403 : 200, { 'Content-Type': 'application/json; charset=utf-8' });
    const done = () => { completed++; if (res.end !== wrapped) restored++; };
    if (mode === 'empty') res.end(done);
    else if (mode === 'buffer') res.end(Buffer.from('{"name":"保留数据"}'), done);
    else if (mode === 'array') res.end('[]', 'utf8', done);
    else if (mode === 'invalid') res.end('not-json', 'utf8', done);
    else res.end(JSON.stringify({ name: '预览读者' }), 'utf8', done);
  } }, port);
  const successful = await (await fetch(`${origin}/api/community/me`)).json();
  assert.deepEqual(successful, { name: '预览读者' });
  for (const mode of ['error', 'buffer', 'array', 'invalid', 'empty']) {
    const response = await fetch(`${origin}/api/community/me?case=${mode}`);
    const body = await response.text();
    assert.doesNotMatch(body, /previewIdentityHref/);
    assert.equal(body, mode === 'empty' ? '' : mode === 'buffer' ? '{"name":"保留数据"}' : mode === 'array' ? '[]' : mode === 'invalid' ? 'not-json' : '{"name":"预览读者"}');
  }
  for (const [path, init] of [
    ['/api/community/me', { method: 'POST' }],
    ['/api/community/summary', {}],
  ] as const) {
    const body = await (await fetch(`${origin}${path}`, init)).json();
    assert.equal(body.previewIdentityHref, undefined);
  }
  const foreignHost = await new Promise<string>((resolve, reject) => {
    const req = request(`${origin}/api/community/me`, { headers: { host: 'evil.example' } }, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(JSON.parse(foreignHost).previewIdentityHref, undefined);
  assert.equal(completed, 9, 'all end callbacks are preserved');
  assert.equal(restored, 0, 'the developer wrapper never replaces the delegated response end method');
});
