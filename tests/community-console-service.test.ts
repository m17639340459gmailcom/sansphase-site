import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import { communityStaffCapabilities, communityStaffDefaultPermissions } from '../src/community-staff.ts';
import type { CommunityStaffPermission } from '../src/community-staff.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import { createCommunityDemo } from '../scripts/fixtures/community-demo.mjs';
import { createCommunityConsolePreview } from '../scripts/preview-community-console.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-console-http-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  const store = createCommunityStore(directory);
  const accounts = new Map(['general', 'moderator', 'assistant', 'member', 'reporter'].map((id, index) => [id, { id, uid: String(20001 + index), active: true }]));
  acceptCommunityConvention(store, [owner, ...[...accounts.keys()].map(reader)]);
  const all = communityStaffCapabilities.map(capability => capability.id);
  store.staff.appoint(owner, reader('general'), { role: 'general', boards: ['qa', 'tools', 'showcase'], permissions: all, delegable: all });
  store.staff.appoint(reader('general'), reader('moderator'), { role: 'moderator', boards: ['qa', 'tools'], permissions: all, delegable: all });
  const grant = (permissions: readonly CommunityStaffPermission[]) => store.staff.appoint(reader('moderator'), reader('assistant'), {
    role: 'assistant', boards: ['qa'], permissions: [...permissions], delegable: [],
  });
  grant(communityStaffDefaultPermissions.assistant);
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({ store, directory, siteOrigin: origin,
    identify: async req => {
      const id = /(?:^|;\s*)role=([a-z]+)(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (id === 'owner') return { ...owner, name: '合成作者', vip: true };
      const account = id ? accounts.get(id) : undefined;
      return account?.active ? { kind: 'reader', id: account.id, name: account.id, vip: false } : null;
    },
    people: async authors => new Map(authors.flatMap(author => {
      if (author.kind === 'owner') return [[`owner:${author.id}`, { name: '合成作者', uid: 'owner', avatar: null, vip: true, bio: '', joinedAt: null, active: true }]];
      const account = accounts.get(author.id);
      return account ? [[`reader:${author.id}`, { name: account.id, uid: account.uid, avatar: null, vip: false, bio: '', joinedAt: null, active: account.active }]] : [];
    })),
    findMember: async uid => uid === 'owner' ? owner : [...accounts.values()].filter(account => account.uid === uid).map(account => reader(account.id))[0] || null,
  });
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    store.close();
    assert.match(directory, /[\\/]community-console-http-[^\\/]+$/);
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const get = (path: string, role = 'owner') => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: `role=${role}` } });
  const post = (path: string, body: unknown = {}, role = 'owner', requestOrigin = origin) => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { Cookie: `role=${role}`, Origin: requestOrigin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const topic = (board = 'qa', pending = false) => store.createTopic({ board, author: reader('member'), title: `本地 ${board} 审核样例`, body: '只供后台权限回归的合成内容。', pending: pending ? '等待人工审核' : null });
  return { directory, store, accounts, get, post, topic, grant };
}

test('community console HTTP reads respect the existing owner, general, moderator, assistant and reader boundaries', async t => {
  const f = await fixture(t);
  for (const board of ['qa', 'tools', 'showcase']) f.topic(board, true);
  for (const [role, boards] of [['owner', ['qa', 'tools', 'showcase']], ['general', ['qa', 'tools', 'showcase']], ['moderator', ['qa', 'tools']], ['assistant', ['qa']]] as const) {
    const response = await f.get('manage?tab=queue', role);
    assert.equal(response.status, 200, role);
    const data = await response.json();
    assert.deepEqual(data.queue.topics.map((row: { board: string }) => row.board).sort(), [...boards].sort(), role);
    assert.equal(data.queue.topics.every((row: { canApprove: boolean }) => row.canApprove), true);
    assert.equal(response.headers.get('cache-control')?.includes('no-store'), true);
  }
  assert.equal((await f.get('manage?tab=reports', 'assistant')).status, 403);
  for (const role of ['member', 'unknown']) {
    for (const tab of ['queue', 'content', 'reports']) assert.equal((await f.get(`manage?tab=${tab}`, role)).status, role === 'unknown' ? 401 : 403);
  }
});

