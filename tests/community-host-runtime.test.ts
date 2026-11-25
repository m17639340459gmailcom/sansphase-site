import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPreviewServer } from '../server.mjs';
import { createIdentityAuthority } from '../server/community-identity-authority.ts';
import { prepareIdentityStore } from '../server/community-identity-store.ts';
import { createIdentityClient, signIdentityRequest } from '../server/community-identity-protocol.ts';
import { createCommunityFrameClient } from '../server/community-frame-client.ts';
import { createCommunityHostStore, prepareCommunityHostDirectory } from '../server/community-host-store.ts';
import { communityHostProductionOptions, createCommunityHostRuntime, readCommunityHostConfig } from '../server/community-host-runtime.ts';
import { prepareTeahouseDirectory } from '../server/teahouse-store.ts';
import { io as socketClient, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { TeahouseMessage } from '../src/teahouse-types.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';
import sharp from 'sharp';
import { createImageVariants } from '../server/image-variants.ts';
import { beijingDay } from '../src/community-rules.ts';
import { bodyImageMarker } from '../src/community-body-images.ts';

const main = 'https://www.sansphase.com';
const community = 'https://community.sansphase.com';
const secret = 'test-bridge-secret-with-at-least-32-characters';
const authorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const readerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const avatarId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const reader = { id: readerId, uid: '10001', nickname: '测试读者', signature: '', avatar: `/api/reader/avatar/${avatarId}.webp`, vip: true, vipStartedAt: '2026-10-01T00:00:00.000Z', vipUntil: '2027-10-01T00:00:00.000Z' };
const observer = { ...reader, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', uid: '10002', nickname: '旁观读者' };
const invitationCode = 'AbCdEfGh12345678_abc-123';
let template: string;
test.before(async () => { template = await mkdtemp(resolve(tmpdir(), 'host-runtime-template-')); await prepareCommunityHostDirectory(template); });
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
async function fixture(t: test.TestContext, withOwner = false, withTeahouse = false, options: { observerNickname?: string } = {}) {
  const observerAccount = { ...observer, nickname: options.observerNickname ?? observer.nickname };
  const base = await mkdtemp(resolve(tmpdir(), 'host-runtime-'));
  const directory = resolve(base, 'private-community');
  const root = resolve(base, 'public');
  const mainDirectory = resolve(base, 'private-main');
  const teaDirectory = resolve(base, 'private-teahouse');
  await mkdir(directory); await mkdir(root); await mkdir(resolve(directory, 'uploads')); await mkdir(mainDirectory);
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  await copyFile(resolve(template, 'community-host.db'), resolve(directory, 'community-host.db'));
  await writeFile(resolve(root, 'index.html'), '<!doctype html><html><head></head><body><main id="app"></main></body></html>');
  await writeFile(resolve(root, 'teahouse.html'), '<!doctype html><title>Tea room</title><main>Real tea room</main>');
  if (withTeahouse) prepareTeahouseDirectory(teaDirectory);
  prepareIdentityStore(mainDirectory);
  const state = { enabled: true, vip: true, vipUntil: reader.vipUntil, unavailable: false, subject: readerId, ownerPersonal: readerId, inactiveReaders: new Set<string>(), bridgeDelayMs: 0, activeBridge: 0, maximumBridge: 0 };
  const calls: string[] = [];
  const namesInputs: string[][] = [];
  const ownerReaderFlags: boolean[] = [];
  let paused: { operation: string; remaining: number; started: () => void; release: Promise<void> } | null = null;
  const authority = createIdentityAuthority({ directory: mainDirectory, siteOrigin: main, communityOrigin: community, ownerId: authorId, secret, stateEncryptionKey: 'separate-test-encryption-key-at-least-32-chars',
    readerIdentity: async req => { if (state.unavailable) throw Error('private source failure'); const account = req.headers.cookie === 'sansphase_reader_session=main.token' ? state.subject === readerId ? reader : observerAccount : req.headers.cookie === 'sansphase_reader_session=main.observer' ? observerAccount : null; return state.enabled && account ? { ...account, vip: state.vip } : null; },
    ownerIdentity: async req => withOwner && req.headers.cookie === 'sansphase_author_session=main.owner' ? { name: '测试作者' } : null,
    ownerReaderIdentity: async () => withOwner ? { ...(state.ownerPersonal === readerId ? reader : observerAccount), vip: state.vip } : null,
    people: async authors => new Map(authors.flatMap(author => { const account = author.kind === 'owner' && author.id === authorId ? { ...reader, id: authorId, uid: 'author', nickname: '测试作者' } : [reader, observerAccount].find(item => item.id === author.id); return account ? [[`${author.kind}:${author.id}`, { name: account.nickname, uid: account.uid, avatar: avatarId, bio: account.signature, vip: state.vip, vipUntil: state.vipUntil, active: state.enabled, joinedAt: '2026-01-01T00:00:00Z',
      ...(state.inactiveReaders.has(account.id) ? { active: false } : {}),
      ...(withOwner && account.id === state.ownerPersonal ? { ownerReader: true as const } : {}) }] as const] : []; })),
    findMember: async uid => { const account = [reader, observerAccount].find(item => item.uid === uid); return account ? { kind: 'reader', id: account.id } : null; },
    findByNames: async names => new Map([reader, observerAccount].filter(account => names.includes(account.nickname)).map(account => [account.nickname, { kind: 'reader' as const, id: account.id }])),
    avatar: async () => Buffer.from('approved-avatar'),
    invitations: {
      attribution: async id => id === observer.id && state.enabled ? { inviter: { kind: 'reader', id: readerId }, registeredAt: '2026-10-10T00:00:00.000Z' } : null,
      self: async id => ({ readerId: id, code: invitationCode, invitees: id === readerId ? [{ readerId: observer.id, registeredAt: '2026-10-10T00:00:00.000Z' }] : [] }),
    },
    frameEligibility: async id => {
      if (state.unavailable) throw Error('private source failure');
      return { active: state.enabled && [readerId, observer.id].includes(id) && !state.inactiveReaders.has(id), vip: state.vip, vipUntil: state.vipUntil };
    },
  });
  const mainServer = createServer((req, res) => { void (req.url === '/api/community-entry' ? authority.handleEntry(req, res) : authority.handleBridge(req, res)); });
  await new Promise<void>(done => mainServer.listen(0, '127.0.0.1', done));
  const localMain = `http://127.0.0.1:${(mainServer.address() as { port: number }).port}`;
  const client = createIdentityClient({ origin: main, secret, fetch: async (input, options) => {
    state.activeBridge++; state.maximumBridge = Math.max(state.maximumBridge, state.activeBridge);
    try {
    if (state.bridgeDelayMs) await new Promise(done => setTimeout(done, state.bridgeDelayMs));
    const url = new URL(String(input));
    assert.equal(url.origin, main);
    const envelope = JSON.parse(String(options?.body || '{}')) as { operation?: string; input?: { names?: string[] } };
    const operation = String(envelope.operation);
    if (operation === 'names' && envelope.input?.names) namesInputs.push([...envelope.input.names]);
    const response = await fetch(localMain + url.pathname, options);
    calls.push(operation);
    if(operation==='people'&&response.ok) {
      const profiles: Array<[string,{ownerReader:boolean}]> = await response.clone().json();
      for(const [,info] of profiles) { assert.equal(typeof info.ownerReader,'boolean'); ownerReaderFlags.push(info.ownerReader); }
    }
    if (paused?.operation === operation && --paused.remaining === 0) { const gate = paused; paused = null; gate.started(); await gate.release; }
    return response;
    } finally { state.activeBridge--; }
  } });
  const config = { directory, siteOrigin: community, mainSiteOrigin: main, bridgeSecret: secret, authorId, ...(withTeahouse ? { teahouse: { enabled: true as const, directory: teaDirectory } } : {}) };
  const runtime = createCommunityHostRuntime(config, client);
  const server = createPreviewServer({ ...runtime, root });
  const tea = await runtime.attachTeahouse(server);
  // Model the production reverse proxy's fixed upstream Host; Node fetch does
  // not preserve a caller-supplied Host when connecting to an ephemeral port.
  if (withTeahouse) server.prependListener('request', req => { req.headers.host = 'community.sansphase.com'; });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const local = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => { await runtime.closeTeahouse(); if (server.listening) await new Promise<void>(done => server.close(() => done())); await new Promise<void>(done => mainServer.close(() => done())); authority.close(); await runtime.close(); await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const entry = async (expectedStatus = 200, mainToken = 'main.token') => {
    const issued = await fetch(localMain + '/api/community-entry', { method: 'POST', headers: { Origin: main, 'X-Reader-Request': '1', Cookie: `${mainToken === 'main.owner' ? 'sansphase_author_session' : 'sansphase_reader_session'}=${mainToken}` } });
    assert.equal(issued.status, 200);
    const issuedBody = await issued.json();
    const bindingCookie = issued.headers.getSetCookie()[0];
    assert.ok(bindingCookie.includes('Domain=sansphase.com; Path=/api/community-entry'));
    const ticket = new URL(issuedBody.url).hash.slice('#community-entry='.length);
    const response = await fetch(local + '/api/community-entry', { method: 'POST', headers: { Origin: community, 'X-Reader-Request': '1', Cookie: bindingCookie.split(';')[0], 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) });
    assert.equal(response.status, expectedStatus);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('sansphase_community_session='))?.split(';')[0] || '';
    return { cookie, ticket, bindingCookie, response };
  };
  const pause = (operation: string, occurrence = 1) => {
    let started!: () => void, release!: () => void;
    const waiting = new Promise<void>(done => { started = done; });
    const held = new Promise<void>(done => { release = done; });
    paused = { operation, remaining: occurrence, started, release: held };
    return { waiting, release };
  };
  const purge = async (targetReaderId = readerId) => {
    const path = '/api/community-identity/purge', body = JSON.stringify({ operation: 'purge', input: { readerId: targetReaderId } });
    const response = await fetch(local + path, { method: 'POST', headers: signIdentityRequest({ secret, method: 'POST', path, body }), body });
    assert.equal(response.status, 200); return response;
  };
  return { base, root, directory, teaDirectory, config, tea, runtime, local, state, entry, pause, purge, calls, namesInputs, ownerReaderFlags };
}

const mentionNickname = 'abcdefgh';
async function publishingFixture(t: test.TestContext, nickname = mentionNickname) {
  const f = await fixture(t, false, false, { observerNickname: nickname });
  seedIconConsent(f.directory);
  // Publishing tests use an ordinary reader whose established trust avoids the
  // unrelated newcomer review gate. The account still uses the real bridge.
  const db = new DatabaseSync(resolve(f.directory, 'content.db'));
  try { db.prepare("UPDATE community_members SET level=1, level_day=? WHERE member_kind='reader' AND member_id=?").run(beijingDay(Date.now()), readerId); }
  finally { db.close(); }
  const { cookie } = await f.entry();
  const get = (path: string) => fetch(f.local + '/api/community/' + path, { headers: { cookie } });
  const post = (path: string, body: object) => fetch(f.local + '/api/community/' + path, { method: 'POST',
    headers: { cookie, Origin: community, 'X-Reader-Request': '1', 'Content-Type': 'application/json', 'X-Idempotency-Key': randomUUID() }, body: JSON.stringify(body) });
  const uploadedTopic = async (text: string) => {
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#446688' } }).png().toBuffer();
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'synthetic.png');
    const upload = await fetch(f.local + '/api/community/images', { method: 'POST', headers: { cookie, Origin: community, 'X-Reader-Request': '1' }, body: form });
    const imageText = await upload.text(); assert.equal(upload.status, 201, imageText);
    const image = JSON.parse(imageText) as { id: string };
    const body = text + '\n\n' + bodyImageMarker(image.id);
    return { board: 'qa', title: '合成普通读者发帖回归', body, images: [image.id], tags: [] };
  };
  const publish = async (text: string) => {
    const input = await uploadedTopic(text);
    const response = await post('topics', input);
    const resultText = await response.text(); assert.equal(response.status, 201, resultText);
    const topic = JSON.parse(resultText) as { id: string; pending: boolean };
    assert.equal(topic.pending, false);
    return { ...topic, body: input.body, imageId: input.images[0] };
  };
  const mentionNotices = () => {
    const store = createCommunityStore(f.directory);
    try { return store.members.inbox({ kind: 'reader', id: observer.id }).filter(notice => notice.type === 'mention'); }
    finally { store.close(); }
  };
  return { ...f, get, post, uploadedTopic, publish, mentionNotices };
}

test('hosted publishing mention boundaries: an ordinary reader uploads and publishes without mentions', async t => {
  const f = await publishingFixture(t), topic = await f.publish('这是没有任何提及的普通读者正文。');
  const response = await f.get('topics/' + topic.id), raw = await response.text();
  assert.equal(response.status, 200, raw);
  const thread = JSON.parse(raw);
  assert.equal(thread.topic.body, topic.body);
  assert.deepEqual(thread.topic.images.map((image: { id: string }) => image.id), [topic.imageId]);
  assert.deepEqual(thread.mentions, {});
  assert.deepEqual(f.namesInputs, []);
  assert.equal(f.mentionNotices().length, 0);
});

test('hosted publishing mention boundaries: a complete eight-character nickname still notifies its member', async t => {
  const f = await publishingFixture(t), topic = await f.publish(`这是一条正式提及 @${mentionNickname} 的合成正文。`);
  const response = await f.get('topics/' + topic.id), raw = await response.text();
  assert.equal(response.status, 200, raw);
  assert.deepEqual(JSON.parse(raw).mentions, { [mentionNickname]: observer.uid });
  assert.equal(f.mentionNotices().length, 1);
  assert.ok(f.namesInputs.length >= 2);
  assert.ok(f.namesInputs.every(names => names.length === 1 && names[0] === mentionNickname));
});

test('hosted publishing mention boundaries: eight supplementary Han characters use code-point length', async t => {
  const nickname = '𠀀'.repeat(8);
  assert.equal(nickname.length, 16);
  assert.equal([...nickname].length, 8);
  const f = await publishingFixture(t, nickname), topic = await f.publish(`请教 @${nickname}，这是扩展汉字昵称的合成正文。`);
  const response = await f.get('topics/' + topic.id), raw = await response.text();
  assert.equal(response.status, 200, raw);
  assert.deepEqual(JSON.parse(raw).mentions, { [nickname]: observer.uid });
  assert.equal(f.mentionNotices().length, 1);
  assert.ok(f.namesInputs.length >= 2);
  assert.ok(f.namesInputs.every(names => names.length === 1 && names[0] === nickname));
});

const nonMentionTokens = [
  ['nine-character token', '@' + mentionNickname + 'i'],
  ['thirty-character token', '@' + mentionNickname + 'i'.repeat(22)],
  ['over-thirty-character token', '@' + mentionNickname + 'i'.repeat(23)],
  ['email with a long domain', 'person@' + mentionNickname + 'ijk.example'],
  ['long npm scope', '@' + mentionNickname + 'ijk/package'],
] as const;

for (const [label, token] of nonMentionTokens) test(`hosted publishing mention boundaries: ${label} stays literal without a truncated notification`, async t => {
  const f = await publishingFixture(t), topic = await f.publish(`下面是应当保持原样的正文内容 ${token}，它没有提及任何成员。`);
  const response = await f.get('topics/' + topic.id), raw = await response.text();
  assert.equal(response.status, 200, raw);
  const thread = JSON.parse(raw);
  assert.equal(thread.topic.body, topic.body);
  assert.deepEqual(thread.mentions, {});
  assert.ok(f.namesInputs.every(names => names.length === 0), 'literal tokens never supply an invalid or truncated account name');
  assert.equal(f.mentionNotices().length, 0, 'a prefix of a longer token must not become a member mention');
});

test('hosted publishing mention boundaries: a valid nickname survives alongside long tokens, email and npm scope', async t => {
  const f = await publishingFixture(t);
  const text = `请教 @${mentionNickname}，其他内容只是原文：${nonMentionTokens.map(([, token]) => token).join(' ')}。`;
  const topic = await f.publish(text);
  const response = await f.get('topics/' + topic.id), raw = await response.text();
  assert.equal(response.status, 200, raw);
  assert.equal(JSON.parse(raw).topic.body, topic.body);
  assert.deepEqual(JSON.parse(raw).mentions, { [mentionNickname]: observer.uid });
  assert.equal(f.mentionNotices().length, 1);
  assert.ok(f.namesInputs.every(names => names.length === 1 && names[0] === mentionNickname));
});

test('hosted publishing mention boundaries: replies preserve long tokens while notifying one complete nickname', async t => {
  const f = await publishingFixture(t), topic = await f.publish('这是用来接收合成回复的普通正文。');
  const body = `回复中请教 @${mentionNickname}，同时保留 ${nonMentionTokens.map(([, token]) => token).join(' ')}。`;
  const response = await f.post(`topics/${topic.id}/replies`, { body }), raw = await response.text();
  assert.equal(response.status, 201, raw);
  const reply = JSON.parse(raw) as { id: string };
  const reading = await f.get('topics/' + topic.id), threadText = await reading.text();
  assert.equal(reading.status, 200, threadText);
  const thread = JSON.parse(threadText);
  assert.equal(thread.replies.find((item: { id: string }) => item.id === reply.id)?.body, body);
  assert.deepEqual(thread.mentions, { [mentionNickname]: observer.uid });
  assert.equal(f.mentionNotices().length, 1);
  assert.ok(f.namesInputs.every(names => names.length === 1 && names[0] === mentionNickname));
});

test('hosted publishing mention boundaries: legacy topics and replies with literal tokens remain readable', async t => {
  const f = await publishingFixture(t), seed = createCommunityStore(f.directory);
  const body = `历史内容应继续可读：${nonMentionTokens.map(([, token]) => token).join(' ')}。`;
  let topicId: string, replyId: string;
  try {
    const author = { kind: 'reader' as const, id: readerId };
    topicId = seed.createTopic({ board: 'qa', author, title: '历史正文读取回归', body }).id;
    replyId = seed.addReply({ topicId, author, body: '历史回复 ' + body }).id;
  } finally { seed.close(); }
  const response = await f.get('topics/' + topicId), raw = await response.text();
  assert.equal(response.status, 200, raw);
  const thread = JSON.parse(raw);
  assert.equal(thread.topic.body, body);
  assert.equal(thread.replies.find((reply: { id: string }) => reply.id === replyId)?.body, '历史回复 ' + body);
  assert.deepEqual(thread.mentions, {});
  assert.ok(f.namesInputs.every(names => names.length === 0));
  assert.equal(f.mentionNotices().length, 0);
});

test('hosted publishing mention boundaries: long-only tokens cannot bypass revocation during referral lookup', async t => {
  const f = await publishingFixture(t);
  const input = await f.uploadedTopic('这里只有长字符串 @abcdefghi，不能使提交绕过之后的身份复核。');
  const snapshot = () => {
    const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
    try { return Object.fromEntries(['community_topics', 'community_notifications', 'community_ledger', 'community_experience_ledger', 'community_requests']
      .map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count])); }
    finally { db.close(); }
  };
  const before = snapshot(), gate = f.pause('referral-attribution');
  const posting = f.post('topics', input);
  const reached = await Promise.race([gate.waiting.then(() => true), posting.then(() => false)]);
  try {
    assert.equal(reached, true, 'the write must await its real attribution response');
    f.state.enabled = false;
  } finally { gate.release(); }
  const response = await posting, raw = await response.text();
  assert.equal(response.status, 401, raw);
  assert.deepEqual(f.namesInputs, [], 'filtering long tokens skips only name lookup, not final identity validation');
  assert.deepEqual(snapshot(), before, 'a revoked write must not leave a topic, notification, reward or retry receipt');
});

