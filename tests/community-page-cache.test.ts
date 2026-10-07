import test from 'node:test';
import assert from 'node:assert/strict';
import { communityPageCacheLimits, createCommunityPageCache } from '../src/community-page-cache.ts';

test('page caches have explicit item limits and evict the least recently read DTO', () => {
  assert.deepEqual(communityPageCacheLimits, { threads: 24, members: 48, lists: 64 });
  const cache = createCommunityPageCache<{ title: string }>(2);
  cache.set('a', { title: 'A' }).set('b', { title: 'B' });
  assert.equal(cache.get('a')?.title, 'A');
  cache.set('c', { title: 'C' });
  assert.equal(cache.size, 2);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.get('a')?.title, 'A');
});

test('late historical reads cannot evict the current page and no DTO size limit blanks it', () => {
  let current = 'current';
  const cache = createCommunityPageCache<{ body: string }>(2, () => current);
  const large = { body: '正文'.repeat(1024 * 1024) };
  cache.set(current, large);
  for (let i = 0; i < 100; i++) cache.set(`old-${i}`, { body: String(i) });
  assert.equal(cache.size, 2);
  assert.equal(cache.get(current), large);
  current = 'old-99';
  cache.set('new', { body: 'new' });
  assert.equal(cache.has('current'), false);
  assert.equal(cache.has('old-99'), true);
});

test('DTOs do not expire by time and explicit clear removes every account entry', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const cache = createCommunityPageCache<{ uid: string }>(2);
  cache.set('a', { uid: '10001' });
  t.mock.timers.tick(365 * 24 * 60 * 60 * 1000);
  assert.equal(cache.get('a')?.uid, '10001');
  assert.equal(cache.delete('a'), true);
  cache.set('a', { uid: '10001' }).set('b', { uid: '10001' });
  cache.clear();
  assert.equal(cache.size, 0);
});

test('snapshot traversal allows profile DTO updates and removals without revisiting promoted entries', () => {
  const cache = createCommunityPageCache<{ signature: string }>(3);
  for (const key of ['10001|topics', '10001|replies', '20002|topics']) cache.set(key, { signature: 'old' });
  let visits = 0;
  for (const [key, value] of [...cache]) {
    visits++;
    if (key.startsWith('10001|')) cache.set(key, { ...value, signature: 'approved' });
  }
  assert.equal(visits, 3);
  assert.equal(cache.get('10001|topics')?.signature, 'approved');
  assert.equal(cache.get('10001|replies')?.signature, 'approved');
  for (const key of [...cache.keys()]) if (key.startsWith('10001|')) cache.delete(key);
  assert.deepEqual([...cache.keys()], ['20002|topics']);
});
