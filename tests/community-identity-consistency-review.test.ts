import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createCommunityService } from '../server/community-service.ts';
import { checkinReward, communityRules } from '../src/community-rules.ts';
import { acceptCommunityConvention } from './fixtures/community-convention-consent.ts';

const reader = { kind: 'reader' as const, id: 'review-reader' };
const cleanup = (directory: string) => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
let template: string;

test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-identity-review-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => cleanup(template));

async function fixture(t: TestContext, profileVip: boolean, finalVip: boolean, ownerPersonal = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-identity-review-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  acceptCommunityConvention(store, [reader]);
  let confirmations = 0;
  let profileResolved = false;
  let service: ReturnType<typeof createCommunityService>;
  const server = createServer((req, res) => { void service.handle(req, res); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing fixture address');
  const origin = `http://127.0.0.1:${address.port}`;
  service = createCommunityService({ store, directory, siteOrigin: origin,
    identify: async () => {
      confirmations++;
      if (confirmations > 1) assert.equal(profileResolved, true, 'final confirmation follows profile lookup');
      return ownerPersonal ? { kind: 'owner', id: 'owner', name: 'Review owner', vip: true }
        : { ...reader, name: 'Review reader', vip: confirmations === 1 ? profileVip : finalVip };
    },
    ownerReaderIdentity: async () => ownerPersonal
      ? { ...reader, name: 'Review personal reader', vip: confirmations === 1 ? profileVip : finalVip } : null,
    people: async authors => {
      profileResolved = true;
      return new Map(authors.filter(author => author.kind === reader.kind && author.id === reader.id).map(author => [
        `${author.kind}:${author.id}`, { name: 'Review reader', uid: '10001', active: true, vip: profileVip, avatar: null, bio: '', joinedAt: null },
      ]));
    },
  });
  t.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    store.close(); await cleanup(directory);
  });
  const cookie = ownerPersonal ? 'community_browse=reader' : '';
  const post = (path: string, body: Record<string, unknown> = {}) => fetch(`${origin}/api/community/${path}`, { method: 'POST',
    headers: { cookie, Origin: origin, 'X-Reader-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { store, confirmations: () => confirmations, checkin: () => post('checkin'), post,
    get: (path: string) => fetch(`${origin}/api/community/${path}`, { headers: { cookie } }),
  };
}

for (const finalVip of [false, true]) test(`check-in uses final confirmed ${finalVip ? 'renewed' : 'expired'} VIP for the real reward`, async t => {
  const env = await fixture(t, !finalVip, finalVip);
  const response = await env.checkin();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(env.confirmations(), 2, 'the authority is read initially and immediately before the write');
  const result = await response.json() as { reward: number; bonus: number; balance: number };
  const expected = checkinReward(false, finalVip).total;
  assert.equal(result.bonus, 0);
  assert.equal(result.reward, expected, 'an earlier profile must not choose the membership reward');
  assert.equal(result.balance, expected);
  assert.equal(env.store.ledger.balance(reader), expected, 'the persisted reward follows the final authority');
});

test('owner personal maximum appearance does not add VIP makeup eligibility to a non-VIP account', async t => {
  const env = await fixture(t, false, false, true);
  const response = await env.get('checkin');
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as { makeup: { allowed: number; free: boolean; cost: number } };
  assert.equal(result.makeup.allowed, communityRules.makeupPerMonth, 'displayed VIP8 must not add a real makeup');
  assert.equal(result.makeup.free, false, 'a non-VIP account does not receive a free makeup');
  assert.equal(result.makeup.cost, communityRules.makeupCost);
});

test('owner personal maximum appearance cannot give a non-VIP account its first makeup for free', async t => {
  const env = await fixture(t, false, false, true);
  env.store.ledger.credit(reader, 100, 'test', null, new Date().toISOString());
  const day = env.store.economy.makeupState(reader, { vip: false }).days[0];
  const response = await env.post('checkin/makeup', { day });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as { cost: string; balance: number };
  assert.equal(result.cost, 'stardust', 'the actual personal membership controls the price');
  assert.equal(result.balance, 100 - communityRules.makeupCost);
  assert.equal(env.store.ledger.balance(reader), 100 - communityRules.makeupCost);
});

test('owner personal maximum appearance cannot spend a third makeup on a non-VIP account', async t => {
  const env = await fixture(t, false, false, true);
  env.store.ledger.credit(reader, 150, 'test', null, new Date().toISOString());
  const days = env.store.economy.makeupState(reader, { vip: false }).days;
  for (const day of days.slice(0, communityRules.makeupPerMonth)) env.store.economy.makeup(reader, day, { vip: false });
  const balance = env.store.ledger.balance(reader);
  const response = await env.post('checkin/makeup', { day: days[communityRules.makeupPerMonth] });
  assert.equal(response.status, 409, 'the ordinary two-makeup monthly limit is authoritative');
  assert.equal(env.store.ledger.balance(reader), balance, 'an unavailable third makeup must not debit the real account');
  assert.equal(env.store.economy.makeupState(reader, { vip: false }).used, communityRules.makeupPerMonth);
});
