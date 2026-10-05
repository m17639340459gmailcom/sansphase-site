import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const reader: CommunityAuthor = { kind: 'reader', id: 'reader' };
const candidate: CommunityAuthor = { kind: 'reader', id: 'candidate' };
const steward: CommunityAuthor = { kind: 'reader', id: 'steward' };
const accounts = new Map([
  ['reader', { name: '预览读者', uid: '10001' }],
  ['candidate', { name: '候选成员', uid: '10002' }],
  ['steward', { name: '守望', uid: '10003' }],
]);
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-moderators-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function setup(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-moderators-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [reader, candidate, steward, { kind: 'owner', id: 'owner' }]);
  for (const member of [reader, candidate, steward]) store.members.visit(member);
  store.members.setSteward(steward, true);
  const audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({
    store, siteOrigin: origin,
    identify: async req => {
      const id = String(req.headers.cookie || 'reader').split(';')[0];
      if (id === 'owner') return { kind: 'owner', id: 'owner', name: '無相', vip: true };
      const info = accounts.get(id);
      return info ? { kind: 'reader', id, name: info.name, vip: false } : null;
    },
    people: async authors => new Map(authors.flatMap(author => {
      const info = author.kind === 'owner' ? { name: '無相', uid: 'owner' } : accounts.get(author.id);
      return info ? [[`${author.kind}:${author.id}`, { ...info, avatar: null, vip: author.kind === 'owner', joinedAt: null, bio: '' }]] : [];
    })),
    findMember: async uid => {
      if (uid === 'owner') return { kind: 'owner', id: 'owner' };
      const found = [...accounts].find(([, info]) => info.uid === uid);
      return found ? { kind: 'reader', id: found[0] } : null;
    },
    audit: async (action, details) => { audits.push({ action, details }); },
  });
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    await cleanup(directory);
  });
  const get = (path: string, identity = 'owner') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: identity } });
  const post = (path: string, body: Record<string, unknown>, identity = 'owner') => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { cookie: identity, origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { store, audits, get, post };
}

test('author manages the appointed moderator roster using the existing member action', async t => {
  const { get, post, store, audits } = await setup(t);
  const initial = await get('manage?tab=stewards');
  assert.equal(initial.status, 200);
  const first = await initial.json();
  assert.equal(first.tab, 'stewards');
  assert.deepEqual(first.stewards.map((person: { uid: string; name: string; steward: boolean }) => [person.uid, person.name, person.steward]), [['10003', '守望', true]]);
  assert.equal(first.stewards[0].showUid, true, 'the author sees the public member UID needed for removal');

  assert.equal((await post('members/10002/steward', { on: true, boards: ['qa', 'tools'] })).status, 200);
  const appointed = await (await get('manage?tab=stewards')).json();
  assert.deepEqual(appointed.stewards.map((person: { uid: string }) => person.uid).sort(), ['10002', '10003']);
  assert.equal(store.members.steward(candidate), true);
  assert.equal((await post('members/10002/steward', { on: false })).status, 200);
  const removed = await (await get('manage?tab=stewards')).json();
  assert.deepEqual(removed.stewards.map((person: { uid: string }) => person.uid), ['10003']);
  assert.equal(store.members.steward(candidate), false);
  assert.deepEqual(audits.map(row => [row.action, row.details.member, row.details.on]), [
    ['community-steward', 'reader:candidate', true], ['community-steward', 'reader:candidate', false],
  ]);
});

test('moderator roster and appointments stay author-only, including reader browsing mode', async t => {
  const { get, post, store, audits } = await setup(t);
  for (const identity of ['reader', 'steward', 'owner; community_browse=reader', 'steward; community_browse=reader']) {
    assert.equal((await get('manage?tab=stewards', identity)).status, 403, identity);
    assert.equal((await post('members/10002/steward', { on: true, boards: ['qa'] }, identity)).status, 403, identity);
  }
  const normalModerator = await get('manage?tab=queue', 'steward');
  assert.equal(normalModerator.status, 200, 'moderators retain the existing review permission');
  assert.equal((await normalModerator.json()).stewards, undefined, 'other management tabs do not expose the roster');
  assert.equal(store.members.steward(candidate), false);
  assert.equal(audits.length, 0);
});

test('unknown and invalid public member UIDs cannot create a moderator', async t => {
  const { get, post, store, audits } = await setup(t);
  for (const uid of ['missing', '10002%3Badmin', '%3Cscript%3E']) {
    assert.equal((await post(`members/${uid}/steward`, { on: true, boards: ['qa'] })).status, 404);
  }
  assert.equal((await post('members/owner/steward', { on: true, boards: ['qa'] })).status, 400, 'the author cannot appoint themself');
  assert.equal(store.members.steward(candidate), false);
  assert.deepEqual((await (await get('manage?tab=stewards')).json()).stewards.map((person: { uid: string }) => person.uid), ['10003']);
  assert.equal(audits.length, 0);
});

test('review and report DTOs identify the parent board for separate work queues', async t => {
  const { get, store } = await setup(t);
  const topic = store.createTopic({ board: 'qa', author: reader, title: '需要审核的问答', body: '完整的问答正文', pending: '待审核' });
  const parent = store.createTopic({ board: 'tools', author: reader, title: '工具资源讨论', body: '资源的完整说明' });
  const reply = store.addReply({ topicId: parent.id, author: candidate, body: '资源回复的完整说明' });
  store.hide({ kind: 'reply', id: reply.id }, '举报隐藏');
  const topicReport = store.report({ target: { kind: 'topic', id: topic.id }, reporter: candidate, reason: '其他' });
  const replyReport = store.report({ target: { kind: 'reply', id: reply.id }, reporter: reader, reason: '其他' });
  for (const identity of ['owner', 'steward']) {
    const managed = await (await get('manage?tab=queue', identity)).json();
    assert.equal(managed.queue.topics.find((row: { id: string }) => row.id === topic.id).board, 'qa');
    assert.equal(managed.queue.replies.find((row: { id: string }) => row.id === reply.id).board, 'tools');
    assert.equal(managed.reports.find((row: { id: string }) => row.id === topicReport.id).target.board, 'qa');
    assert.equal(managed.reports.find((row: { id: string }) => row.id === replyReport.id).target.board, 'tools');
    assert.equal(managed.counts.queue, 2, 'board metadata does not discard existing review tasks');
  }
});

test('a removed report target has no guessed board and remains available to close', async t => {
  const { get, store } = await setup(t);
  const topic = store.createTopic({ board: 'showcase', author: reader, title: '已删除的作品', body: '作品完整内容' });
  store.deleteTopic(topic.id);
  // A historical reference can outlive its target; normal deletion already closes current reports.
  const report = store.report({ target: { kind: 'topic', id: topic.id }, reporter: candidate, reason: '其他' });
  const managed = await (await get('manage?tab=reports')).json();
  const row = managed.reports.find((item: { id: string }) => item.id === report.id);
  assert.equal(row.target.board, null);
  assert.equal(row.target.gone, true);
  assert.equal(row.target.topicId, null);
  assert.equal(managed.counts.reports, 1);
});
