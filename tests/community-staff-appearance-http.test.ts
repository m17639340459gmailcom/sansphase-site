import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import type { CommunityPerson } from '../src/community.ts';
import { communityStaffCapabilities } from '../src/community-staff.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-staff-appearance-'));
  new DatabaseSync(resolve(directory, 'content.db')).close();
  await migrateCommunity(directory);
  let store = createCommunityStore(directory);
  const accounts = new Map<string, { uid: string; active?: boolean }>(['general', 'moderator', 'assistant', 'reader'].map((id, index) => [id, { uid: String(20001 + index), active: true }]));
  acceptCommunityConvention(store, [owner, ...[...accounts.keys()].map(reader)]);
  const capabilities = communityStaffCapabilities.map(item => item.id);
  const appoint = (parent: CommunityAuthor, id: string, role: 'general' | 'moderator' | 'assistant') => store.staff.appoint(parent, reader(id), {
    role, boards: ['qa'], permissions: [...capabilities], delegable: role === 'assistant' ? [] : [...capabilities],
  });
  appoint(owner, 'general', 'general');
  appoint(reader('general'), 'moderator', 'moderator');
  appoint(reader('moderator'), 'assistant', 'assistant');
  store.members.equip(reader('assistant'), 'frame', 'original-purchased-frame');
  const calls: CommunityAuthor[][] = [];
  let beforePeople: ((authors: CommunityAuthor[]) => void) | undefined;
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  const bind = () => {
    service = createCommunityService({ store, directory, siteOrigin: origin,
      identify: async req => {
        const id = String(req.headers.cookie || 'reader').split(';')[0];
        return id === 'owner' ? { ...owner, name: '作者', vip: true } : accounts.get(id)?.active ? { ...reader(id), name: id, vip: false } : null;
      },
      people: async authors => {
        calls.push(authors);
        beforePeople?.(authors);
        return new Map(authors.flatMap(author => {
          const account = accounts.get(author.id);
          const info = author.kind === 'owner' ? { name: '作者', uid: 'owner', active: true } : account ? { name: author.id, ...account } : null;
          return info ? [[`${author.kind}:${author.id}`, { ...info, avatar: null, vip: author.kind === 'owner', bio: '', joinedAt: null }]] : [];
        }));
      },
      findMember: async uid => uid === 'owner' ? owner : [...accounts].filter(([, account]) => account.uid === uid).map(([id]) => reader(id))[0] || null,
    });
  };
  bind();
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const get = async (path: string, identity = 'reader') => {
    const response = await fetch(`${origin}/api/community/${path}`, { headers: { Cookie: identity } });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const topic = (id: string) => store.createTopic({ author: reader(id), board: 'qa', title: '已有岗位外观回归', body: '这是一篇已发布的完整测试帖子内容' });
  return { get, topic, accounts, calls, appoint, store: () => store, restart() { store.close(); store = createCommunityStore(directory); bind(); },
    onPeople(hook: (authors: CommunityAuthor[]) => void) { beforePeople = hook; }, uid(id: string) { return accounts.get(id)!.uid; } };
}

test('existing persisted appointments expose all three roles after code restart without replacing purchased decorations', async t => {
  const f = await fixture(t);
  const topics = ['general', 'moderator', 'assistant'].map(id => f.topic(id));
  const reply = f.store().addReply({ topicId: topics[0].id, author: reader('assistant'), body: '现有协管回复内容' });
  for (const id of ['general', 'moderator', 'assistant']) f.store().members.notify(reader('reader'), { type: 'reply', actor: reader(id), topicId: topics[0].id, replyId: reply.id, text: '已有管理者回复' });
  const before = ['general', 'moderator', 'assistant'].map(id => f.store().staff.state(reader(id)));
  f.restart();
  assert.deepEqual(['general', 'moderator', 'assistant'].map(id => f.store().staff.state(reader(id))), before);
  const list = await f.get('topics');
  for (const id of ['general', 'moderator', 'assistant']) {
    assert.equal(list.items.find((item: { author: CommunityPerson }) => item.author.uid === f.uid(id)).author.staffRole, id);
    assert.equal((await f.get('me', id)).staffRole, id);
    assert.equal((await f.get(`members/${f.uid(id)}`)).person.staffRole, id);
  }
  const thread = await f.get(`topics/${topics[0].id}`);
  assert.equal(thread.topic.author.staffRole, 'general');
  assert.equal(thread.author.staffRole, 'general');
  assert.equal(thread.replies[0].author.staffRole, 'assistant');
  assert.equal(thread.replies[0].author.frame, 'original-purchased-frame');
  const inbox = await f.get('inbox');
  assert.deepEqual(new Set(inbox.items.map((item: { actor: CommunityPerson }) => item.actor.staffRole)), new Set(['general', 'moderator', 'assistant']));
  assert.equal(f.store().members.decorations(reader('assistant')).frame, 'original-purchased-frame');
});

