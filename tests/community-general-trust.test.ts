import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import type { CommunityAuthor } from '../server/community-db.ts';
import type { CommunityMe, CommunityPerson } from '../src/community.ts';
import type { CommunityStardust, CommunityMember } from '../src/community-pages.ts';
import type { CommunityThread } from '../src/community-post.ts';
import { communityStaffCapabilities } from '../src/community-staff.ts';
import { beijingDay, communityReportReasons } from '../src/community-rules.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const owner: CommunityAuthor = { kind: 'owner', id: 'owner' };
const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-general-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function fixture(t: TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-general-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  const accounts = new Map(['general', 'moderator', 'assistant', 'reader', 'peer'].map((id, index) => [id, { uid: String(30001 + index), active: true }]));
  acceptCommunityConvention(store, [owner, ...[...accounts.keys()].map(reader)]);
  const permissions = communityStaffCapabilities.map(capability => capability.id);
  const appoint = (parent: CommunityAuthor, id: string, role: 'general' | 'moderator' | 'assistant') => store.staff.appoint(parent, reader(id), {
    role, boards: ['qa', 'tools', 'showcase', 'vip'], permissions, delegable: role === 'assistant' ? [] : permissions,
  });
  appoint(owner, 'general', 'general');
  appoint(reader('general'), 'moderator', 'moderator');
  appoint(reader('moderator'), 'assistant', 'assistant');
  appoint(owner, 'peer', 'general');
  let onNames: (() => void) | undefined;
  let onPeople: ((authors: CommunityAuthor[]) => void) | undefined;
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  service = createCommunityService({ store, siteOrigin: origin, directory,
    identify: async req => {
      const id = String(req.headers.cookie || 'reader').split(';')[0];
      return id === 'owner' ? { ...owner, name: '作者', vip: true } : accounts.get(id)?.active ? { ...reader(id), name: id, vip: false } : null;
    },
    people: async authors => {
      onPeople?.(authors);
      return new Map(authors.flatMap(author => {
        const account = accounts.get(author.id);
        const info = author.kind === 'owner' ? { name: '作者', uid: 'owner', active: true } : account ? { name: author.id, ...account } : null;
        return info ? [[`${author.kind}:${author.id}`, { ...info, avatar: null, vip: author.kind === 'owner', joinedAt: null, bio: '' }]] : [];
      }));
    },
    findMember: async uid => uid === 'owner' ? owner : [...accounts].filter(([, account]) => account.uid === uid).map(([id]) => reader(id))[0] || null,
    findByNames: async () => { onNames?.(); return new Map([['读者', reader('reader')]]); },
  });
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); await cleanup(directory); });
  const get = (path: string, identity = 'general') => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: identity } });
  const json = async <T>(path: string, identity?: string): Promise<T> => {
    const response = await get(path, identity);
    assert.equal(response.status, 200, path);
    return await response.json() as T;
  };
  const post = (path: string, body: Record<string, unknown>, identity = 'general') => fetch(`${origin}/api/community/${path}`, {
    method: 'POST', headers: { Cookie: identity, Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const images = (n: number, identity = 'general') => Array.from({ length: n }, () => {
    const id = randomUUID(); store.addImage({ id, uploader: reader(identity), width: 640, height: 480 }); return id;
  });
  const body = (ids: string[], board = 'qa', text = '完整的权限与图片回归测试正文') => ({
    board, title: '总版主权限测试', body: `${text}\n${ids.map(id => `![图片](/api/community/images/${id}.webp)`).join('\n')}`, images: ids,
  });
  const topic = (identity = 'reader') => store.createTopic({ board: 'qa', author: reader(identity), title: '已有讨论权限测试', body: '完整的公开测试讨论正文内容' });
  const sql = (execute: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(resolve(directory, 'content.db')); try { execute(db); } finally { db.close(); }
  };
  return { store, accounts, appoint, get, json, post, images, body, topic, sql,
    onNames(hook: () => void) { onNames = hook; }, onPeople(hook: (authors: CommunityAuthor[]) => void) { onPeople = hook; },
  };
}

test('only an active general projects maximum ordinary trust in account and public DTOs, without changing earned growth or VIP', async t => {
  const f = await fixture(t);
  const before = f.store.experience.state(reader('general'));
  const beforeVip = f.store.experience.vipState(reader('general'), false);
  for (const [id, expected] of [['general', 3], ['moderator', 0], ['assistant', 0]] as const) {
    const me = await f.json<CommunityMe>('me', id);
    assert.equal(me.level, expected, id); assert.equal(me.trustLevel, expected, id); assert.equal(me.vip, false, id);
    const member = await f.json<CommunityMember>(`members/${f.accounts.get(id)!.uid}`, 'reader');
    assert.equal(member.person.level, expected, id);
    const dust = await f.json<CommunityStardust>('stardust', id); assert.equal(dust.level, expected, id);
    assert.equal(f.store.members.trustLevel(reader(id)), 0, 'appointments do not write earned trust');
  }
  const topic = f.topic('general');
  const thread = await f.json<CommunityThread>(`topics/${topic.id}`, 'reader'); assert.equal(thread.topic.author.level, 3);
  const list = await f.json<{ items: Array<{ author: CommunityPerson }> }>('topics', 'reader'); assert.equal(list.items[0].author.level, 3);
  assert.deepEqual(f.store.experience.state(reader('general')), before);
  assert.deepEqual(f.store.experience.vipState(reader('general'), false), beforeVip);
  assert.equal((await f.json<CommunityMe>('me', 'owner')).trustLevel, 4);
});

test('a general publishes beyond newcomer quotas, edits multiple images, and replies with the normal board image caps', async t => {
  const f = await fixture(t);
  const first = await f.post('topics', f.body(f.images(4))); assert.equal(first.status, 201, await first.clone().text());
  const result = await first.json() as { id: string; pending: boolean };
  assert.equal(f.store.topic(result.id)!.pending, false, 'a first general picture post publishes directly');
  const edit = await f.post(`topics/${result.id}/edit`, f.body(f.store.topic(result.id)!.images.map(image => image.id))); assert.equal(edit.status, 200, await edit.clone().text());
  const second = await f.post('topics', f.body(f.images(9), 'showcase')); assert.equal(second.status, 201, await second.clone().text());
  const third = await f.post('topics', f.body(f.images(4), 'tools')); assert.equal(third.status, 201, await third.clone().text());
  assert.equal((await f.post('topics', f.body(f.images(5)))).status, 400);
  assert.equal((await f.post('topics', f.body(f.images(10), 'showcase'))).status, 400);
  const parent = f.topic(), replyBody = f.body(f.images(4)).body;
  const reply = await f.post(`topics/${parent.id}/replies`, { body: replyBody }); assert.equal(reply.status, 201, await reply.clone().text());
  assert.equal((await f.post(`topics/${parent.id}/replies`, { body: f.body(f.images(5)).body })).status, 400);
});

test('moderator and assistant keep their own image caps and public earned levels after appointment', async t => {
  const f = await fixture(t);
  for (const id of ['moderator', 'assistant']) {
    assert.equal((await f.post('topics', f.body(f.images(2, id)), id)).status, 400);
    assert.equal((await f.json<CommunityMe>('me', id)).level, 0);
  }
});

for (const change of ['revocation', 'demotion', 'inactive account'] as const) {
  test(`a general loses the projection on ${change}, including public DTOs`, async t => {
    const f = await fixture(t), target = f.topic('general');
    if (change === 'revocation') f.store.staff.revoke(owner, reader('general'));
    else if (change === 'demotion') f.appoint(owner, 'general', 'moderator');
    else f.accounts.get('general')!.active = false;
    const thread = await f.json<CommunityThread>(`topics/${target.id}`, 'reader'); assert.equal(thread.topic.author.level, 0);
    if (change !== 'inactive account') {
      const me = await f.json<CommunityMe>('me'); assert.equal(me.level, 0); assert.equal(me.trustLevel, 0);
    }
    assert.equal(f.store.members.trustLevel(reader('general')), 0);
  });
  for (const operation of ['topic', 'reply'] as const) {
    test(`an asynchronous ${operation} request cannot retain general image privileges after ${change}`, async t => {
      const f = await fixture(t), parent = f.topic();
      f.onNames(() => {
        if (change === 'revocation') f.store.staff.revoke(owner, reader('general'));
        else if (change === 'demotion') f.appoint(owner, 'general', 'moderator');
        else f.accounts.get('general')!.active = false;
      });
      const input = f.body(f.images(2), 'qa', '解析提及期间更新权限 @读者');
      const response = await f.post(operation === 'topic' ? 'topics' : `topics/${parent.id}/replies`, operation === 'topic' ? input : { body: input.body });
      assert.equal(response.status, change === 'inactive account' ? 401 : 400, await response.clone().text());
      assert.equal(f.store.authorStats(reader('general')).topics, 0);
      assert.equal(f.store.authorStats(reader('general')).replies, 0);
    });
  }
}

test('stardust and editing use the final effective level after profile lookup revokes the general', async t => {
  const f = await fixture(t);
  let calls = 0;
  f.onPeople(() => { if (++calls === 2) f.store.staff.revoke(owner, reader('general')); });
  const dust = await f.json<CommunityStardust>('stardust'); assert.equal(dust.level, 0);
  f.onPeople(() => {}); f.appoint(owner, 'general', 'general');
  const id = f.images(1)[0], at = new Date(Date.now() - 2 * 24 * 3600e3).toISOString();
  const target = f.store.createTopic({ board: 'qa', author: reader('general'), title: '超过一天的旧讨论', body: f.body([id]).body, images: [id], now: at });
  f.onPeople(() => { f.store.staff.revoke(owner, reader('general')); });
  assert.equal((await f.post(`topics/${target.id}/edit`, f.body([id]))).status, 403);
});

test('an account invalidated during the final staff refresh cannot keep an earlier general person projection', async t => {
  const f = await fixture(t);
  let calls = 0;
  f.onPeople(() => { if (++calls === 3) f.accounts.get('general')!.active = false; });
  const me = await f.get('me'); assert.equal(me.status, 401);
  assert.deepEqual(Object.keys(await me.json()), ['error'], 'an inactive execution account cannot receive an old person projection');
  f.accounts.get('general')!.active = true; f.onPeople(() => {});
  const ids = f.images(2), target = f.store.createTopic({ board: 'qa', author: reader('general'), title: '保留旧图片权限测试', body: f.body(ids).body, images: ids });
  calls = 0; f.onPeople(() => { if (++calls === 4) f.accounts.get('general')!.active = false; });
  const original = f.store.topic(target.id)!;
  const edit = await f.post(`topics/${target.id}/edit`, f.body(ids)); assert.equal(edit.status, 401, await edit.clone().text());
  assert.equal(f.store.topic(target.id)!.body, original.body);
  assert.deepEqual(f.store.topic(target.id)!.images, original.images, 'identity rejection preserves the existing images');
});

test('daily throttling receives projected trust without changing the existing daily event history', async t => {
  const f = await fixture(t), at = Date.now() - 11 * 60_000;
  f.sql(db => {
    const insert = db.prepare('INSERT INTO community_rate_events(member_kind,member_id,action,created_at) VALUES(?,?,?,?)');
    for (let i = 0; i < 20; i++) { insert.run('reader', 'general', 'topic', at); insert.run('reader', 'reader', 'topic', at); }
  });
  const promoted = await f.post('topics', f.body(f.images(1))); assert.equal(promoted.status, 201, await promoted.clone().text());
  assert.equal((await f.post('topics', f.body(f.images(1, 'reader')), 'reader')).status, 429);
});

test('effective trust protects a general from automatic low-level report hiding and rechecks the reporter after awaits', async t => {
  const f = await fixture(t), target = f.topic('general');
  f.sql(db => db.prepare('UPDATE community_members SET level=3,level_day=? WHERE member_kind=? AND member_id=?').run(beijingDay(Date.now()), 'reader', 'reader'));
  const report = await f.post('reports', { kind: 'topic', id: target.id, reason: communityReportReasons[0] }, 'reader');
  assert.equal(report.status, 201, await report.clone().text()); assert.equal(f.store.topic(target.id)!.hidden, false);
  const ordinary = f.topic('reader');
  f.onPeople(authors => { if (authors.some(author => author.id === 'reader')) f.store.staff.revoke(owner, reader('general')); });
  assert.equal((await f.post('reports', { kind: 'topic', id: ordinary.id, reason: communityReportReasons[0] })).status, 403);
  assert.equal(f.store.topic(ordinary.id)!.hidden, false);
});

test('general trust does not bypass VIP, mute, convention, or read-only browsing boundaries', async t => {
  const f = await fixture(t), input = f.body(f.images(1));
  assert.equal((await f.post('topics', { ...input, board: 'vip' })).status, 403);
  const browse = await f.json<CommunityMe>('me', 'general; community_browse=reader');
  assert.equal(browse.level, 1); assert.equal(browse.trustLevel, 1); assert.equal(browse.staff, null);
  assert.equal((await f.post('topics', input, 'general; community_browse=reader')).status, 403);
  f.store.members.mute(reader('general'), 1, '隔离测试禁言', owner);
  assert.equal((await f.post('topics', input)).status, 403);
  f.sql(db => db.prepare('UPDATE community_members SET agreed_version=NULL WHERE member_kind=? AND member_id=?').run('reader', 'general'));
  assert.equal((await f.post('topics', input)).status, 428);
});
