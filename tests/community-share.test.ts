import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createCommunityShare } from '../server/community-share.ts';

test('only live ordinary-board metadata is shared, without body, author or paid prompt', () => {
  let topic = { id: 'post', title: '标题', board: 'qa', pending: false, hidden: false, thumbs: [] as string[] };
  const share = createCommunityShare({ topics: () => [topic], boards: { list: () => [{ id: 'qa', zh: '学习问答' }, { id: 'vip', zh: '会员茶室' }] }, image: () => undefined });
  assert.deepEqual(share.shareTopic('post'), { title: '标题', description: '来自学习问答的讨论，登录社区后查看。' });
  for (const patch of [{ pending: true }, { hidden: true }, { board: 'vip' }, { board: 'missing' }]) {
    const previous = topic; topic = { ...topic, ...patch };
    assert.equal(share.shareTopic('post'), null); topic = previous;
  }
});

test('only the current first topic attachment can become the share cover', () => {
  const id = '12345678-1234-1234-1234-123456789012';
  let attachment = { id, topic_id: 'post', reply_id: null as string | null, purpose: 'content' };
  const share = createCommunityShare({ topics: () => [{ id: 'post', title: '标题', board: 'qa', thumbs: [id] }], boards: { list: () => [{ id: 'qa', zh: '问答' }] }, image: () => attachment });
  assert.equal(share.shareTopic('post')?.imageId, id);
  attachment = { ...attachment, reply_id: 'reply' };
  assert.equal(share.shareTopic('post')?.imageId, undefined);
  attachment = { ...attachment, reply_id: null, topic_id: 'another-post' };
  assert.equal(share.shareTopic('post')?.imageId, undefined);
});

test('untitled posts do not expose their body-derived display title anonymously', () => {
  const share = createCommunityShare({ topics: () => [{ id: 'post', title: '正文开头，只能登录后阅读', hasTitle: false, board: 'qa', thumbs: [] }],
    boards: { list: () => [{ id: 'qa', zh: '问答' }] }, image: () => undefined });
  const projection = share.shareTopic('post');
  assert.equal(projection?.title, '社区讨论');
  assert.ok(!JSON.stringify(projection).includes('正文开头'));
});

test('deleted attachments, wrong purposes and malformed first image identifiers cannot be shared', () => {
  const id = '12345678-1234-1234-1234-123456789012';
  let topic = { id: 'post', title: '标题', board: 'qa', thumbs: [id] };
  let attachment = { id, topic_id: 'post', reply_id: null, purpose: 'content', deleted_at: null as string | null };
  let imageLookups = 0;
  const share = createCommunityShare({ topics: () => [topic], boards: { list: () => [{ id: 'qa', zh: '问答' }] }, image: () => { imageLookups++; return attachment; } });
  for (const patch of [{ deleted_at: '2026-10-11T00:00:00Z' }, { purpose: 'profile' }, { purpose: 'shop' }, { purpose: 'banner' }]) {
    const previous = attachment; attachment = { ...attachment, ...patch };
    assert.equal(share.shareTopic('post')?.imageId, undefined); attachment = previous;
  }
  topic = { ...topic, thumbs: ['../../private', id] };
  const before = imageLookups;
  assert.equal(share.shareTopic('post')?.imageId, undefined);
  assert.equal(imageLookups, before, 'malformed identifiers are rejected before image lookup');
  assert.equal(share.shareTopic('different-post'), null);
});

async function imageFixture(t: test.TestContext) {
  const prefix = resolve(tmpdir(), 'sansphase-share-image-');
  const directory = await mkdtemp(prefix);
  assert.ok(directory.startsWith(prefix));
  await mkdir(resolve(directory, 'uploads'));
  // Only this uniquely-created temporary directory is removed after each case.
  t.after(() => { assert.ok(directory.startsWith(prefix)); return rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const ids = ['12345678-1234-1234-1234-123456789012', '22345678-1234-1234-1234-123456789012', '32345678-1234-1234-1234-123456789012'];
  const original = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#435670' } }).webp().toBuffer();
  for (const id of ids) await writeFile(resolve(directory, 'uploads', `community-image-${id}.webp`), original);
  const states = ids.map((imageId, index) => ({ id: `post-${index}`, title: '标题', board: 'qa', thumbs: [imageId], hidden: false }));
  let removedImage = '';
  const share = createCommunityShare({
    topics: requested => states.filter(topic => requested.includes(topic.id)),
    boards: { list: () => [{ id: 'qa', zh: '问答' }, { id: 'vip', zh: '会员茶室' }] },
    image: id => ({ id, topic_id: `post-${ids.indexOf(id)}`, reply_id: null, purpose: 'content', deleted_at: id === removedImage ? '2026-10-11T00:00:00Z' : null }),
  }, directory);
  return { share, states, directory, ids, remove: (id: string) => { removedImage = id; } };
}

test('an already encoded cover is still revoked when the topic or attachment becomes restricted', async t => {
  const env = await imageFixture(t);
  const bytes = await env.share.shareImage('post-0');
  assert.ok(bytes?.length);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.exif, undefined);
  await unlink(resolve(env.directory, 'uploads', `community-image-${env.ids[0]}.webp`));
  assert.deepEqual(await env.share.shareImage('post-0'), bytes, 'a second public read is served from the bounded encoded cache');
  env.states[0].hidden = true;
  assert.equal(await env.share.shareImage('post-0'), null);
  env.states[0].hidden = false;
  env.states[0].board = 'vip';
  assert.equal(await env.share.shareImage('post-0'), null);
  env.states[0].board = 'qa';
  env.remove(env.ids[0]);
  assert.equal(await env.share.shareImage('post-0'), null);
});

test('moderation revokes an in-flight encoding and concurrent cold requests have a bounded queue', async t => {
  const env = await imageFixture(t);
  const first = env.share.shareImage('post-0');
  const duplicate = env.share.shareImage('post-0');
  const second = env.share.shareImage('post-1');
  const overflow = env.share.shareImage('post-2');
  env.states[0].hidden = true;
  await assert.rejects(overflow, error => error instanceof Error && 'status' in error && error.status === 503,
    'a third distinct cold image signals temporary capacity instead of a permanent missing cover');
  assert.equal(await first, null, 'hiding the topic while disk work is outstanding revokes the response');
  assert.equal(await duplicate, null);
  assert.ok((await second)?.length, 'an unrelated permitted image is still served');
  assert.ok((await env.share.shareImage('post-2'))?.length, 'capacity is released after encoding finishes');
});

test('a failed image decode does not poison the next request or expose source bytes', async t => {
  const env = await imageFixture(t);
  await writeFile(resolve(env.directory, 'uploads', `community-image-${env.ids[0]}.webp`), '<script>private-source</script>');
  assert.equal(await env.share.shareImage('post-0'), null);
  const recovered = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#112233' } }).webp().toBuffer();
  await writeFile(resolve(env.directory, 'uploads', `community-image-${env.ids[0]}.webp`), recovered);
  assert.ok((await env.share.shareImage('post-0'))?.length);
});
