import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import { beijingDay } from '../src/community-rules.ts';

const writer: CommunityAuthor = { kind: 'reader', id: 'writer' };
const reporter: CommunityAuthor = { kind: 'reader', id: 'reporter' };
const moderator: CommunityAuthor = { kind: 'reader', id: 'moderator' };
const accounts = new Map([
  ['writer', { name: '作者成员', uid: '101', vip: false }],
  ['reporter', { name: '举报成员', uid: '102', vip: false }],
  ['moderator', { name: '问答版主', uid: '103', vip: false }],
  ['vipmod', { name: '会员版主', uid: '104', vip: true }],
]);
const remove = (path: string) => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-scoped-moderators-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => remove(template));

async function setup(t: TestContext, boards = ['qa', 'showcase'], beforePeople?: () => Promise<void>) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-scoped-moderators-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  await mkdir(resolve(directory, 'uploads'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  for (const id of accounts.keys()) db.prepare("INSERT INTO community_members(member_kind, member_id, level, level_day, agreed_at, created_at) VALUES('reader', ?, 1, ?, ?, ?)").run(id, beijingDay(Date.now()), new Date().toISOString(), new Date().toISOString());
  db.close();
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [{ kind: 'owner', id: 'owner' }, ...[...accounts.keys()].map(id => ({ kind: 'reader' as const, id }))]);
  const audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({
    store, directory, siteOrigin: origin,
    identify: async req => {
      const id = String(req.headers.cookie || 'moderator').split(';')[0];
      if (id === 'owner') return { kind: 'owner', id: 'owner', name: '無相', vip: true };
      const info = accounts.get(id);
      return info ? { kind: 'reader', id, name: info.name, vip: info.vip } : null;
    },
    people: async authors => {
      if(authors.some(author=>author.id!==moderator.id))await beforePeople?.();
      return new Map(authors.flatMap(author => {
      const info = author.kind === 'owner' ? { name: '無相', uid: 'owner', vip: true } : accounts.get(author.id);
      return info ? [[`${author.kind}:${author.id}`, { ...info, avatar: null, joinedAt: null, bio: '',active:true }]] : [];
      }));
    },
    findMember: async uid => {
      if (uid === 'owner') return { kind: 'owner', id: 'owner' };
      const found = [...accounts].find(([, info]) => info.uid === uid);
      return found ? { kind: 'reader', id: found[0] } : null;
    },
    findByNames: async names => new Map([...accounts].filter(([, info]) => names.includes(info.name))
      .map(([id, info]) => [info.name, { kind: 'reader' as const, id }])),
    audit: async (action, details) => { audits.push({ action, details }); },
  });
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    store.close(); await remove(directory);
  });
  const get = (path: string, identity = 'moderator') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: identity } });
  const post = (path: string, body: Record<string, unknown>, identity = 'moderator') => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { cookie: identity, origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  store.members.setSteward(moderator,true,boards); // Existing legacy appointment remains directly adjustable by its owner.
  assert.equal((await post('members/103/steward', { on: true, boards }, 'owner')).status, 200);
  const topic = (board: string, pending = false, author = writer) => store.createTopic({ board, author, title: `${board}测试帖子`, body: '完整的板块测试正文内容', ...(pending ? { pending: '需要审核' } : {}) });
  return { get, post, store, topic, audits, directory };
}

type Managed = {
  moderationBoards: string[];
  queue: { topics: Array<{ id: string; board: string }>; replies: Array<{ id: string; board: string }> };
  reports: Array<{ id: string; target: { board: string | null } }>;
  content: Array<{ id: string; board: string }>;
  counts: { queue: number; reports: number };
  kpis: { topics24h: number; replies24h: number };
  data: { flow: unknown[]; boards: Array<{ id: string; topics: number }> };
};
type Thread = {
  topic: { canDelete: boolean; canModerate: boolean; canRetag: boolean; canReply: boolean; deleteReasonRequired: boolean };
  replies: Array<{ id: string; body: string; images: unknown[]; canDelete: boolean; canRestore: boolean; quote: unknown }>;
  mentions: Record<string, string>;
};
const json = async <T>(response: Promise<Response>): Promise<T> => (await (await response).json()) as T;

