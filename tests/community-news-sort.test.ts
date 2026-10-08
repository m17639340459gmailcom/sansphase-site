import test from 'node:test';
import assert from 'node:assert/strict';
import { communitySorts, isCommunitySort, sortTopics } from '../src/community.ts';
import type { CommunityTopic } from '../src/community.ts';

test('the news read mode orders by original publication time without promoting old pins or later replies', () => {
  assert.equal(isCommunitySort('published'), true);
  const topics: CommunityTopic[] = [
    { id: 'old-pin', board: 'news-custom', title: 'old pin', author: { name: '作者', uid: null, role: 'owner' }, createdAt: '2026-01-01T00:00:00Z', lastActivityAt: '2026-10-09T12:00:00Z', pinned: true, likes: 99, replies: 99 },
    { id: 'new', board: 'news-custom', title: 'new', author: { name: '作者', uid: null, role: 'owner' }, createdAt: '2026-10-09T11:00:00Z', lastActivityAt: '2026-10-09T11:00:00Z', likes: 0, replies: 0 },
    { id: 'old-paid', board: 'news-custom', title: 'old paid', author: { name: '作者', uid: null, role: 'owner' }, createdAt: '2026-02-01T00:00:00Z', lastActivityAt: '2026-10-09T13:00:00Z', paidPin: true, featured: true, likes: 99, replies: 99 },
  ];
  assert.deepEqual(sortTopics(topics, 'published').map(topic => topic.id), ['new', 'old-paid', 'old-pin']);
  assert.deepEqual(sortTopics(topics, 'newest').map(topic => topic.id), ['old-pin', 'old-paid', 'new']);
  assert.equal(communitySorts.some(([value]) => value === 'published'), false, 'the internal read mode does not add another sort tab');
});