test('disabled or unverified staff and disabled upstream accounts do not retain public staff appearance', async t => {
  const f = await fixture(t), topic = f.topic('assistant');
  for (const id of ['assistant', 'moderator', 'general']) for (const active of [false, undefined]) {
    f.accounts.get(id)!.active = active;
    assert.equal((await f.get('topics')).items[0].author.staffRole, null, `${id}: list`);
    assert.equal((await f.get(`topics/${topic.id}`)).author.staffRole, null, `${id}: sidebar`);
    assert.equal((await f.get(`members/${f.uid('assistant')}`)).person.staffRole, null, `${id}: profile`);
    if (id !== 'assistant') {
      const me = await f.get('me', 'assistant');
      assert.equal(me.staffRole, null);
      assert.equal(me.staff, null);
      assert.equal(me.mod, false);
    }
    f.accounts.get(id)!.active = true;
    assert.equal((await f.get('topics')).items[0].author.staffRole, 'assistant');
  }
  assert.equal(f.store().members.decorations(reader('assistant')).frame, 'original-purchased-frame');
});

test('revocation and parent demotion remove descendant role appearance while original frame survives', async t => {
  const f = await fixture(t); f.topic('assistant');
  f.appoint(owner, 'general', 'moderator');
  assert.equal(f.store().staff.state(reader('assistant')), null);
  assert.equal((await f.get('topics')).items[0].author.staffRole, null);
  assert.equal((await f.get('me', 'assistant')).staffRole, null);
  f.appoint(owner, 'assistant', 'assistant');
  assert.equal((await f.get('topics')).items[0].author.staffRole, 'assistant');
  f.store().staff.revoke(owner, reader('assistant'));
  const member = (await f.get(`members/${f.uid('assistant')}`)).person;
  assert.equal(member.staffRole, null);
  assert.equal(member.frame, 'original-purchased-frame');
});

test('public author account validation stays batched and revocation during profile lookup cannot display a stale role', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 4; index++) f.topic('assistant');
  f.calls.length = 0;
  const list = await f.get('topics');
  assert.equal(list.items.length, 4);
  assert.equal(f.calls.length, 1, 'one bulk people read for the public author list');
  assert.deepEqual(new Set(f.calls[0].map(member => `${member.kind}:${member.id}`)), new Set(['reader:assistant', 'reader:moderator', 'reader:general']));
  assert.equal(f.calls[0].length, 3, 'duplicate authors and shared ancestors are requested once');
  f.onPeople(() => { f.store().staff.revoke(owner, reader('general')); });
  assert.ok((await f.get('topics')).items.every((item: { author: CommunityPerson }) => item.author.staffRole === null));
});

test('reader perspective suppresses management authority without changing the appointed public identity', async t => {
  const f = await fixture(t);
  const me = await f.get('me', 'assistant; community_browse=reader');
  assert.equal(me.staff, null);
  assert.equal(me.mod, false);
  assert.equal(me.staffRole, 'assistant');
  assert.equal(me.management.browsingAsReader, true);
  assert.equal(me.frame, 'original-purchased-frame');
});