test('scoped work queues, content, counts and activity exclude other boards before serialization', async t => {
  const { get, store, topic } = await setup(t);
  const qaPending = topic('qa', true), toolsPending = topic('tools', true);
  const qa = topic('qa'), tools = topic('tools');
  const qaReply = store.addReply({ topicId: qa.id, author: reporter, body: '问答板块隐藏回复内容' });
  const toolsReply = store.addReply({ topicId: tools.id, author: reporter, body: '资源板块隐藏回复内容' });
  for (const id of [qaReply.id, toolsReply.id]) store.hide({ kind: 'reply', id }, '等待处理');
  for (const target of [{ kind: 'topic' as const, id: qaPending.id }, { kind: 'topic' as const, id: toolsPending.id }, { kind: 'reply' as const, id: qaReply.id }, { kind: 'reply' as const, id: toolsReply.id }]) store.report({ target, reporter, reason: '其他' });
  const managed = await json<Managed>(get('manage?tab=content'));
  assert.deepEqual(managed.moderationBoards, ['qa', 'showcase']);
  assert.deepEqual(managed.queue.topics.map(row => row.id), [qaPending.id]);
  assert.deepEqual(managed.queue.replies.map(row => row.id), [qaReply.id]);
  assert.deepEqual(managed.reports.map(row => row.target.board), ['qa', 'qa']);
  assert.deepEqual(managed.content.map(row => row.id), [qa.id]);
  assert.deepEqual(managed.counts, { queue: 2, reports: 2, orders: 0, sanctions: 0 });
  assert.deepEqual(managed.kpis, { topics24h: 2, replies24h: 1 });
  const stats = await json<Managed>(get('manage?tab=data'));
  assert.deepEqual(stats.data.flow, [], 'a board assignment does not grant access to the global currency ledger');
  assert.deepEqual(stats.data.boards.map(board => board.id), ['qa', 'showcase']);
  assert.equal((await json<{ manageTodo: number }>(get('me'))).manageTodo, 4);
});

test('out-of-scope topic and reply moderation fails without changing content or creating audits', async t => {
  const { post, get, store, topic, audits } = await setup(t);
  const other = topic('tools'), pending = topic('tools', true);
  const reply = store.addReply({ topicId: other.id, author: reporter, body: '资源板块的正常回复' });
  audits.length = 0;
  for (const action of ['pin', 'lock', 'approve', 'restore', 'retag', 'delete', 'move']) {
    const body = action === 'retag' ? { tags: ['效率'] } : action === 'move' ? { board: 'qa' } : { on: true, reason: '违规内容处理' };
    assert.equal((await post(`topics/${other.id}/${action}`, body)).status, 403, action);
  }
  assert.equal((await post(`replies/${reply.id}/delete`, { reason: '违规回复处理' })).status, 403);
  assert.equal((await post(`replies/${reply.id}/restore`, {})).status, 403);
  assert.equal((await post(`manage/topics/${pending.id}/reject`, { reason: '重复内容' })).status, 403);
  const thread = await json<Thread>(get(`topics/${other.id}`));
  assert.equal(thread.topic.canModerate, false); assert.equal(thread.topic.canDelete, false); assert.equal(thread.topic.canRetag, false);
  assert.equal(thread.replies[0].canDelete, false); assert.equal(thread.replies[0].canRestore, false);
  assert.equal(store.topic(other.id)?.board, 'tools'); assert.equal(store.topic(other.id)?.locked, false);
  assert.equal(store.topic(pending.id)?.pending, true); assert.ok(store.reply(reply.id));
  assert.equal(audits.length, 0);
});

test('bulk review validates every selected parent board before any rewards, notifications or deletion', async t => {
  const { post, store, topic, audits } = await setup(t);
  const allowed = topic('qa', true), denied = topic('tools', true);
  const balance = store.ledger.balance(writer), notices = store.members.inbox(writer).length;
  audits.length = 0;
  for (const action of ['approve', 'reject']) {
    assert.equal((await post('manage/review', { ids: [allowed.id, denied.id], action, reason: '重复内容' })).status, 403);
    assert.equal(store.topic(allowed.id)?.pending, true); assert.equal(store.topic(denied.id)?.pending, true);
    assert.equal(store.ledger.balance(writer), balance); assert.equal(store.members.inbox(writer).length, notices);
    assert.equal(audits.length, 0);
  }
  assert.equal((await post('manage/review', { ids: [allowed.id], action: 'approve' })).status, 200);
  assert.equal(store.topic(allowed.id)?.pending, false);
});

