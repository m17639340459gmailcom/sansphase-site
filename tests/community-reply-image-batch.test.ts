import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import type { CommunityAuthor } from '../server/community-db.ts';

const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const at = '2026-10-07T01:00:00.000Z';
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'community-reply-images-template-'));
  new DatabaseSync(resolve(template, 'content.db')).close();
  await migrateCommunity(template);
});
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'community-reply-images-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  t.after(async () => { store.close(); db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const image = (uploader: CommunityAuthor, purpose: 'content' | 'shop' | 'banner' | 'profile' = 'content') => {
    const id = randomUUID();
    store.addImage({ id, uploader, width: 800, height: 600, purpose, now: at });
    return id;
  };
  const topic = (author: CommunityAuthor, images: string[] = []) => store.createTopic({ board: 'qa', author, title: '回复附件批量读取回归', body: '测试正文，不访问真实用户数据。', images, now: at });
  return { store, db, image, topic };
}

test('thread attachment grouping exactly retains per-reply selection, position order and public image fields', async t => {
  const { store, db, image, topic } = await fixture(t);
  const author = reader('author'), helper = reader('helper'), other = reader('other');
  const topicImage = image(author);
  const subject = topic(author, [topicImage]);
  const otherTopic = topic(other, [image(other)]);
  const firstImages = [image(helper), image(helper), image(helper)];
  const first = store.addReply({ topicId: subject.id, author: helper, body: '第一条带多张图片的回复', images: [firstImages[2], firstImages[0], firstImages[1]], now: at });
  const empty = store.addReply({ topicId: subject.id, author: other, body: '没有图片的回复', now: at });
  const hiddenImage = image(other);
  const hidden = store.addReply({ topicId: subject.id, author: other, body: '隐藏回复仍由详情权限控制', images: [hiddenImage], now: at });
  const deletedImage = image(helper);
  const deleted = store.addReply({ topicId: subject.id, author: helper, body: '已删除回复不能混入附件', images: [deletedImage], now: at });
  store.addReply({ topicId: otherTopic.id, author: helper, body: '另一个帖子的图片不能混入', images: [image(helper)], now: at });
  for (const purpose of ['content', 'shop', 'banner', 'profile'] as const) image(helper, purpose);
  // Editing retires only the removed image. Shared position values deliberately
  // interleave different replies; grouping must retain each reply's own order.
  store.editReply(first.id, { editor: helper, body: '编辑后的多图回复', images: [firstImages[2], firstImages[1]], now: at });
  db.prepare('UPDATE community_images SET position=0 WHERE id=?').run(firstImages[1]);
  store.hide({ kind: 'reply', id: hidden.id }, '测试隐藏', at);
  store.deleteReply(deleted.id, { now: at });
  assert.ok(store.image(deletedImage), 'deleting a reply keeps its image registry for existing moderation semantics');

  const expected = db.prepare('SELECT id, width, height FROM community_images WHERE topic_id = ? AND reply_id = ? AND deleted_at IS NULL ORDER BY position');
  const detail = store.topic(subject.id)!;
  assert.deepEqual(detail.replies.map(reply => reply.id), [first.id, empty.id, hidden.id], 'same-time replies retain insertion order and omit deleted replies');
  for (const reply of detail.replies) {
    assert.deepEqual(plain(reply.images), plain(expected.all(subject.id, reply.id)), `legacy per-reply selection remains exact for ${reply.id}`);
    for (const item of reply.images) assert.deepEqual(Object.keys(item), ['id', 'width', 'height'], 'internal grouping key is not returned');
  }
  assert.deepEqual(detail.images.map(item => item.id), [topicImage], 'topic attachments remain separate');
  assert.deepEqual(detail.replies.find(reply => reply.id === first.id)!.images.map(item => item.id), [firstImages[1], firstImages[2]], 'equal positions retain the existing SQLite insertion tie order');
  assert.deepEqual(detail.replies.find(reply => reply.id === empty.id)!.images, []);
  assert.equal(detail.replies.find(reply => reply.id === hidden.id)!.hidden, true);
  assert.deepEqual(detail.replies.find(reply => reply.id === hidden.id)!.images.map(item => item.id), [hiddenImage], 'hidden images remain available for the existing viewer permission mask');
  assert.ok(store.image(firstImages[0])!.deleted_at, 'soft-deleted image is excluded');
  assert.equal(store.topic(otherTopic.id)!.replies.length, 1);
  assert.equal(store.topic('missing'), null);
  assert.deepEqual(store.topic(topic(author).id)!.replies, []);
});

test('one thousand replies read attachments once per detail without changing reply order or empty arrays', async t => {
  const { store, db, topic } = await fixture(t);
  const subject = topic(reader('author'));
  const insert = db.prepare('INSERT INTO community_replies(id,topic_id,author_kind,author_id,body,created_at) VALUES(?,?,\'reader\',?,?,?)');
  const ids: string[] = [];
  db.exec('BEGIN');
  for (let n = 0; n < 1000; n++) {
    const id = randomUUID(); ids.push(id);
    insert.run(id, subject.id, `helper-${n % 100}`, `第${n}条合成回复`, at);
  }
  db.exec('COMMIT');
  const original = StatementSync.prototype.all;
  let reads = 0;
  t.mock.method(StatementSync.prototype, 'all', function (this: StatementSync, ...args: Parameters<StatementSync['all']>) {
    const sql = this.sourceSQL.replace(/\s+/g, ' ').trim();
    if (/^SELECT (?:i\.)?id,/i.test(sql) && sql.includes('FROM community_images') && sql.includes('reply_id') && !/reply_id IS NULL/i.test(sql)) reads++;
    return original.apply(this, args);
  });
  const detail = store.topic(subject.id)!;
  assert.deepEqual(detail.replies.map(reply => reply.id), ids);
  assert.ok(detail.replies.every(reply => reply.images.length === 0));
  assert.equal(reads, 1, 'attachment query cost must be independent of the number of replies');
  store.topic(subject.id);
  assert.equal(reads, 2, 'a fresh second detail read remains fresh and does not reuse a request snapshot');
  store.topic(topic(reader('another-author')).id);
  assert.equal(reads, 2, 'a thread without replies does not add an attachment query');
});
