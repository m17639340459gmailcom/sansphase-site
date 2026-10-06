import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { communityBoards } from '../src/community.mjs';
import { beijingDay, communityRules } from '../src/community-rules.mjs';
import type { CommunityAuthor } from '../server/community-db.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const reader: CommunityAuthor = { kind: 'reader', id: 'reader' };
const moderator: CommunityAuthor = { kind: 'reader', id: 'moderator' };
const candidate: CommunityAuthor = { kind: 'reader', id: 'candidate' };
const boardIds = communityBoards.map(board => board.id);
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-scopes-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function setup(t: TestContext, simplePosting = true) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-scopes-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  await mkdir(resolve(directory, 'uploads'));
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [reader, moderator, candidate, { kind: 'owner', id: 'owner' }]);
  for (const member of [reader, moderator, candidate]) store.members.visit(member);
  const audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  const accounts = new Map([['reader', { uid: '10001', name: '读者' }], ['candidate', { uid: '10002', name: '候选' }], ['moderator', { uid: '10003', name: '版主' }]]);
  const waitingBodyReads = new Map<string, () => void>();
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => {
    const marker = String(req.headers['x-test-slow-request'] || '');
    if (marker) req.on('newListener', event => {
      if (event === 'readable') waitingBodyReads.get(marker)?.();
    });
    void service.handle(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({
    store, siteOrigin: origin, directory, simplePosting,
    identify: async req => {
      const id = String(req.headers.cookie || 'reader').split(';')[0];
      if (id === 'owner') return { kind: 'owner', id: 'owner', name: '無相', vip: true };
      const info = accounts.get(id);
      return info ? { kind: 'reader', id, name: info.name, vip: false } : null;
    },
    people: async authors => new Map(authors.flatMap(author => {
      const info = author.kind === 'owner' ? { name: '無相', uid: 'owner' } : accounts.get(author.id);
      return info ? [[`${author.kind}:${author.id}`, { ...info, avatar: null, vip: false, joinedAt: null, bio: '' }]] : [];
    })),
    findMember: async uid => {
      if (uid === 'owner') return { kind: 'owner', id: 'owner' };
      const match = [...accounts].find(([, info]) => info.uid === uid);
      return match ? { kind: 'reader', id: match[0] } : null;
    },
    audit: async (action, details) => { audits.push({ action, details }); },
  });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await cleanup(directory); });
  const get = (path: string, identity = 'owner') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: identity } });
  const post = (path: string, body: Record<string, unknown>, identity = 'owner') => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { cookie: identity, origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  // Wait until readJson starts its async iterator, after the request context has been created.
  const slowPost = async (path: string, body: Record<string, unknown>, beforeFinish: () => Promise<void>) => {
    const marker = randomUUID(), payload = JSON.stringify(body);
    let ready: () => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    const bodyReading = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
    waitingBodyReads.set(marker, ready);
    const deadline = setTimeout(() => rejectReady(Error('The server did not begin reading the partial request body.')), 3000);
    let client: ReturnType<typeof request>;
    const response = new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      client = request(`${origin}/api/community/${path}`, {
        method: 'POST', headers: { cookie: 'moderator', origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Test-Slow-Request': marker },
      }, incoming => {
        const chunks: Buffer[] = [];
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => resolve({ status: incoming.statusCode || 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        incoming.on('error', reject);
      });
      client.on('error', reject);
      client.write(payload.slice(0, 1));
    });
    response.catch(() => {});
    try {
      await bodyReading;
      await beforeFinish();
      client!.end(payload.slice(1));
      return await response;
    } finally {
      clearTimeout(deadline);
      waitingBodyReads.delete(marker);
      client!.destroy();
    }
  };
  return { directory, store, audits, get, post, slowPost };
}

test('stored moderator scopes persist independently of automatic trust and retain legacy internal appointments', async t => {
  const { store, directory } = await setup(t);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.prepare("UPDATE community_members SET level=2, level_day=? WHERE member_kind='reader' AND member_id=?").run(beijingDay(Date.now()), moderator.id);
  db.close();
  assert.equal(store.members.trustLevel(moderator), 2);
  store.members.setSteward(moderator, true, ['qa', 'tools']);
  assert.deepEqual(store.members.moderationBoards(moderator), ['qa', 'tools']);
  assert.equal(store.members.level(moderator), 4, 'the existing appointed role label remains compatible');
  assert.equal(store.members.trustLevel(moderator), 2, 'appointment never promotes automatic trust');
  const reopened = createCommunityStore(directory);
  try { assert.deepEqual(reopened.members.moderationBoards(moderator), ['qa', 'tools']); } finally { reopened.close(); }
  store.members.setSteward(moderator, false);
  assert.deepEqual(store.members.moderationBoards(moderator), []);
  assert.equal(store.members.level(moderator), 2);
  store.members.setSteward(moderator, true);
  assert.deepEqual(store.members.moderationBoards(moderator), boardIds, 'omitted internal scopes retain legacy all-board fixtures');
  assert.deepEqual(store.members.moderationBoards(reader), []);
  assert.deepEqual(store.members.moderationBoards({ kind: 'owner', id: 'owner' }), boardIds);
});

test('corrupt or unknown stored scope data fails closed instead of restoring global moderation', async t => {
  const { store, directory, get, post } = await setup(t);
  store.members.setSteward(moderator, true, ['qa']);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  try {
    for (const raw of ['broken-json', '{}', '"qa"', '["qa","unknown"]', '["qa",3]', '[]']) {
      db.prepare("UPDATE community_members SET steward_boards=? WHERE member_id=?").run(raw, moderator.id);
      assert.deepEqual(store.members.moderationBoards(moderator), [], raw);
      const me = await (await get('me', 'moderator')).json();
      assert.equal(me.mod, false, `corrupt scope cannot retain global moderation: ${raw}`);
      assert.deepEqual(me.moderationBoards, []);
      assert.equal((await post('members/10001/mute', { days: 1, reason: '人身攻击' }, 'moderator')).status, 403);
    }
    db.prepare("UPDATE community_members SET steward_boards=NULL WHERE member_id=?").run(moderator.id);
    assert.deepEqual(store.members.moderationBoards(moderator), boardIds, 'only the explicit legacy NULL retains previous global assignments');
  } finally { db.close(); }
});

test('public appointment requires explicit valid scopes and owner permissions before any mutation', async t => {
  const { store, audits, post } = await setup(t);
  for (const body of [
    { on: true }, { on: true, boards: [] }, { on: true, boards: 'qa' }, { on: true, boards: ['missing'] },
    { on: true, boards: ['qa', 'qa'] }, { on: true, boards: ['qa', 1] }, { on: 'true', boards: ['qa'] },
  ]) {
    assert.equal((await post('members/10002/steward', body)).status, 400, JSON.stringify(body));
    assert.equal(store.members.steward(candidate), false);
  }
  store.members.setSteward(moderator, true, ['qa']);
  for (const identity of ['reader', 'moderator', 'owner; community_browse=reader'])
    assert.equal((await post('members/10002/steward', { on: true, boards: ['tools'] }, identity)).status, 403, identity);
  assert.equal(audits.length, 0);
  assert.equal((await post('members/10002/steward', { on: true, boards: ['tools', 'qa'] })).status, 200);
  assert.deepEqual(store.members.moderationBoards(candidate), ['qa', 'tools'], 'scope order is canonical');
  assert.equal((await post('members/10002/steward', { on: true, boards: ['showcase'] })).status, 200);
  assert.deepEqual(store.members.moderationBoards(candidate), ['showcase']);
  const me = await (await post('members/10002/steward', { on: false })).json();
  assert.deepEqual(me, { steward: false });
  assert.deepEqual(store.members.moderationBoards(candidate), []);
  assert.deepEqual(audits.map(row => row.details.boards), [['qa', 'tools'], ['showcase'], []]);
  const notices = store.members.inbox(candidate, 'system');
  assert.ok(notices.some(notice => notice.data?.steward === true && JSON.stringify(notice.data.boards) === '["showcase"]'));
});

test('member and current viewer DTOs expose explicit assigned boards without granting VIP benefits', async t => {
  const { store, get } = await setup(t);
  store.members.setSteward(moderator, true, ['qa', 'vip']);
  const me = await (await get('me', 'moderator')).json();
  assert.deepEqual(me.moderationBoards, ['qa', 'vip']);
  assert.equal(me.mod, true);
  assert.equal(me.vip, false);
  const member = await (await get('members/10003')).json();
  assert.deepEqual(member.person.moderationBoards, ['qa', 'vip']);
  const readerMe = await (await get('me', 'reader')).json();
  assert.deepEqual(readerMe.moderationBoards, []);
  const ownerMe = await (await get('me')).json();
  assert.deepEqual(ownerMe.moderationBoards, boardIds);
  const browse = await (await get('me', 'moderator; community_browse=reader')).json();
  assert.deepEqual(browse.moderationBoards, []);
  assert.equal(browse.mod, false);
  assert.equal(browse.vip, false);
});

test('hidden content images are confined to the assigned parent board including VIP and reader browsing mode', async t => {
  const { store, get, directory } = await setup(t);
  store.members.setSteward(moderator, true, ['qa', 'vip']);
  for (const board of ['qa', 'showcase', 'vip']) {
    const id = randomUUID();
    store.addImage({ id, uploader: reader, width: 32, height: 32 });
    await writeFile(resolve(directory, 'uploads', `community-image-${id}.webp`), 'test-image');
    const topic = store.createTopic({ board, author: reader, title: '图片权限测试', body: '图片完整内容', images: [id], pending: '待审' });
    assert.equal((await get(`images/${id}.webp`, 'moderator')).status, board === 'showcase' ? 404 : 200, board);
    assert.equal((await get(`images/${id}.webp`, 'moderator; community_browse=reader')).status, 404, `browse ${board}`);
    assert.equal((await get(`images/${id}.webp`)).status, 200, `owner ${board}`);
    store.approveTopic(topic.id);
    const replyImage = randomUUID();
    store.addImage({ id: replyImage, uploader: reader, width: 32, height: 32 });
    await writeFile(resolve(directory, 'uploads', `community-image-${replyImage}.webp`), 'test-reply-image');
    const reply = store.addReply({ topicId: topic.id, author: reader, body: '隐藏回复的图片', images: [replyImage] });
    store.hide({ kind: 'reply', id: reply.id }, '举报');
    assert.equal((await get(`images/${replyImage}.webp`, 'moderator')).status, board === 'showcase' ? 404 : 200, `reply ${board}`);
  }
});

test('viewer task totals count only review and report work within assigned boards', async t => {
  const { store, get } = await setup(t);
  store.members.setSteward(moderator, true, ['qa']);
  for (const board of ['qa', 'tools']) {
    const topic = store.createTopic({ board, author: reader, title: '按板块审核测试', body: '需要审核的内容', pending: '审核' });
    store.report({ target: { kind: 'topic', id: topic.id }, reporter: candidate, reason: '其他' });
    const reply = store.addReply({ topicId: topic.id, author: candidate, body: '需要处理的回复内容' });
    store.hide({ kind: 'reply', id: reply.id }, '举报');
    store.report({ target: { kind: 'reply', id: reply.id }, reporter: reader, reason: '其他' });
  }
  assert.equal((await (await get('me', 'moderator')).json()).manageTodo, 4);
  assert.equal((await (await get('me')).json()).manageTodo, 8);
  assert.equal((await (await get('me', 'moderator; community_browse=reader')).json()).manageTodo, 0);
});

test('scoped activity includes pending posts and hidden replies while omitting other boards', async t => {
  const { store } = await setup(t);
  for (const board of ['qa', 'tools']) {
    store.createTopic({ board, author: reader, title: '待审的主题', body: '完整正文', pending: '审核' });
    const topic = store.createTopic({ board, author: reader, title: '已发布的主题', body: '完整正文' });
    const reply = store.addReply({ topicId: topic.id, author: candidate, body: '完整回复' });
    store.hide({ kind: 'reply', id: reply.id }, '举报');
  }
  assert.deepEqual(store.activity(Date.now(), ['qa']), { topics24h: 2, replies24h: 1, boards: { qa: 1 } });
  assert.deepEqual(store.activity(Date.now(), []), { topics24h: 0, replies24h: 0, boards: {} });
  assert.deepEqual(store.activity(Date.now()), { topics24h: 4, replies24h: 2, boards: { qa: 1, tools: 1 } });
});

test('appointed role labels do not grant automatic trust or minimum-level redemption benefits', async t => {
  const { store, get, post } = await setup(t);
  store.members.setSteward(moderator, true, ['qa']);
  store.ledger.credit(moderator, 20000, 'test', null, new Date().toISOString());
  const me = await (await get('me', 'moderator')).json();
  assert.equal(me.mod, true);
  assert.equal(me.level, 4, 'appointment remains visible as an appointed role');
  assert.equal(me.trustLevel, 0, 'ordinary business receives earned trust independently of that role');
  const shop = await (await get('shop', 'moderator')).json();
  assert.equal(shop.level, 0);
  const itemId = store.economy.saveItem(null, { cat: 'digital', name: '需要信任等级的正式资源', description: '权限回归测试', price: 20,
    stock: null, limitPer: null, limitN: null, minLevel: 1, minDays: 0, delivery: '资源内容', note: '', active: true });
  const item = store.economy.item(itemId);
  assert.ok(item);
  const publishedShop = await (await get('shop', 'moderator')).json();
  assert.equal(publishedShop.items.find((entry: { id: string }) => entry.id === item.id).state.code, 'level');
  const balance = store.ledger.balance(moderator);
  assert.equal((await post('shop/redeem', { item: item.id }, 'moderator')).status, 409);
  assert.equal(store.ledger.balance(moderator), balance);
  assert.deepEqual(store.economy.orders(moderator), []);
  const ownerMe = await (await get('me')).json();
  assert.equal(ownerMe.trustLevel, 4, 'the author keeps existing ordinary business permissions');
});

test('a new moderator remains subject to ordinary link and daily posting limits outside assigned boards', async t => {
  const { store, post } = await setup(t, false);
  store.members.setSteward(moderator, true, ['qa']);
  const input = { board: 'moments', title: '', body: '完整的普通帖子正文内容', agree: true };
  const links = Array.from({ length: communityRules.l0Links + 1 }, (_, index) => `https://example.com/${index}`).join(' ');
  assert.equal((await post('topics', { ...input, body: `${input.body} ${links}` }, 'moderator')).status, 400);
  assert.equal(store.postedToday(moderator).topics, 0);
  for (let index = 0; index < communityRules.l0TopicsDaily; index++)
    assert.equal((await post('topics', { ...input, body: `${input.body}${index}` }, 'moderator')).status, 201);
  assert.equal((await post('topics', input, 'moderator')).status, 429);
  assert.equal(store.postedToday(moderator).topics, communityRules.l0TopicsDaily);
});

test('reader browsing cannot use own authorship to access pending topic or hidden reply images', async t => {
  const { store, get, directory } = await setup(t);
  store.members.setSteward(moderator, true, ['qa']);
  const makeImage = async () => {
    const id = randomUUID();
    store.addImage({ id, uploader: moderator, width: 32, height: 32 });
    for (const kind of ['image', 'thumb']) await writeFile(resolve(directory, 'uploads', `community-${kind}-${id}.webp`), 'test-image');
    return id;
  };
  const pendingImage = await makeImage();
  const pending = store.createTopic({ board: 'tools', author: moderator, title: '自己的待审帖子', body: '自己的待审帖子正文', images: [pendingImage], pending: '审核' });
  const publicTopic = store.createTopic({ board: 'tools', author: reader, title: '普通公开帖子', body: '普通公开帖子正文' });
  const replyImage = await makeImage();
  const hiddenReply = store.addReply({ topicId: publicTopic.id, author: moderator, body: '自己的隐藏回复', images: [replyImage] });
  store.hide({ kind: 'reply', id: hiddenReply.id }, '举报');
  assert.equal((await get(`topics/${pending.id}`, 'moderator')).status, 200);
  assert.equal((await get(`topics/${pending.id}`, 'moderator; community_browse=reader')).status, 404);
  const publicThread = await (await get(`topics/${publicTopic.id}`, 'moderator; community_browse=reader')).json();
  assert.equal(publicThread.replies.find((reply: { id: string }) => reply.id === hiddenReply.id).body, '');
  for (const id of [pendingImage, replyImage]) for (const suffix of ['.webp', '.thumb.webp']) {
    assert.equal((await get(`images/${id}${suffix}`, 'moderator')).status, 200, `own content ${id}${suffix}`);
    assert.equal((await get(`images/${id}${suffix}`, 'moderator; community_browse=reader')).status, 404, `reader browsing ${id}${suffix}`);
  }
});

test('a slow review request loses authority when the author changes its assigned boards before the body finishes', async t => {
  const { store, audits, post, slowPost } = await setup(t);
  store.members.setSteward(moderator, true, ['qa']);
  const topic = store.createTopic({ board: 'qa', author: reader, title: '等待审核的主题', body: '等待审核的完整正文', pending: '审核' });
  const balance = store.ledger.balance(reader);
  const response = await slowPost('manage/review', { action: 'approve', ids: [topic.id] }, async () => {
    assert.equal((await post('members/10003/steward', { on: true, boards: ['tools'] })).status, 200);
  });
  assert.equal(response.status, 403);
  assert.equal(store.topic(topic.id)?.pending, true);
  assert.equal(store.ledger.balance(reader), balance);
  assert.equal(audits.some(row => row.action === 'community-bulk-approve-topics'), false);
});

test('a slow global mute request cannot act after the author revokes the moderator appointment', async t => {
  const { store, audits, post, slowPost } = await setup(t);
  store.members.setSteward(moderator, true, ['qa']);
  const response = await slowPost('members/10001/mute', { days: 7, reason: '人身攻击' }, async () => {
    assert.equal((await post('members/10003/steward', { on: false })).status, 200);
  });
  assert.equal(response.status, 403);
  assert.equal(store.members.muted(reader), null);
  assert.equal(audits.some(row => row.action === 'community-mute'), false);
});

test('a slow sanction lift request rechecks active management authority after its body finishes', async t => {
  const { store, audits, post, slowPost } = await setup(t);
  store.members.setSteward(moderator, true, ['qa']);
  store.members.mute(reader, 7, '人身攻击', { kind: 'owner', id: 'owner' });
  const sanction = store.members.muted(reader);
  assert.ok(sanction);
  const response = await slowPost(`manage/sanctions/${sanction.id}/lift`, {}, async () => {
    assert.equal((await post('members/10003/steward', { on: false })).status, 200);
  });
  assert.equal(response.status, 403);
  assert.equal(store.members.muted(reader)?.id, sanction.id);
  assert.equal(audits.some(row => row.action === 'community-lift'), false);
});

test('hidden image responses recheck live board authority after reading the file', async t => {
  const { store, get, directory } = await setup(t);
  const id = randomUUID();
  store.addImage({ id, uploader: reader, width: 32, height: 32 });
  store.createTopic({ board: 'qa', author: reader, title: '图片撤权检查', body: '待审的图片帖子正文', images: [id], pending: '审核' });
  for (const kind of ['image', 'thumb']) await writeFile(resolve(directory, 'uploads', `community-${kind}-${id}.webp`), 'test-image');
  const image = store.image;
  let revokeOnLookup = false;
  store.image = target => {
    const result = image(target);
    if (target === id && revokeOnLookup) {
      revokeOnLookup = false;
      // This runs after the synchronous visibility check but before readFile can resolve.
      queueMicrotask(() => store.members.setSteward(moderator, false));
    }
    return result;
  };
  for (const suffix of ['.webp', '.thumb.webp']) {
    store.members.setSteward(moderator, true, ['qa']);
    revokeOnLookup = true;
    assert.equal((await get(`images/${id}${suffix}`, 'moderator')).status, 404, suffix);
  }
});