test('report decisions authorize the real parent board and orphan targets remain owner-only', async t => {
  const { get, post, store, topic, audits } = await setup(t);
  const allowed = topic('qa'), denied = topic('tools'), gone = topic('qa');
  const reply = store.addReply({ topicId: denied.id, author: writer, body: '被举报的资源板块回复' });
  const valid = store.report({ target: { kind: 'topic', id: allowed.id }, reporter, reason: '其他' });
  const out = store.report({ target: { kind: 'reply', id: reply.id }, reporter, reason: '其他' });
  store.deleteTopic(gone.id);
  const orphan = store.report({ target: { kind: 'topic', id: gone.id }, reporter, reason: '其他' });
  const before = store.openReports().length, balance = store.ledger.balance(reporter);
  audits.length = 0;
  for (const id of [out.id, orphan.id]) for (const uphold of [false, true]) {
    assert.equal((await post(`manage/reports/${id}`, { uphold, reason: '违规内容处理' })).status, 403);
  }
  assert.equal(store.openReports().length, before); assert.equal(store.ledger.balance(reporter), balance); assert.equal(audits.length, 0);
  const managed = await json<Managed>(get('manage?tab=reports'));
  assert.deepEqual(managed.reports.map(row => row.id), [valid.id]);
  assert.equal((await post(`manage/reports/${valid.id}`, { uphold: false })).status, 200);
  assert.equal((await post(`manage/reports/${orphan.id}`, { uphold: false }, 'owner')).status, 200);
});

test('moving a topic requires both its source and destination boards while ordinary self deletion remains usable', async t => {
  const { get, post, store, topic } = await setup(t);
  const allowed = topic('qa'), denied = topic('tools');
  assert.equal((await post(`topics/${allowed.id}/move`, { board: 'tools' })).status, 403);
  assert.equal(store.topic(allowed.id)?.board, 'qa');
  assert.equal((await post(`topics/${denied.id}/move`, { board: 'qa' })).status, 403);
  assert.equal((await post(`topics/${allowed.id}/move`, { board: 'showcase' })).status, 200);
  assert.equal(store.topic(allowed.id)?.board, 'showcase');
  const own = topic('tools', false, moderator);
  const ownThread = await json<Thread>(get(`topics/${own.id}`));
  assert.equal(ownThread.topic.canDelete, true); assert.equal(ownThread.topic.deleteReasonRequired, false);
  assert.equal((await post(`topics/${own.id}/delete`, {})).status, 200, 'own content follows ordinary author rights outside the assigned boards');
});

test('hidden replies, quotes and pending topic assets use their parent board rather than a global moderator flag', async t => {
  const { get, store, topic, directory } = await setup(t);
  const allowed = topic('qa'), denied = topic('tools'), pending = topic('tools', true);
  const hidden = store.addReply({ topicId: denied.id, author: writer, body: '不应该泄漏的资源隐藏回复 @举报成员' });
  store.hide({ kind: 'reply', id: hidden.id }, '隐藏回复');
  const quoted = store.addReply({ topicId: denied.id, author: reporter, body: '引用隐藏回复的正常正文', quoteId: hidden.id });
  const inScope = store.addReply({ topicId: allowed.id, author: writer, body: '问答板块的隐藏回复' });
  store.hide({ kind: 'reply', id: inScope.id }, '隐藏回复');
  const outside = await json<Thread>(get(`topics/${denied.id}`));
  assert.equal(outside.replies.find(row => row.id === hidden.id)?.body, '');
  assert.equal(outside.replies.find(row => row.id === quoted.id)?.quote, null);
  assert.equal(outside.mentions['举报成员'], undefined, 'mentions derived from hidden reply text cannot reveal the concealed body');
  assert.equal((await get(`topics/${pending.id}`)).status, 404);
  assert.equal((await json<Thread>(get(`topics/${allowed.id}`))).replies[0].body, '问答板块的隐藏回复');
  const image = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  store.addImage({ id: image, uploader: writer, width: 20, height: 20 });
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.prepare('UPDATE community_images SET topic_id=? WHERE id=?').run(pending.id, image); db.close();
  await writeFile(resolve(directory, 'uploads', `community-image-${image}.webp`), 'test-image');
  assert.equal((await get(`images/${image}.webp`)).status, 404);
  assert.equal((await get(`images/${image}.webp`, 'owner')).status, 200);
});

