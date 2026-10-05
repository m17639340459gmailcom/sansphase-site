import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';

let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-rates-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => rm(template, { recursive: true, force: true }));

test('account rate limits share counts across connections and reopening, and roll with existing windows', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-rates-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const first = createCommunityStore(directory), second = createCommunityStore(directory);
  const member = { kind: 'reader' as const, id: 'shared-reader' }, now = Date.parse('2026-10-05T02:00:00Z');
  t.after(async () => { second.close(); await rm(directory, { recursive: true, force: true }); });
  first.rateLimits.consume(member, 'topic', 1, now);
  second.rateLimits.consume(member, 'topic', 1, now + 1);
  first.rateLimits.consume(member, 'topic', 1, now + 2);
  assert.throws(() => second.rateLimits.consume(member, 'topic', 1, now + 3), { status: 429 });
  first.close();
  const reopened = createCommunityStore(directory);
  try {
    assert.throws(() => reopened.rateLimits.consume(member, 'topic', 1, now + 4), { status: 429 });
    reopened.rateLimits.consume({ ...member, id: 'other-reader' }, 'topic', 1, now + 4);
    reopened.rateLimits.consume(member, 'reply', 1, now + 4);
    reopened.rateLimits.consume(member, 'topic', 1, now + 10 * 60_000 + 3);
    for (let i = 4; i < 20; i++) reopened.rateLimits.consume(member, 'topic', 1, now + i * 10 * 60_000);
    assert.throws(() => reopened.rateLimits.consume(member, 'topic', 1, now + 20 * 10 * 60_000), { status: 429 }, 'the existing daily limit is still 20');
    reopened.rateLimits.consume(member, 'topic', 2, now + 20 * 10 * 60_000);
    reopened.rateLimits.consume(member, 'topic', 1, now + 24 * 3600_000 + 1);
  } finally { reopened.close(); }
});
