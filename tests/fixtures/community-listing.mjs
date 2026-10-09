import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { migrateCommunity } from '../../server/payload/community-migration.ts';
import { createCommunityStore } from '../../server/community-store.ts';
import { createCommunityService } from '../../server/community-service.ts';
import { acceptCommunityConvention } from './community-convention-consent.ts';

export const owner = { kind: 'owner', id: 'owner' };
export const reader = id => ({ kind: 'reader', id });
export const listingIds = listing => listing.items.map(item => item.id);
const day = 86400000;
const prefix = 'sansphase-community-listing-';

async function cleanup(directory) {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith(prefix));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// Each suite owns its template and each case owns a copied migrated database.
// Register hooks explicitly: importing this module never starts tests or services.
export function createCommunityListingFixture(test) {
  let template;
  test.before(async () => {
    template = await mkdtemp(resolve(tmpdir(), `${prefix}template-`));
    new DatabaseSync(resolve(template, 'content.db')).close();
    await migrateCommunity(template);
  });
  test.after(async () => { if (template) await cleanup(template); });

  return async function setup(t) {
    const directory = await mkdtemp(resolve(tmpdir(), `${prefix}http-`));
    await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
    await mkdir(resolve(directory, 'uploads'));
    const store = createCommunityStore(directory);
    const accounts = new Map([
      ['reader', { uid: '10001', name: '普通读者', vip: false, active: true }],
      ['vip', { uid: '10002', name: '会员读者', vip: true, active: true }],
      ['mod', { uid: '10003', name: '管理读者', vip: false, active: true }],
      ['author', { uid: '10004', name: '帖子作者', vip: false, active: true }],
    ]);
    for (const id of accounts.keys()) store.members.visit(reader(id));
    acceptCommunityConvention(store, [owner, ...[...accounts.keys()].map(reader)]);
    let beforePeople, beforeIdentify, beforeNames;
    let service;
    const server = createServer((req, res) => { void service.handle(req, res); });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    service = createCommunityService({
      store, directory, siteOrigin: origin,
      identify: async req => {
        const id = String(req.headers.cookie || '').split(';')[0];
        const account = accounts.get(id);
        const value=account?.active ? { ...reader(id), name: account.name, vip: account.vip } : null;
        await beforeIdentify?.(value);
        return value;
      },
      people: async authors => {
        await beforePeople?.(authors);
        return new Map(authors.flatMap(author => {
          const info = author.kind === 'owner' ? { name: '测试站长', uid: 'owner', vip: true, active: true } : accounts.get(author.id);
          return info ? [[`${author.kind}:${author.id}`, { ...info, avatar: null, joinedAt: null, bio: '' }]] : [];
        }));
      },
      findMember: async uid => uid === 'owner' ? owner : [...accounts].filter(([, account]) => account.uid === uid).map(([id]) => reader(id))[0] || null,
      findByNames: async names => { await beforeNames?.(names); return new Map([...accounts].filter(([,info])=>names.includes(info.name)).map(([id,info])=>[info.name,reader(id)])); },
    });
    t.after(async () => {
      await new Promise(done => server.close(done));
      store.close();
      await cleanup(directory);
    });
    const get = (path, identity = 'reader') => fetch(`${origin}/api/community/${path}`, { headers: { Cookie: identity } });
    const list = async (path, identity = 'reader') => {
      const response = await get(path, identity);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return response.json();
    };
    const now = Date.now();
    const ago = days => new Date(now - days * day).toISOString();
    const topic = (title, days = 0, options = {}) => store.createTopic({
      board: 'qa', author: owner, title, body: '用于真实列表接口回归的完整正文内容。', now: ago(days), ...options,
    });
    return { directory, origin, store, accounts, get, list, topic, ago,
      onPeople: hook => { beforePeople = hook; }, onIdentify: hook => { beforeIdentify=hook; }, onNames: hook => { beforeNames=hook; } };
  };
}