test('appointed VIP board access is separate from VIP membership and expires with scope changes', async t => {
  const { get, post, topic, store } = await setup(t, ['vip']);
  const vip = topic('vip', true), qa = topic('qa', true);
  const profile = await json<{ vip: boolean; moderationBoards: string[] }>(get('me'));
  assert.equal(profile.vip, false); assert.deepEqual(profile.moderationBoards, ['vip']);
  assert.equal((await get(`topics/${vip.id}`)).status, 200);
  assert.equal((await post(`topics/${vip.id}/approve`, {})).status, 200);
  assert.equal((await post(`topics/${qa.id}/approve`, {})).status, 404, 'unassigned pending content remains invisible');
  assert.equal((await post('members/103/steward', { on: true, boards: ['qa'] }, 'owner')).status, 200);
  assert.equal((await get(`topics/${vip.id}`)).status, 404);
  assert.equal(store.topic(qa.id)?.pending, true);
  assert.equal((await get(`topics/${vip.id}`, 'moderator; community_browse=reader')).status, 404);
});

test('synthetic appointed level does not grant stronger reports outside scope and global mute tools remain explicitly available', async t => {
  const { post, get, store, topic } = await setup(t);
  const denied = topic('tools'), allowed = topic('qa');
  const outside = await json<{ hidden: boolean }>(post('reports', { kind: 'topic', id: denied.id, reason: '其他' }));
  assert.equal(outside.hidden, false); assert.equal(store.topic(denied.id)?.hidden, false);
  const inside = await json<{ hidden: boolean }>(post('reports', { kind: 'topic', id: allowed.id, reason: '其他' }));
  assert.equal(inside.hidden, true);
  assert.equal((await post('members/102/mute', { days: 1, reason: '人身攻击' })).status, 200);
  const sanctions = await json<{ sanctions: Array<{ id: string }> }>(get('manage?tab=sanctions'));
  assert.equal((await post(`manage/sanctions/${sanctions.sanctions[0].id}/lift`, {})).status, 200);
  assert.equal((await post('members/102/steward', { on: true, boards: ['tools'] })).status, 403);
});

test('a moved report follows its current parent board and withdrawn assignments immediately remove old authority', async t => {
  const { get, post, store, topic, audits } = await setup(t);
  const subject = topic('qa');
  const report = store.report({ target: { kind: 'topic', id: subject.id }, reporter, reason: '其他' });
  assert.equal((await post(`topics/${subject.id}/move`, { board: 'tools' }, 'owner')).status, 200);
  audits.length = 0;
  assert.equal((await post(`manage/reports/${report.id}`, { uphold: true, reason: '违规内容处理' })).status, 403);
  assert.ok(store.topic(subject.id)); assert.equal(audits.length, 0);
  assert.deepEqual((await json<Managed>(get('manage?tab=reports'))).reports, []);
  const pending = topic('qa', true);
  assert.equal((await post('members/103/steward', { on: true, boards: ['showcase'] }, 'owner')).status, 200);
  assert.equal((await post('manage/review', { action: 'approve', ids: [pending.id] })).status, 403);
  assert.equal(store.topic(pending.id)?.pending, true);
});

test('earned night-watch capabilities remain ordinary reader privileges outside a moderator assignment', async t => {
  const { get, post, store, topic, directory } = await setup(t);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.prepare("UPDATE community_members SET level=3, level_day=? WHERE member_kind='reader' AND member_id='moderator'").run(beijingDay(Date.now()));
  db.close();
  const subject = topic('tools');
  assert.equal((await post(`topics/${subject.id}/retag`, { tags: ['效率'] })).status, 200);
  assert.deepEqual(store.topic(subject.id)?.tags, ['效率']);
  const detail = await json<Thread>(get(`topics/${subject.id}`));
  assert.equal(detail.topic.canRetag, true); assert.equal(detail.topic.canModerate, false);
  assert.equal((await post(`topics/${subject.id}/pin`, { on: true })).status, 403);
  const reported = await json<{ hidden: boolean }>(post('reports', { kind: 'topic', id: subject.id, reason: '其他' }));
  assert.equal(reported.hidden, true, 'existing earned L3 report rules remain in effect independently of appointed boards');
});