test('review approval and reasoned rejection use existing routes and cannot cross assigned boards', async t => {
  const f = await fixture(t);
  for (const role of ['owner', 'general', 'moderator', 'assistant']) {
    const approved = f.topic('qa', true);
    assert.equal((await f.post(`topics/${approved.id}/approve`, {}, role)).status, 200);
    assert.equal(f.store.topic(approved.id)?.pending, false);
    const rejected = f.topic('qa', true);
    assert.equal((await f.post(`manage/topics/${rejected.id}/reject`, { reason: '' }, role)).status, 400);
    assert.equal(f.store.topic(rejected.id)?.pending, true);
    assert.equal((await f.post(`manage/topics/${rejected.id}/reject`, { reason: '与版块无关', note: '本地审核说明' }, role)).status, 200);
    assert.equal(f.store.topic(rejected.id), null);
  }
  const otherBoard = f.topic('showcase', true);
  assert.equal((await f.post(`topics/${otherBoard.id}/approve`, {}, 'moderator')).status, 404);
  assert.equal((await f.post(`manage/topics/${otherBoard.id}/reject`, { reason: '越权尝试' }, 'moderator')).status, 403);
  assert.equal(f.store.topic(otherBoard.id)?.pending, true);
  assert.equal((await f.post(`topics/${otherBoard.id}/approve`, {}, 'general', 'https://other.example')).status, 403);
  assert.equal(f.store.topic(otherBoard.id)?.pending, true);
});

test('report handling separates rejection, restoration, deletion, penalties and mute capabilities', async t => {
  const f = await fixture(t);
  const first = f.topic();
  const firstReport = f.store.report({ target: { kind: 'topic', id: first.id }, reporter: reader('reporter'), reason: '疑似违规', note: '本地举报样例' });
  f.store.hide({ kind: 'topic', id: first.id }, '等待举报复核');
  f.grant(['content.inspect', 'report.review']);
  let data = await (await f.get('manage?tab=reports', 'assistant')).json();
  assert.equal(data.reports[0].canUphold, false);
  assert.equal(data.reports[0].canDismiss, false);
  assert.equal((await f.post(`manage/reports/${firstReport.id}`, { uphold: true, reason: '违规删除' }, 'assistant')).status, 403);
  assert.equal((await f.post(`manage/reports/${firstReport.id}`, { uphold: false }, 'assistant')).status, 403);
  f.grant(['content.inspect', 'report.review', 'topic.restore']);
  assert.equal((await f.post(`manage/reports/${firstReport.id}`, { uphold: false }, 'assistant')).status, 200);
  assert.equal(f.store.topic(first.id)?.hidden, false);

  const second = f.topic();
  const secondReport = f.store.report({ target: { kind: 'topic', id: second.id }, reporter: reader('reporter'), reason: '疑似广告' });
  f.grant(['content.inspect', 'report.review', 'topic.delete']);
  data = await (await f.get('manage?tab=reports', 'assistant')).json();
  assert.equal(data.reports.find((row: { id: string }) => row.id === secondReport.id).canUphold, true);
  assert.equal((await f.post(`manage/reports/${secondReport.id}`, { uphold: true, reason: '经核实为广告' }, 'assistant')).status, 200);
  assert.equal(f.store.topic(second.id), null);
  assert.equal(f.store.ledger.history(reader('member'), { limit: 100 }).some(row => row.reason === 'penalty'), false);
  assert.equal(f.store.members.muted(reader('member')), null);

  const third = f.topic();
  assert.equal((await f.post(`topics/${third.id}/delete`, { reason: '不能擅自附带扣分', violation: true }, 'assistant')).status, 403);
  assert.equal((await f.post(`topics/${third.id}/delete`, { reason: '不能擅自附带禁言', mute: 1 }, 'assistant')).status, 403);
  assert.ok(f.store.topic(third.id));
  assert.equal((await f.post(`topics/${third.id}/delete`, { reason: '只删除这条内容' }, 'assistant')).status, 200);
  assert.equal(f.store.members.muted(reader('member')), null);
});

