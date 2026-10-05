import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
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

const moderator: CommunityAuthor = { kind: 'reader', id: 'moderator' };
const other: CommunityAuthor = { kind: 'reader', id: 'other' };
type Contact = { qq: string; email: string };
type ContactPerson = Contact & { uid: string; name: string; owner: boolean; boards: string[] };
const clean = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-contact-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => clean(template));

async function setup(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-contact-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [moderator, other, { kind: 'reader', id: 'reader' }, { kind: 'owner', id: 'owner' }]);
  store.members.setSteward(moderator, true, ['qa', 'tools']);
  store.members.setSteward(other, true, ['showcase']);
  const accounts = new Map([
    ['reader', { uid: '10001', name: '读者' }],
    ['moderator', { uid: '10002', name: '问答版主' }],
    ['other', { uid: '10003', name: '作品版主' }],
  ]);
  let bodyStarted: (() => void) | null = null;
  let afterPeople: (() => void) | null = null;
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => {
    if (req.headers['x-test-slow-body']) req.on('newListener', event => { if (event === 'readable') bodyStarted?.(); });
    void service.handle(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  service = createCommunityService({
    store, siteOrigin: origin, directory,
    identify: async req => {
      const id = String(req.headers.cookie || '').split(';')[0];
      if (id === 'owner') return { kind: 'owner', id: 'owner', name: '無相', vip: true };
      const info = accounts.get(id);
      return info ? { kind: 'reader', id, name: info.name, vip: false } : null;
    },
    people: async authors => {
      const map = new Map(authors.flatMap(author => {
        const info = author.kind === 'owner' ? { uid: 'owner', name: '無相' } : accounts.get(author.id);
        return info ? [[`${author.kind}:${author.id}`, { ...info, avatar: null, vip: false, joinedAt: null, bio: '', email: 'private@example.test', phone: '13800138000' }] as const] : [];
      }));
      afterPeople?.();
      return map;
    },
  });
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); await clean(directory); });
  const get = (path: string, identity = '') => fetch(`${origin}/api/community/${path}`, { headers: { cookie: identity } });
  const post = (body: Record<string, unknown>, identity = 'moderator', headers: Record<string, string> = {}) => fetch(`${origin}/api/community/me/contact`, {
    method: 'POST', headers: { cookie: identity, origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const contacts = async (query = '', identity = 'reader') => {
    const response = await get(`moderation-contacts${query}`, identity);
    assert.equal(response.status, 200);
    return await response.json() as { items: ContactPerson[] };
  };
  const slowPost = async (body: Contact, duringBody: () => void) => {
    const payload = JSON.stringify(body);
    let started: () => void = () => {};
    const ready = new Promise<void>(resolve => { started = resolve; });
    bodyStarted = started;
    const client = request(`${origin}/api/community/me/contact`, {
      method: 'POST', headers: { cookie: 'moderator', origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Test-Slow-Body': '1' },
    });
    const response = new Promise<number>((resolve, reject) => {
      client.on('response', incoming => { incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode || 0)); });
      client.on('error', reject);
    });
    client.write(payload.slice(0, 1));
    try {
      await Promise.race([ready, new Promise<never>((_, reject) => { const timeout = setTimeout(() => reject(Error('body was not read')), 3000); timeout.unref(); })]);
      duringBody();
      client.end(payload.slice(1));
      return await response;
    } finally { bodyStarted = null; client.destroy(); }
  };
  return { store, directory, accounts, get, post, contacts, slowPost, onPeople: (run: (() => void) | null) => { afterPeople = run; } };
}

test('author and current moderators save only voluntary contact data and retain it on reopening', async t => {
  const { get, post, directory } = await setup(t);
  assert.deepEqual((await (await get('me', 'moderator')).json()).moderationContact, { qq: '', email: '' });
  assert.equal((await (await get('me', 'reader')).json()).moderationContact, null);
  assert.equal((await post({ qq: '12345678', email: 'appeal@example.test' })).status, 200);
  assert.equal((await post({ qq: '', email: 'owner-contact@example.test' }, 'owner')).status, 200);
  assert.deepEqual((await (await get('me', 'moderator')).json()).moderationContact, { qq: '12345678', email: 'appeal@example.test' });
  const reopened = createCommunityStore(directory);
  try {
    assert.deepEqual(reopened.members.moderationContact(moderator), { qq: '12345678', email: 'appeal@example.test' });
    assert.deepEqual(reopened.members.moderationBoards(moderator), ['qa', 'tools']);
  } finally { reopened.close(); }
});

test('signed-in contact reads are board scoped and never reveal private account data or unlock anonymous APIs', async t => {
  const { store, get, post, contacts } = await setup(t);
  await post({ qq: '12345678', email: '' });
  await post({ qq: '', email: 'showcase@example.test' }, 'other');
  await post({ qq: '', email: 'owner-contact@example.test' }, 'owner');
  const data = await contacts('?board=qa');
  assert.deepEqual(data.items.map(item => item.uid).sort(), ['10002', 'owner']);
  assert.deepEqual(data.items.find(item => !item.owner)?.boards, ['qa', 'tools']);
  assert.deepEqual(Object.keys(data.items[0]).sort(), ['boards', 'email', 'name', 'owner', 'qq', 'uid']);
  assert.doesNotMatch(JSON.stringify(data), /private@example|13800138000|reader:|moderator"/);
  store.members.mute({ kind: 'reader', id: 'reader' }, 7, '其他', { kind: 'owner', id: 'owner' });
  assert.deepEqual(await contacts('?board=qa', 'reader'), data);
  for (const path of ['me', 'summary', 'manage', 'moderation-contacts/extra']) assert.equal((await get(path)).status, 401, path);
  assert.equal((await get('moderation-contacts')).status, 401);
  assert.equal((await get('moderation-contacts?board=unknown', 'reader')).status, 400);
});

test('ordinary accounts, reader browsing mode, foreign origin and forged extra fields cannot set contact or permissions', async t => {
  const { store, post } = await setup(t);
  const body = { qq: '12345678', email: '' };
  for (const identity of ['reader', '', 'moderator; community_browse=reader']) assert.equal((await post(body, identity)).status, identity ? 403 : 401, identity);
  assert.equal((await post(body, 'moderator', { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await post(body, 'moderator', { 'X-Reader-Request': '0' })).status, 403);
  for (const extra of [{ member: 'other' }, { boards: ['vip'] }, { steward: true }]) assert.equal((await post({ ...body, ...extra })).status, 400);
  assert.deepEqual(store.members.moderationBoards(moderator), ['qa', 'tools']);
  assert.deepEqual(store.members.moderationContact(other), { qq: '', email: '' });
});

test('contact validation rejects executable URLs, HTML, controls and malformed identifiers without replacing existing data', async t => {
  const { get, post } = await setup(t);
  const original = { qq: '12345678', email: 'appeal@example.test' };
  await post(original);
  for (const body of [
    { qq: 'javascript:alert(1)', email: '' }, { qq: 'https://example.test', email: '' },
    { qq: '<img onerror=x>', email: '' }, { qq: '000000', email: '' }, { qq: '1234', email: '' },
    { qq: '12345\n', email: '' }, { qq: '12345678', email: 'a@example.test\r\nBcc:b@example.test' },
    { qq: '', email: '<b>a@example.test</b>' }, { qq: '', email: 'javascript:a@example.test' },
    { qq: '', email: 'a@localhost' }, { qq: '', email: 'a\u202e@example.test' },
    { qq: 12345678, email: '' }, { qq: '', email: null }, { qq: '12345678' },
  ]) assert.equal((await post(body)).status, 400, JSON.stringify(body));
  assert.deepEqual((await (await get('me', 'moderator')).json()).moderationContact, original);
});

test('clearing or revoking an appointment removes public contact immediately and stale in-flight writes cannot restore it', async t => {
  const { store, post, contacts, slowPost } = await setup(t);
  await post({ qq: '12345678', email: '' });
  assert.equal((await contacts()).items.length, 1);
  await post({ qq: '', email: '' });
  assert.deepEqual((await contacts()).items, []);
  await post({ qq: '12345678', email: '' });
  assert.equal(await slowPost({ qq: '87654321', email: '' }, () => store.members.setSteward(moderator, false)), 403);
  assert.deepEqual((await contacts()).items, []);
  assert.equal((await post({ qq: '87654321', email: '' })).status, 403);
  store.members.setSteward(moderator, true, ['qa']);
  assert.deepEqual((await contacts()).items, [], 'reappointment does not republish previously removed contact');
});

test('public reads recheck appointments after asynchronous people lookup and omit deleted accounts', async t => {
  const { store, accounts, post, contacts, onPeople } = await setup(t);
  await post({ qq: '12345678', email: '' });
  onPeople(() => store.members.setSteward(moderator, false));
  assert.deepEqual((await contacts('?board=qa')).items, []);
  onPeople(null);
  store.members.setSteward(moderator, true, ['qa']);
  await post({ qq: '12345678', email: '' });
  accounts.delete('moderator');
  assert.deepEqual((await contacts('?board=qa')).items, []);
});

test('formal migration adds public-contact fields to existing member rows without changing their scopes or decorations', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-contact-migration-'));
  t.after(() => clean(directory));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec(`CREATE TABLE community_members (member_kind TEXT NOT NULL, member_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0,
    level_day TEXT, steward INTEGER NOT NULL DEFAULT 0, steward_boards TEXT, frame TEXT, name_color TEXT, cover TEXT, agreed_at TEXT,
    created_at TEXT NOT NULL, PRIMARY KEY(member_kind,member_id));
    INSERT INTO community_members(member_kind,member_id,steward,steward_boards,frame,created_at)
      VALUES('reader','moderator',1,'["qa"]','orbit','2026-10-01T00:00:00Z');`);
  db.close();
  assert.equal((await migrateCommunity(directory)).changed, true);
  assert.equal((await migrateCommunity(directory)).changed, false);
  const store = createCommunityStore(directory);
  try {
    assert.deepEqual(store.members.moderationContact(moderator), { qq: '', email: '' });
    assert.deepEqual(store.members.moderationBoards(moderator), ['qa']);
    assert.equal(store.members.decorations(moderator).frame, 'orbit');
  } finally { store.close(); }
});