test('appointment does not bypass ordinary newcomer posting, rewards, reply limits and edit windows', async t => {
  const { get, post, store, topic, directory } = await setup(t);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.prepare("UPDATE community_members SET level=0, level_day=? WHERE member_kind='reader' AND member_id='moderator'").run(beijingDay(Date.now()));
  db.close();
  const other = topic('tools');
  const balance = store.ledger.balance(writer);
  assert.equal((await post(`topics/${other.id}/like`, { on: true })).status, 200);
  assert.equal(store.ledger.balance(writer), balance, 'an appointed L0 like cannot issue reward credit');
  assert.equal((await post(`topics/${other.id}/thank`, {})).status, 403);
  for (let index = 0; index < 10; index++) store.addReply({ topicId: other.id, author: moderator, body: `今天回复第${index}条内容` });
  assert.equal((await post(`topics/${other.id}/replies`, { body: '今天第十一条回复正文' })).status, 429);
  const oldTime = new Date(Date.now() - 48 * 3600e3).toISOString();
  const oldTopic = store.createTopic({ board: 'tools', author: moderator, title: '超过编辑期限的帖子', body: '超过编辑期限的正文内容', now: oldTime });
  const oldReply = store.addReply({ topicId: other.id, author: moderator, body: '超过编辑期限的回复正文', now: oldTime });
  assert.equal((await post(`topics/${oldTopic.id}/edit`, { title: '修改超过期限的帖子', body: '这段修改不能被提交成功' })).status, 403);
  assert.equal((await post(`replies/${oldReply.id}/edit`, { body: '这段修改不能被提交成功' })).status, 403);
  const image = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  store.addImage({ id: image, uploader: moderator, width: 20, height: 20 });
  const created = await json<{ id: string; pending: boolean }>(post('topics', {
    board: 'tools', title: '新人带图片的资源帖子', body: `新人资源正文内容\n\n![图片](/api/community/images/${image}.webp)`, images: [image],
  }));
  assert.equal(created.pending, true, 'appointment cannot skip newcomer review for posting in another board');
  assert.equal((await json<{ mod: boolean; level: number }>(get('me'))).mod, true, 'content limits do not remove the assigned management permission');
});

test('VIP board moderation access does not grant non-members VIP posting or reply benefits', async t => {
  const { get, post, store, topic } = await setup(t, ['vip']);
  const published = topic('vip'), pending = topic('vip', true);
  const before = store.postedToday(moderator), balance = store.ledger.balance(moderator);
  const image = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  store.addImage({ id: image, uploader: moderator, width: 20, height: 20 });
  assert.equal((await get(`topics/${published.id}`)).status, 200);
  assert.equal((await post('topics', { board: 'vip', title: '版主会员普通帖子', body: `会员帖子正文内容\n\n![图片](/api/community/images/${image}.webp)`, images: [image] })).status, 403);
  assert.equal((await post(`topics/${published.id}/replies`, { body: '非会员版主普通回复内容' })).status, 403);
  assert.deepEqual(store.postedToday(moderator), before);
  assert.equal(store.ledger.balance(moderator), balance);
  assert.equal((await json<Thread>(get(`topics/${published.id}`))).topic.canReply, false);
  assert.equal((await post(`topics/${pending.id}/approve`, {})).status, 200, 'appointment still grants assigned VIP moderation');
  assert.equal((await post(`topics/${published.id}/replies`, { body: '真实会员保留普通回复资格' }, 'vipmod')).status, 201);
  assert.equal((await post(`topics/${published.id}/replies`, { body: '作者保留管理及回复资格' }, 'owner')).status, 201);
});