test('identity changes and revoked upstream appointments immediately remove read and mutation authority', async t => {
  const f = await fixture(t), target = f.topic('qa', true);
  assert.equal((await f.get('manage?tab=queue', 'assistant')).status, 200);
  assert.equal((await f.get('manage?tab=queue', 'member')).status, 403, 'the previous request must not leak cached staff authority');
  f.store.staff.revoke(reader('general'), reader('moderator'));
  assert.equal((await f.get('manage?tab=queue', 'assistant')).status, 403);
  assert.equal((await f.post(`topics/${target.id}/approve`, {}, 'assistant')).status, 404, 'revoked staff cannot discover a private pending topic');
  assert.equal(f.store.topic(target.id)?.pending, true);
  const me = await (await f.get('me', 'assistant')).json();
  assert.equal(me.management, null);
  f.accounts.get('general')!.active = false;
  assert.equal((await f.get('manage?tab=queue', 'general')).status, 401);
});

test('management demonstration is explicit and leaves ordinary preview consent unchanged', async t => {
  const demo = await createCommunityDemo({ managementDemo: true });
  let service: ReturnType<typeof demo.service>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); demo.close(); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  service = demo.service(port);
  const get = (path: string, role: string) => fetch(`http://127.0.0.1:${port}/api/community/${path}`, { headers: { Cookie: `preview_as=${role}` } });
  for (const role of ['owner', 'general', 'steward', 'assistant']) assert.equal((await (await get('me', role)).json()).convention.agreed, true);
  assert.equal((await (await get('me', 'demo')).json()).convention.agreed, false);
  const queue = await (await get('manage?tab=queue', 'assistant')).json();
  assert.equal(queue.queue.topics.some((row: { board: string }) => row.board === 'qa'), true);
});

test('the isolated console preview requires the exact loopback host and retains the existing role picker', async t => {
  const preview = await createCommunityConsolePreview({ buildAssets: false });
  t.after(preview.close);
  assert.equal(preview.consoleHref, `${preview.origin}/?communityTheme=light#/community/manage/queue`);
  assert.equal((await fetch(preview.consoleHref)).status, 200);
  const response = await fetch(`${preview.origin}/community-console`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const picker = await fetch(preview.identityHref);
  assert.equal(picker.status, 200);
  const pickerHtml = await picker.text();
  assert.match(pickerHtml, /href="\/\?communityTheme=light#\/community\/manage\/queue"/);
  assert.match(pickerHtml, /原社区管理台本地预览/);
  assert.doesNotMatch(pickerHtml, /新版社区后台/);
  const unauthorizedHost = await new Promise<number | undefined>((done, reject) => {
    const req = request(`${preview.origin}/api/community/me`, { headers: { Host: 'attacker.example' } }, res => { res.resume(); done(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(unauthorizedHost, 403);
  const chosen = await fetch(`${preview.origin}/api/community/preview-identity`, {
    method: 'POST', redirect: 'manual', headers: { Origin: preview.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'role=assistant&theme=light',
  });
  assert.equal(chosen.status, 303);
  assert.equal(chosen.headers.get('location'), '/?communityTheme=light#/community/manage/queue');
  const cookie = chosen.headers.get('set-cookie')!.split(';')[0];
  const me = await (await fetch(`${preview.origin}/api/community/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(me.management.role, 'assistant');
  for (const theme of ['dark', 'https://attacker.example']) {
    const switched = await fetch(`${preview.origin}/api/community/preview-identity`, {
      method: 'POST', redirect: 'manual', headers: { Origin: preview.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ role: 'owner', theme }).toString(),
    });
    assert.equal(switched.status, 303);
    assert.equal(switched.headers.get('location'), '/?communityTheme=dark#/community/manage/queue');
  }
  await preview.close();
  await assert.rejects(stat(preview.directory), { code: 'ENOENT' });
  await preview.close();
});
