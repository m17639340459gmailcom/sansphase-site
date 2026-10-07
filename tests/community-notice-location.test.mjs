import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeHref } from '../src/community-pages.ts';
import { communityRoute } from '../src/community.ts';

test('reply notifications preserve the exact reply destination, including on reload', () => {
  const href = noticeHref({ type: 'reply', topicId: 'topic-1', replyId: 'reply-2', link: null }, null);
  assert.equal(href, '#/post/topic-1/reply/reply-2');
  assert.deepEqual(communityRoute(href), { view: 'post', id: 'topic-1', board: '', tab: '', replyId: 'reply-2' });
  assert.equal(communityRoute(href + '/extra').view, 'unknown');
  assert.equal(noticeHref({ type: 'like', topicId: 'topic-1', replyId: null }, null), '#/post/topic-1');
  assert.equal(noticeHref({ type: 'system', topicId: 'topic-1', link: '#/community/manage/reports' }, null), '#/community/manage/reports');
});