test('quoting a reply requires visibility and preserves normal same-topic quotes without rejection side effects', async t => {
  const { post, store, topic } = await setup(t);
  const outside = topic('tools'), inside = topic('qa');
  const hidden = store.addReply({ topicId: outside.id, author: reporter, body: '不能被其他版主引用的隐藏内容' });
  const allowedHidden = store.addReply({ topicId: inside.id, author: reporter, body: '本板块隐藏回复内容' });
  for (const id of [hidden.id, allowedHidden.id]) store.hide({ kind: 'reply', id }, '等待处理');
  const before = store.postedToday(moderator), balance = store.ledger.balance(moderator);
  const notices = store.members.inbox(reporter).length;
  assert.equal((await post(`topics/${outside.id}/replies`, { body: '不应该成功引用隐藏回复', quote: hidden.id })).status, 404);
  assert.deepEqual(store.postedToday(moderator), before);
  assert.equal(store.ledger.balance(moderator), balance); assert.equal(store.members.inbox(reporter).length, notices);
  const normal = store.addReply({ topicId: outside.id, author: reporter, body: '可见的普通回复内容' });
  assert.equal((await post(`topics/${outside.id}/replies`, { body: '普通的同帖引用回复内容', quote: normal.id })).status, 201);
  assert.equal((await post(`topics/${outside.id}/replies`, { body: '不能跨帖引用正常回复内容', quote: allowedHidden.id })).status, 400);
  assert.equal((await post(`topics/${inside.id}/replies`, { body: '本板块管理引用隐藏回复内容', quote: allowedHidden.id })).status, 201);
});

test('awaited people lookup cannot release stale hidden content or management queues after scope changes', async t => {
  let pause = false;
  let entered: () => void = () => {}, release: () => void = () => {};
  let arrived: Promise<void>, resumed: Promise<void>;
  const { get, post, store, topic } = await setup(t, ['qa'], async () => {
    if (!pause) return;
    pause = false; entered(); await resumed;
  });
  t.after(() => release());
  const hidden = topic('qa'), published = topic('qa'), pending = topic('qa', true);
  store.hide({ kind: 'topic', id: hidden.id }, '等待处理');
  const reply = store.addReply({ topicId: published.id, author: reporter, body: '撤权后不能泄漏的隐藏回复内容 @作者成员' });
  store.hide({ kind: 'reply', id: reply.id }, '等待处理');
  for (const path of [`topics/${hidden.id}`, `topics/${published.id}`, 'manage?tab=queue']) {
    assert.equal((await post('members/103/steward', { on: true, boards: ['qa'] }, 'owner')).status, 200);
    arrived = new Promise<void>(done => { entered = done; });
    resumed = new Promise<void>(done => { release = done; });
    pause = true;
    const response = get(path);
    await arrived;
    assert.equal((await post('members/103/steward', { on: true, boards: ['tools'] }, 'owner')).status, 200);
    release();
    const result = await response;
    assert.ok([403, 404].includes(result.status), `${path} cannot send content selected under the old board authority`);
  }
  assert.equal(store.topic(pending.id)?.pending, true);
});

for (const path of ['thread', 'manage?tab=queue', 'manage?tab=reports', 'manage?tab=content']) {
  test(`${path} cannot disclose an old parent board after a topic moves during people lookup`, async t => {
    let pause = false;
    let entered: () => void = () => {}, release: () => void = () => {};
    const arrived = new Promise<void>(done => { entered = done; });
    const resumed = new Promise<void>(done => { release = done; });
    const { get, post, store, topic } = await setup(t, ['qa'], async () => {
      if (!pause) return;
      pause = false; entered(); await resumed;
    });
    t.after(() => release());
    const published = topic('qa');
    const hidden = store.addReply({ topicId: published.id, author: reporter, body: '移至其他板块后不能泄漏的隐藏回复内容 @作者成员' });
    store.hide({ kind: 'reply', id: hidden.id }, '等待处理');
    store.report({ target: { kind: 'reply', id: hidden.id }, reporter: writer, reason: '其他' });
    pause = true;
    const response = get(path === 'thread' ? `topics/${published.id}` : path);
    await arrived;
    assert.equal((await post(`topics/${published.id}/move`, { board: 'tools' }, 'owner')).status, 200);
    release();
    assert.equal((await response).status, 403);
    assert.equal(store.topic(published.id)?.board, 'tools');
    assert.deepEqual((await json<{ moderationBoards: string[] }>(get('me'))).moderationBoards, ['qa'], 'the assignment itself has not changed');
  });
}