test('hosted publishing mention boundaries: a delayed names response cannot revive a purged mention target', async t => {
  const f = await publishingFixture(t), seed = createCommunityStore(f.directory);
  let topicId: string;
  try {
    const author = { kind: 'reader' as const, id: readerId }, target = { kind: 'reader' as const, id: observer.id };
    topicId = seed.createTopic({ board: 'qa', author, title: '旧帖提及删除竞态回归', body: `历史正文里提及 @${mentionNickname}，删除后不应复活。` }).id;
    seed.members.notify(target, { type: 'mention', actor: author, topicId, text: '合成历史提及通知' });
  } finally { seed.close(); }
  const targetRows = () => {
    const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
    try { return Object.fromEntries(['community_members', 'community_notifications'].map(table =>
      [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_kind='reader' AND member_id=?`).get(observer.id)?.count])); }
    finally { db.close(); }
  };
  assert.deepEqual(targetRows(), { community_members: 1, community_notifications: 1 });
  const gate = f.pause('names'), reading = f.get('topics/' + topicId);
  const reached = await Promise.race([gate.waiting.then(() => true), reading.then(() => false)]);
  try {
    assert.equal(reached, true, 'hold a real successful account-name response containing the target');
    await f.purge(observer.id);
    assert.deepEqual(targetRows(), { community_members: 0, community_notifications: 0 });
  } finally { gate.release(); }
  const response = await reading, raw = await response.text();
  assert.equal(response.status, 200, raw);
  assert.deepEqual(JSON.parse(raw).mentions, {});
  assert.deepEqual(f.namesInputs, [[mentionNickname]]);
  assert.deepEqual(targetRows(), { community_members: 0, community_notifications: 0 }, 'an old response cannot recreate purged member data');
});

test('invitation self projection is requested only for its tab and uses the main share origin', async t => {
  const f = await fixture(t); seedIconConsent(f.directory);
  const { cookie } = await f.entry(); f.calls.length = 0;
  const ledger = await fetch(f.local + '/api/community/stardust', { headers: { cookie } });
  assert.equal(ledger.status, 200);
  assert.equal(f.calls.includes('referral-self'), false);
  const response = await fetch(f.local + '/api/community/stardust?tab=invites', { headers: { cookie } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.referrals?.shareUrl, main + '/share/invite/' + invitationCode);
  assert.equal(result.referrals?.records.length, 1);
  assert.equal(result.referrals?.records[0].status, 'waiting');
  assert.ok(f.calls.includes('referral-self'));
});

test('a purged inviter cannot be recreated by an in-flight invitation projection', async t => {
  const f = await fixture(t); seedIconConsent(f.directory);
  const { cookie } = await f.entry(), gate = f.pause('referral-self');
  const pending = fetch(f.local + '/api/community/stardust?tab=invites', { headers: { cookie } });
  const paused = await Promise.race([gate.waiting.then(() => true), pending.then(() => false)]);
  try { assert.equal(paused, true); await f.purge(); } finally { gate.release(); }
  assert.equal((await pending).status, 401);
  const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
  try { assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM community_members WHERE member_id=?').get(readerId)?.n), 0); }
  finally { db.close(); }
});

test('main frame projection uses a finite signed HK to main qualification lookup without a community session', async t => {
  const f = await fixture(t);
  const client = createCommunityFrameClient({ origin: community, secret, fetch: (input, init) => fetch(f.local + new URL(String(input)).pathname, init) });
  const before = f.calls.length;
  const initial = await client.state(readerId);
  assert.deepEqual(f.calls.slice(before), ['frame-eligibility'], 'display must not recurse through session or people');
  assert.equal(initial.items.some(item => item.ref === 'vipmoon'), true);
  const row = (sql: string, id?: string) => {
    const db = new DatabaseSync(resolve(f.directory, 'content.db'), { readOnly: true });
    try { return id ? db.prepare(sql).get(id) : db.prepare(sql).get(); } finally { db.close(); }
  };
  assert.equal(Number(row('SELECT COUNT(*) AS n FROM community_members')?.n), 0);
  assert.equal(Number(row('SELECT COUNT(*) AS n FROM community_owned')?.n), 0);
  seedIconConsent(f.directory);
  assert.equal((await client.equip(readerId, 'vipmoon')).frame, 'vipmoon');
  assert.equal(f.calls.at(-1), 'frame-eligibility');
  f.state.vipUntil = new Date(Date.now() - 1).toISOString();
  const fresh = createCommunityFrameClient({ origin: community, secret, fetch: (input, init) => fetch(f.local + new URL(String(input)).pathname, init) });
  assert.equal((await fresh.state(readerId)).frame, null);
  assert.equal(row("SELECT frame FROM community_members WHERE member_kind='reader' AND member_id=?", readerId)?.frame, 'vipmoon');
  f.state.vipUntil = new Date(Date.now() + 60_000).toISOString();
  const renewed = createCommunityFrameClient({ origin: community, secret, fetch: (input, init) => fetch(f.local + new URL(String(input)).pathname, init) });
  assert.equal((await renewed.state(readerId)).frame, 'vipmoon');
  f.state.inactiveReaders.add(readerId);
  await assert.rejects(renewed.equip(readerId, 'vipmoon'), { status: 403 });
  assert.equal(Number(row('SELECT COUNT(*) AS n FROM community_owned')?.n), 0);
});

function seedIconConsent(directory: string) {
  const seed = createCommunityStore(directory);
  try { acceptCommunityConvention(seed, [{ kind: 'reader', id: readerId }, { kind: 'reader', id: observer.id }]); }
  finally { seed.close(); }
}
function storedIcon(directory: string, id = readerId) {
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try { return db.prepare("SELECT name_icon FROM community_members WHERE member_kind='reader' AND member_id=?").get(id)?.name_icon ?? null; }
  finally { db.close(); }
}
function seedAwaitTopic(directory: string, staff = false) {
  const seed = createCommunityStore(directory);
  const me = { kind: 'reader' as const, id: readerId }, superior = { kind: 'reader' as const, id: observer.id };
  try {
    seed.staff.bindOwner(authorId);
    acceptCommunityConvention(seed, [me, superior]);
    seed.members.visit(me); seed.members.visit(superior);
    if (staff) {
      seed.staff.appoint({ kind: 'owner', id: authorId }, superior, { role: 'general', boards: ['vip'], permissions: ['content.inspect', 'staff.appoint'], delegable: ['content.inspect'] });
      seed.staff.appoint(superior, me, { role: 'moderator', boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
    }
    return seed.createTopic({ board: 'vip', author: me, title: 'PRIVATE FINAL AUTHORITY CONTENT', body: 'synthetic private body for the final authority race' }).id;
  } finally { seed.close(); }
}

for (const change of ['disabled self', 'changed principal', 'changed personal binding', 'inactive superior', 'revoked appointment'] as const) {
  test(`hosted private reads recheck ${change} after their added final identity wait`, async t => {
    const ownerPersonal = change === 'changed personal binding';
    const staff = change === 'inactive superior' || change === 'revoked appointment';
    const env = await fixture(t, ownerPersonal); seedAwaitTopic(env.directory, staff);
    if (staff) env.state.vip = false;
    const { cookie } = await env.entry(200, ownerPersonal ? 'main.owner' : 'main.token'); env.calls.length = 0;
    const gate = env.pause('session', 2);
    const reading = fetch(env.local + '/api/community/topics?board=vip&sort=curated', { headers: { cookie: cookie + (ownerPersonal ? '; community_browse=reader' : '') } });
    const reached = await Promise.race([gate.waiting.then(() => true), reading.then(() => false)]);
    assert.equal(reached, true, 'the final source identity must be checked after the profile wait');
    try {
      if (change === 'disabled self') env.state.enabled = false;
      if (change === 'changed principal') env.state.subject = observer.id;
      if (change === 'changed personal binding') env.state.ownerPersonal = observer.id;
      if (change === 'inactive superior') env.state.inactiveReaders.add(observer.id);
      if (change === 'revoked appointment') {
        const seed = createCommunityStore(env.directory);
        try { seed.staff.bindOwner(authorId); seed.staff.revoke({ kind: 'owner', id: authorId }, { kind: 'reader', id: readerId }); }
        finally { seed.close(); }
      }
    } finally { gate.release(); }
    const response = await reading, body = await response.text();
    assert.equal(response.status, staff ? 404 : 401, body);
    assert.equal(body.includes('PRIVATE FINAL AUTHORITY CONTENT'), false);
  });
}
const equipIcon = (local: string, cookie: string, ref = 'vip:1') => fetch(local + '/api/community/shop/equip', {
  method: 'POST', headers: { cookie, Origin: community, 'X-Reader-Request': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ kind: 'icon', ref }),
});

test('hosted people projection explicitly distinguishes linked owner readers from ordinary readers', async t => {
  const env=await fixture(t,true), {cookie}=await env.entry();
  assert.equal((await fetch(env.local+'/api/community/me',{headers:{cookie}})).status,200);
  assert.ok(env.ownerReaderFlags.includes(true));
  env.ownerReaderFlags.length=0; env.state.ownerPersonal=observer.id;
  assert.equal((await fetch(env.local+'/api/community/me',{headers:{cookie}})).status,200);
  assert.ok(env.ownerReaderFlags.length>0);
  assert.equal(env.ownerReaderFlags.every(flag=>flag===false),true);
});

test('hosted icon final confirmation rejects VIP expiry after the initial session read', async t => {
  const env = await fixture(t); seedIconConsent(env.directory);
  const { cookie } = await env.entry(); env.calls.length = 0;
  const gate = env.pause('session');
  const writing = equipIcon(env.local, cookie);
  await gate.waiting; env.state.vip = false; gate.release();
  const response = await writing;
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(storedIcon(env.directory), null);
  assert.equal(env.calls.filter(operation => operation === 'session').length, 3, 'initial session, body confirmation and final icon confirmation');
});

test('hosted icon final confirmation accepts renewed VIP after the initial session read', async t => {
  const env = await fixture(t); seedIconConsent(env.directory); env.state.vip = false;
  const { cookie } = await env.entry(); env.calls.length = 0;
  const gate = env.pause('session');
  const writing = equipIcon(env.local, cookie);
  await gate.waiting; env.state.vip = true; gate.release();
  const response = await writing;
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).icon, 'vip:1');
  assert.equal(storedIcon(env.directory), 'vip:1');
  assert.equal(env.calls.filter(operation => operation === 'session').length, 3);
});

for (const change of ['revoked', 'different principal'] as const) test(`hosted icon final confirmation refuses a ${change} source after profile lookup`, async t => {
  const env = await fixture(t); seedIconConsent(env.directory);
  const { cookie } = await env.entry(); env.calls.length = 0;
  const gate = env.pause('people', 2);
  const writing = equipIcon(env.local, cookie);
  await gate.waiting;
  if (change === 'revoked') env.state.enabled = false;
  else env.state.subject = observer.id;
  gate.release();
  const response = await writing;
  assert.equal(response.status, 401, await response.clone().text());
  assert.equal(storedIcon(env.directory), null);
  assert.equal(storedIcon(env.directory, observer.id), null, 'a changed source cannot write to either account');
  assert.equal(env.calls.filter(operation => operation === 'session').length, 3);
});

test('hosted icon final confirmation remains guarded by local logout during remote profile lookup', async t => {
  const env = await fixture(t); seedIconConsent(env.directory);
  const { cookie } = await env.entry();
  const gate = env.pause('people');
  const writing = equipIcon(env.local, cookie);
  await gate.waiting;
  const logout = await fetch(env.local + '/api/reader/logout', { method: 'POST', headers: { cookie, Origin: community, 'X-Reader-Request': '1' } });
  assert.equal(logout.status, 200); gate.release();
  assert.equal((await writing).status, 401);
  assert.equal(storedIcon(env.directory), null);
});

test('hosted icon final confirmation cannot commit a delayed authority response after local logout', async t => {
  const env = await fixture(t); seedIconConsent(env.directory);
  const { cookie } = await env.entry(); env.calls.length = 0;
  const gate = env.pause('session', 3);
  const writing = equipIcon(env.local, cookie);
  // Racing against completion gives a missing final read a deterministic
  // failure instead of leaving the test waiting for a request that never runs.
  const reachedFinalRead = await Promise.race([gate.waiting.then(() => true), writing.then(() => false)]);
  if (!reachedFinalRead) {
    assert.equal((await writing).status, 401, 'the protected write finished before its final authority read');
    assert.equal(storedIcon(env.directory), null);
    return;
  }
  try {
    const logout = await fetch(env.local + '/api/reader/logout', { method: 'POST', headers: { cookie, Origin: community, 'X-Reader-Request': '1' } });
    assert.equal(logout.status, 200);
  } finally { gate.release(); }
  assert.equal((await writing).status, 401);
  assert.equal(storedIcon(env.directory), null);
  assert.equal(env.calls.filter(operation => operation === 'session').length, 3);
});

test('hosted icon final confirmation rejects a changed author personal binding after profile lookup', async t => {
  const env = await fixture(t, true); seedIconConsent(env.directory);
  const { cookie } = await env.entry(200, 'main.owner'); env.calls.length = 0;
  const gate = env.pause('people', 2);
  const writing = equipIcon(env.local, cookie + '; community_browse=reader', 'vip:8');
  await gate.waiting; env.state.ownerPersonal = observer.id; gate.release();
  const response = await writing;
  assert.equal(response.status, 401, await response.clone().text());
  assert.equal(storedIcon(env.directory), null);
  assert.equal(storedIcon(env.directory, observer.id), null);
  assert.equal(env.calls.filter(operation => operation === 'session').length, 3);
});

test('hosted identity reads use one bounded final confirmation after profile resolution', async t => {
  const env = await fixture(t), { cookie } = await env.entry(); env.calls.length = 0;
  const response = await fetch(env.local + '/api/community/me', { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).icon, 'vip:1');
  assert.deepEqual(env.calls, ['session','people','session','people']);
});

test('hosted final authority work is bounded by phases rather than 100 topics or 250 replies',async t=>{
  const measure = async(topicCount:number,replyCount:number) => {
    const env=await fixture(t);
    const seed=createCommunityStore(env.directory),member={kind:'reader' as const,id:readerId};
    let first='';
    try {
      seed.staff.bindOwner(authorId);acceptCommunityConvention(seed,[member]);
      first=seed.createTopic({board:'qa',author:member,title:'固定身份来源成本第一条',body:'无提及的完整合成内容'}).id;
      for(let i=1;i<topicCount;i++)seed.createTopic({board:'qa',author:member,title:`固定身份来源成本主题${i}`,body:'同一真实来源账号的合成内容'});
      for(let i=0;i<replyCount;i++)seed.addReply({topicId:first,author:member,body:`固定身份来源成本完整回复${i}`});
    } finally {seed.close();}
    // Finish synchronous fixture writes before opening pooled HTTP connections.
    // Otherwise parallel test load can outlast the loopback server's idle socket lifetime.
    const {cookie}=await env.entry();
    const callsFor = async(path:string) => {
      env.calls.length=0;
      const response=await fetch(env.local+'/api/community/'+path,{headers:{cookie}});
      assert.equal(response.status,200,await response.clone().text());
      await response.json();return [...env.calls];
    };
    return {listing:await callsFor('topics?sort=curated'),thread:await callsFor('topics/'+first)};
  };
  const small=await measure(1,0),large=await measure(100,250);
  assert.deepEqual(small.listing,['session','people','session','people']);
  assert.deepEqual(large.listing,small.listing);
  assert.deepEqual(small.thread,['session','people','session','people','session','people']);
  assert.deepEqual(large.thread,small.thread);
  t.diagnostic(JSON.stringify({topics:[1,100],listing:small.listing,replies:[0,250],thread:small.thread}));
});

for (const active of [false, true]) test(`hosted me keeps membership coherent when VIP becomes ${active ? 'active' : 'expired'} after the initial session read`, async t => {
  const env = await fixture(t); env.state.vip = !active;
  const { cookie } = await env.entry(); env.calls.length = 0;
  const gate = env.pause('session');
  const reading = fetch(env.local + '/api/community/me', { headers: { cookie } });
  await gate.waiting; env.state.vip = active; gate.release();
  const response = await reading;
  assert.equal(response.status, 200, await response.clone().text());
  const person = await response.json();
  assert.equal(person.vip, active, 'membership, level and icon use the same newer profile projection');
  assert.equal(person.vipGrowth.active, active);
  assert.equal(person.icon, active ? 'vip:1' : null);
  assert.equal(person.iconState.equipped, person.icon);
  assert.equal(person.iconState.available.includes('vip:1'), active);
  assert.deepEqual(env.calls, ['session','people','session','people'], 'one profile phase and one final source/self confirmation');
});

test('standalone host exchanges real protocol tickets, boots only community and returns account projection without credentials', async t => {
  const env = await fixture(t), { cookie, ticket, bindingCookie } = await env.entry();
  const html = await (await fetch(env.local + '/', { headers: { cookie } })).text();
  assert.ok(html.includes('data-community-only="true" data-community-boot="pending"'));
  const bootstrap = await (await fetch(env.local + '/api/content?view=bootstrap', { headers: { cookie } })).json();
  assert.equal(bootstrap.communityOnly, true); assert.equal(bootstrap.mainSiteOrigin, main); assert.equal(bootstrap.communityEnabled, true);
  assert.equal(bootstrap.reader.avatar, `/api/community/avatar/10001.webp?v=${avatarId}`);
  for (const privateValue of ['main.token', 'password', 'email', 'phone']) assert.ok(!JSON.stringify(bootstrap).includes(privateValue));
  assert.equal((await fetch(env.local + '/api/content?view=list&kind=notes', { headers: { cookie } })).status, 404);
  assert.equal((await fetch(env.local + '/api/reader/register', { method: 'POST', headers: { cookie } })).status, 404);
  const me = await (await fetch(env.local + '/api/community/me', { headers: { cookie } })).json();
  assert.equal(me.name, reader.nickname); assert.equal(me.vip, true);
  assert.equal(me.avatar, bootstrap.reader.avatar);
  assert.equal(await (await fetch(env.local + '/api/community/avatar/10001.webp', { headers: { cookie } })).text(), 'approved-avatar');
  const repeat = await fetch(env.local + '/api/community-entry', { method: 'POST', headers: { Origin: community, 'X-Reader-Request': '1', Cookie: bindingCookie.split(';')[0] }, body: JSON.stringify({ ticket }) });
  assert.equal(repeat.status, 401);
  env.state.vip = false;
  assert.equal((await (await fetch(env.local + '/api/community/me', { headers: { cookie } })).json()).vip, false);
  env.state.unavailable = true;
  assert.equal((await fetch(env.local + '/api/community/me', { headers: { cookie } })).status, 503);
  env.state.unavailable = false; env.state.enabled = false;
  assert.equal((await fetch(env.local + '/api/community/me', { headers: { cookie } })).status, 401);
});

test('standalone formal host publishes only author-listed products and refuses local preview sample sales', async t => {
  const env = await fixture(t);
  const store = createCommunityStore(env.directory), member = { kind: 'reader' as const, id: readerId };
  const product = { cat: 'digital' as const, name: '作者上架的正式资源', description: '已确认发布', price: 40, stock: null,
    limitPer: null, limitN: null, minLevel: 0, minDays: 0, delivery: '资源内容', note: '', active: true };
  let item: string;
  try {
    acceptCommunityConvention(store, [member]);
    store.ledger.credit(member, 1000, 'test', null, new Date().toISOString());
    item = store.economy.saveItem(null, product);
    store.economy.saveItem(null, { ...product, name: '未上架草稿', active: false });
  } finally { store.close(); }
  const { cookie } = await env.entry();
  const shop = await fetch(env.local + '/api/community/shop', { headers: { cookie } });
  assert.equal(shop.status, 200);
  assert.deepEqual((await shop.json()).items.map((entry: { id: string }) => entry.id), [item]);
  const redeem = await fetch(env.local + '/api/community/shop/redeem', { method: 'POST',
    headers: { cookie, Origin: community, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'frame-gold' }) });
  assert.equal(redeem.status, 409);
  assert.match((await redeem.json()).error, /下架/);
  const mine = await (await fetch(env.local + '/api/community/shop/mine', { headers: { cookie } })).json();
  assert.equal(mine.balance, 1000);
  assert.deepEqual(mine.orders, []);
  assert.deepEqual(mine.looks, []);
});

test('persistent image queue protects registered files and signed purge removes only designated reader data', async t => {
  const env = await fixture(t), { cookie } = await env.entry();
  const store = createCommunityStore(env.directory);
  const host = createCommunityHostStore(env.directory);
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const image = `community-image-${id}.webp`, thumb = `community-thumb-${id}.webp`;
  store.addImage({ id, uploader: { kind: 'reader', id: readerId }, width: 32, height: 32 });
  const topic = store.createTopic({ board: 'qa', author: { kind: 'reader', id: readerId }, title: '待删除的帖子', body: '正文内容正文内容', images: [id] });
  const fullPath=resolve(env.directory,'uploads',image);
  await sharp({create:{width:1600,height:900,channels:4,background:'#4477aacc'}}).webp().toFile(fullPath);
  const original=await readFile(fullPath),cached=await createImageVariants(env.directory)(fullPath,768,'image/webp',true);
  assert.ok(cached);
  await writeFile(resolve(env.directory, 'uploads', thumb), 'registered thumb');
  await writeFile(resolve(env.directory, 'uploads', 'unknown.keep'), 'preserve');
  host.queueFile(image, 'simulated-rollback');
  assert.equal((await env.runtime.drainFileQueue()).retained, 1);
  assert.deepEqual(await readFile(fullPath), original);
  await readFile(cached);
  store.close(); host.close();
  const path = '/api/community-identity/purge';
  const body = JSON.stringify({ operation: 'purge', input: { readerId } });
  const response = await fetch(env.local + path, { method: 'POST', headers: signIdentityRequest({ secret, method: 'POST', path, body }), body });
  assert.equal(response.status, 200);
  await assert.rejects(readFile(resolve(env.directory, 'uploads', image)), { code: 'ENOENT' });
  await assert.rejects(readFile(cached), {code:'ENOENT'});
  await assert.rejects(readFile(resolve(env.directory, 'uploads', thumb)), { code: 'ENOENT' });
  assert.equal(await readFile(resolve(env.directory, 'uploads', 'unknown.keep'), 'utf8'), 'preserve');
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT 1 FROM community_topics WHERE id=?').get(topic.id), undefined); } finally { db.close(); }
  assert.equal((await fetch(env.local + '/api/community/me', { headers: { cookie } })).status, 401);
});

test('community production start requires fixed origins, patched Node, private config and loopback', () => {
  const env = { NODE_ENV: 'production', SITE_ORIGIN: community, COMMUNITY_CONFIG_FILE: resolve(tmpdir(), 'private-community.json') };
  assert.equal(communityHostProductionOptions(env, '24.21.0').host, '127.0.0.1');
  for (const version of ['22.21.0', '24.20.0', '25.0.0']) assert.throws(() => communityHostProductionOptions(env, version), /Node/);
  assert.throws(() => communityHostProductionOptions({ ...env, HOST: '0.0.0.0' }, '24.21.0'), /loopback/);
  assert.throws(() => communityHostProductionOptions({ ...env, SITE_ORIGIN: 'http://community.sansphase.com' }, '24.21.0'), /HTTPS/);
});

test('a delayed verified session cannot recreate deleted community membership after purge', async t => {
  const env = await fixture(t), { cookie } = await env.entry();
  const gate = env.pause('session');
  const reading = fetch(env.local + '/api/community/convention', { headers: { cookie } });
  await gate.waiting;
  await env.purge();
  gate.release();
  assert.equal((await reading).status, 401);
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try { for (const table of ['community_members', 'community_visits']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_kind='reader' AND member_id=?`).get(readerId)?.count, 0); }
  finally { db.close(); }
});

test('a POST paused in remote profile lookup cannot recreate experience after reader purge', async t => {
  const env = await fixture(t), { cookie } = await env.entry();
  const seed = createCommunityStore(env.directory);
  acceptCommunityConvention(seed, [{ kind: 'reader', id: readerId }]); seed.close();
  const gate = env.pause('people');
  const posting = fetch(env.local + '/api/community/active/visit', { method: 'POST', headers: { cookie, Origin: community, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: '{}' });
  await gate.waiting;
  await env.purge();
  gate.release();
  assert.equal((await posting).status, 401);
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try { for (const table of ['community_members', 'community_visits', 'community_experience_ledger', 'community_vip_growth_days']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_kind='reader' AND member_id=?`).get(readerId)?.count, 0); }
  finally { db.close(); }
});

test('exchange response held across purge cannot create a new session for a deleted reader', async t => {
  const env = await fixture(t);
  const gate = env.pause('exchange');
  const entering = env.entry(401);
  await gate.waiting;
  await env.purge();
  gate.release();
  const result = await entering;
  assert.equal(result.cookie, '');
  const db = new DatabaseSync(resolve(env.directory, 'community-host.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM community_host_sessions').get()?.count, 0); }
  finally { db.close(); }
});

for (const operation of ['member', 'people']) test(`another reader's delayed ${operation} lookup cannot recreate a deleted profile`, async t => {
  const env = await fixture(t), { cookie } = await env.entry(200, 'main.observer');
  const gate = env.pause(operation);
  const reading = fetch(env.local + '/api/community/members/10001?tab=badges', { headers: { cookie } });
  await gate.waiting;
  await env.purge();
  gate.release();
  const response = await reading;
  const db = new DatabaseSync(resolve(env.directory, 'content.db'), { readOnly: true });
  try {
    for (const table of ['community_members', 'community_visits', 'community_badge_honors']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE member_kind='reader' AND member_id=?`).get(readerId)?.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM community_members WHERE member_kind='reader' AND member_id=?").get(observer.id)?.count, 1);
  } finally { db.close(); }
  assert.equal(response.status, 404);
});

type TeaReply<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
async function teaSocket(t: test.TestContext, local: string, cookie: string, waitForMembers = false) {
  const socket = socketClient(local, { path: '/api/teahouse/socket.io', transports: ['websocket'], reconnection: false,
    extraHeaders: { Cookie: cookie, Origin: community, Host: 'community.sansphase.com' } });
  t.after(() => { socket.disconnect(); });
  // Register before connect: under load both packets can arrive in one event-loop turn.
  const membersReady = waitForMembers ? new Promise<void>(done => socket.once('members:changed', () => done())) : Promise.resolve();
  await new Promise<void>((done, reject) => { socket.once('connect', done); socket.once('connect_error', reject); });
  await membersReady;
  return socket;
}
const teaEmit = <T>(socket: Socket, event: string, input: unknown) => socket.timeout(8000).emitWithAck(event, input) as Promise<TeaReply<T>>;
const teaHeaders = (cookie: string) => ({ cookie, Origin: community, Host: 'community.sansphase.com', 'X-Reader-Request': '1' });

test('production tea-room is opt-in, keeps static login boundaries, and refuses overlapping or unprepared private storage', { timeout: 20_000 }, async t => {
  const f = await fixture(t), { cookie } = await f.entry();
  assert.equal(f.tea, undefined);
  for (const path of ['/teahouse', '/teahouse.html', '/api/teahouse/session', '/api/teahouse/socket.io/?EIO=4&transport=polling'])
    assert.equal((await fetch(f.local + path, { headers: teaHeaders(cookie) })).status, 404);
  const initial = await (await fetch(f.local + '/api/content', { headers: { cookie } })).json();
  assert.equal(initial.teahouseEnabled, false);
  const configPath = resolve(f.base, 'community.json');
  const config = async (teahouse: unknown) => {
    await writeFile(configPath, JSON.stringify({ ...f.config, teahouse }), { mode: 0o600 });
    return readCommunityHostConfig(configPath, f.root);
  };
  assert.deepEqual((await config({ enabled: false })).teahouse, { enabled: false });
  for (const directory of [f.directory, resolve(f.directory, 'uploads'), f.base, f.root])
    await assert.rejects(config({ enabled: true, directory }), /independent/);
  await mkdir(f.teaDirectory);
  const parsed = await config({ enabled: true, directory: f.teaDirectory });
  assert.throws(() => createCommunityHostRuntime(parsed), /Explicit teahouse preparation/);
  await assert.rejects(readFile(resolve(f.teaDirectory, 'db/chat.sqlite')), { code: 'ENOENT' });
});

test('mounted tea-room uses live main-site VIP on sockets and private images, and a successful send alone renews idle', { timeout: 20_000 }, async t => {
  const f = await fixture(t, false, true), { cookie } = await f.entry();
  assert.match(await (await fetch(f.local + '/teahouse')).text(), /请从主站进入社区/);
  assert.match(await (await fetch(f.local + '/teahouse', { headers: { cookie } })).text(), /Real tea room/);
  const bootstrap = await (await fetch(f.local + '/api/content', { headers: { cookie } })).json();
  assert.equal(bootstrap.teahouseEnabled, true);
  const token = cookie.split('=')[1];
  const host = {
    session(value: string) { const storage = createCommunityHostStore(f.directory); try { return storage.session(value); } finally { storage.close(); } },
    touchSession(value: string, now: number) { const storage = createCommunityHostStore(f.directory); try { storage.touchSession(value, now); } finally { storage.close(); } },
  };
  // Make a measurable old idle timestamp without changing the signed main clock.
  host.touchSession(token, Date.now() - 60_000);
  const before = host.session(token)!.touchedAt;
  const socket = await teaSocket(t, f.local, cookie);
  const historyResponse = await fetch(f.local + '/api/teahouse/messages', { headers: teaHeaders(cookie) });
  assert.equal(historyResponse.status, 200);
  assert.equal(host.session(token)!.touchedAt, before, 'connection, roster checks and history never count as user activity');
  const image = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'red' } }).png().toBuffer();
  const form = new FormData(); form.append('file', new Blob([new Uint8Array(image)], { type: 'image/png' }), 'image.png');
  const uploaded = await fetch(f.local + '/api/teahouse/attachments', { method: 'POST', headers: teaHeaders(cookie), body: form });
  assert.equal(uploaded.status, 201); const attachment = await uploaded.json();
  const sent = await teaEmit<TeahouseMessage>(socket, 'message:send', { id: randomUUID(), text: 'real authority bridge message', attachmentIds: [attachment.id] });
  assert.equal(sent.ok, true);
  assert.ok(host.session(token)!.touchedAt > before);
  assert.equal((await fetch(f.local + attachment.url, { headers: teaHeaders(cookie) })).status, 200);
  f.state.vip = false;
  assert.equal((await fetch(f.local + attachment.url, { headers: teaHeaders(cookie) })).status, 403);
  assert.equal((await fetch(f.local + '/api/teahouse/messages', { headers: teaHeaders(cookie) })).status, 403);
  const disconnected = new Promise<void>(done => socket.once('disconnect', () => done()));
  socket.emit('message:send', { id: randomUUID(), text: 'expired vip' }, () => {});
  await disconnected;
  assert.ok(host.session(token), 'losing VIP must not log out the community session');
  f.state.vip = true; f.state.enabled = false;
  assert.equal((await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) })).status, 401);
  assert.equal(host.session(token), null);
});

test('mounted tea-room retains real appointment and owner personal-mode boundaries', { timeout: 20_000 }, async t => {
  const f = await fixture(t, true, true), { cookie } = await f.entry();
  const seed = createCommunityStore(f.directory);
  try {
    seed.staff.bindOwner(authorId); seed.members.visit({ kind: 'reader', id: readerId });
    seed.staff.appoint({ kind: 'owner', id: authorId }, { kind: 'reader', id: readerId }, { role: 'assistant', boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
    const assistant = await teaSocket(t, f.local, cookie);
    const denied = await teaEmit(assistant, 'announcement:save', { title: 'no authority', text: 'assistant must not publish' });
    assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.status, 403);
    f.state.vip = false;
    assert.equal((await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) })).status, 403);
    seed.staff.appoint({ kind: 'owner', id: authorId }, { kind: 'reader', id: readerId }, { role: 'moderator', boards: ['vip'], permissions: ['content.inspect'], delegable: [] });
    assert.equal((await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) })).status, 200);
    assert.equal((await fetch(f.local + '/api/community/browse-mode', { method: 'POST', headers: { ...teaHeaders(cookie), 'Content-Type': 'application/json' }, body: JSON.stringify({ reader: true }) })).status, 200);
    assert.equal((await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie + '; community_browse=reader') })).status, 403);
    const owner = await f.entry(200, 'main.owner');
    const ownerResponse = await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(owner.cookie) });
    assert.equal(ownerResponse.status, 200);
    assert.equal((await ownerResponse.json()).actor.role, 'owner');
    // Owner personal projection is the actual reader, without author privileges.
    assert.equal((await fetch(f.local + '/api/community/browse-mode', { method: 'POST', headers: { ...teaHeaders(owner.cookie), 'Content-Type': 'application/json' }, body: JSON.stringify({ reader: true }) })).status, 200);
    const personal = await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(owner.cookie + '; community_browse=reader') });
    assert.equal(personal.status, 403);
  } finally { seed.close(); }
});

test('signed reader purge clears mounted tea-room originals and disconnects the deleted socket', { timeout: 20_000 }, async t => {
  const f = await fixture(t, false, true), { cookie } = await f.entry();
  const socket = await teaSocket(t, f.local, cookie);
  const id = randomUUID(), sent = await teaEmit<TeahouseMessage>(socket, 'message:send', { id, text: 'private message to purge' });
  assert.equal(sent.ok, true);
  const gate = f.pause('people');
  const history = fetch(f.local + '/api/teahouse/messages', { headers: teaHeaders(cookie) });
  await gate.waiting;
  try { const receipt = await (await f.purge()).json(); assert.equal(receipt.result.teahouse.messages, 1); }
  finally { gate.release(); }
  assert.equal((await history).status, 401);
  const db = new DatabaseSync(resolve(f.teaDirectory, 'db/chat.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT text,author_json,withdrawn_at FROM teahouse_messages WHERE id=?').get(id)!;
    assert.equal(row.text, null); assert.ok(row.withdrawn_at); assert.match(String(row.author_json), /已注销用户/);
  } finally { db.close(); }
});

test('tea-room owner mode changes invalidate the old socket and in-flight identity without ending the login session', { timeout: 20_000 }, async t => {
  const f = await fixture(t, true, true), { cookie } = await f.entry(200, 'main.owner');
  // Connection schedules its own people lookups for the initial member list.
  // Drain that observed event before pausing the message's authority lookup;
  // otherwise the presence broadcast can consume the gate while the send proceeds.
  const socket = await teaSocket(t, f.local, cookie, true);
  const change = (reader: unknown, currentCookie: string) => fetch(f.local + '/api/community/browse-mode', {
    method: 'POST', headers: { ...teaHeaders(currentCookie), 'Content-Type': 'application/json' }, body: JSON.stringify({ reader }),
  });
  assert.equal((await change('invalid', cookie)).status, 400);
  assert.equal(socket.connected, true);
  const gate = f.pause('people'), staleId = randomUUID();
  socket.emit('message:send', { id: staleId, text: 'must not be sent as previous owner' }, () => {});
  await gate.waiting;
  const disconnected = new Promise<void>(done => socket.once('disconnect', () => done()));
  try {
    const pausedDb = new DatabaseSync(resolve(f.teaDirectory, 'db/chat.sqlite'), { readOnly: true });
    try { assert.equal(pausedDb.prepare('SELECT 1 FROM teahouse_messages WHERE id=?').get(staleId), undefined, 'the held send has not committed before its identity is switched'); }
    finally { pausedDb.close(); }
    assert.equal((await change(true, cookie)).status, 200); await disconnected;
  }
  finally { gate.release(); }
  // A websocket mode notice can win the race against the Set-Cookie response.
  // The old cookie must receive a retryable status without revoking the login.
  assert.equal((await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) })).status, 409);
  const personalCookie = cookie + '; community_browse=reader';
  const session = await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(personalCookie) });
  assert.equal(session.status, 200);
  const actor = (await session.json()).actor;
  assert.equal(actor.id, readerId); assert.equal(actor.kind, 'reader'); assert.equal(actor.role, null);
  const personal = await teaSocket(t, f.local, personalCookie);
  const personalDisconnected = new Promise<void>(done => personal.once('disconnect', () => done()));
  assert.equal((await change(false, personalCookie)).status, 200);
  await personalDisconnected;
  assert.equal((await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(personalCookie) })).status, 409);
  assert.equal((await (await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) })).json()).actor.role, 'owner');
  const owner = await teaSocket(t, f.local, cookie);
  const sent = await teaEmit<TeahouseMessage>(owner, 'message:send', { id: randomUUID(), text: 'restored author identity' });
  assert.equal(sent.ok, true); if (sent.ok) assert.equal(sent.data.author.kind, 'owner');
  const db = new DatabaseSync(resolve(f.teaDirectory, 'db/chat.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT 1 FROM teahouse_messages WHERE id=?').get(staleId), undefined); }
  finally { db.close(); }
});

test('tea-room re-enable reconciles durable deletions before opening to readers', { timeout: 20_000 }, async t => {
  const f = await fixture(t, false, true), { cookie } = await f.entry();
  const socket = await teaSocket(t, f.local, cookie), id = randomUUID();
  assert.equal((await teaEmit(socket, 'message:send', { id, text: 'deleted while tea room disabled' })).ok, true);
  await f.runtime.close();
  const host = createCommunityHostStore(f.directory);
  try { host.markReaderDeleted(readerId); } finally { host.close(); }
  const replacement = createCommunityHostRuntime(f.config);
  try {
    await replacement.attachTeahouse(createServer());
    const db = new DatabaseSync(resolve(f.teaDirectory, 'db/chat.sqlite'), { readOnly: true });
    try { const row = db.prepare('SELECT text,author_json,withdrawn_at FROM teahouse_messages WHERE id=?').get(id)!; assert.equal(row.text, null); assert.ok(row.withdrawn_at); assert.match(String(row.author_json), /已注销用户/); }
    finally { db.close(); }
  } finally { await replacement.close(); }
});

test('mounted tea-room bounds a delayed real identity bridge across simultaneous same-account tabs', { timeout: 20_000 }, async t => {
  const f = await fixture(t, false, true), { cookie } = await f.entry();
  f.state.bridgeDelayMs = 30; f.state.maximumBridge = 0; f.calls.length = 0;
  const started = performance.now();
  const responses = await Promise.all(Array.from({ length: 12 }, () => fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) })));
  const statuses = responses.map(response => response.status);
  assert.equal(statuses.filter(status => status === 200).length, 8);
  assert.equal(statuses.filter(status => status === 429).length, 4);
  assert.ok(f.state.maximumBridge <= 8);
  assert.ok(f.calls.filter(call => call === 'session').length >= 8, 'each allowed request must verify its own current session');
  t.diagnostic(JSON.stringify({ requests: 12, artificialBridgeDelayMs: 30, maximumBridge: f.state.maximumBridge, durationMs: Math.round(performance.now() - started) }));
  f.state.vip = false;
  assert.equal((await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) })).status, 403);
});

test('tea-room delayed HTTP identity replies treat a committed mode change as retryable without logging out', { timeout: 20_000 }, async t => {
  const f = await fixture(t, true, true), { cookie } = await f.entry(200, 'main.owner');
  const gate = f.pause('people');
  const pending = fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie) });
  await gate.waiting;
  try {
    const changed = await fetch(f.local + '/api/community/browse-mode', { method: 'POST', headers: { ...teaHeaders(cookie), 'Content-Type': 'application/json' }, body: JSON.stringify({ reader: true }) });
    assert.equal(changed.status, 200);
  } finally { gate.release(); }
  assert.equal((await pending).status, 409);
  const next = await fetch(f.local + '/api/teahouse/session', { headers: teaHeaders(cookie + '; community_browse=reader') });
  assert.equal(next.status, 200); assert.equal((await next.json()).actor.kind, 'reader');
});
