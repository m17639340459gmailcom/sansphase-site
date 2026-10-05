import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateCommunity } from '../server/payload/community-migration.ts';
import { createCommunityStore } from '../server/community-store.ts';
import { createReaderWorkflow } from '../server/reader-workflow.ts';
import { cleanReaderFiles } from '../server/reader-file-cleanup.ts';
import { removeReaderAccount, resumeReaderCleanup } from '../server/reader-account-removal.ts';

let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'reader-cleanup-template-'));
  const db = new DatabaseSync(resolve(template, 'content.db'));
  db.exec('CREATE TABLE readers (id TEXT PRIMARY KEY)'); db.close();
  await migrateCommunity(template);
});
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'reader-community-cleanup-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  const store = createCommunityStore(directory);
  const workflow = createReaderWorkflow(directory, 'test-cleanup-secret'.repeat(3));
  t.after(async () => { store.close(); db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const old = { kind: 'reader' as const, id: 'old' }, live = { kind: 'reader' as const, id: 'live' };
  const at = '2026-01-01T00:00:00.000Z';
  const topic = (author = old) => store.createTopic({ author, board: 'qa', title: '账户内容', body: '原始正文需要永久清理', now: at });
  return { directory, db, store, workflow, old, live, at, topic };
}

test('permanent cleanup removes content, old balance, private orders and references while preserving other accounts', async t => {
  const { db, store, workflow, old, live, at, topic } = await fixture(t);
  db.prepare('INSERT INTO readers VALUES (?)').run(live.id);
  const expired = topic(), surviving = topic(live);
  const child = store.addReply({ topicId: expired.id, author: live, body: '其他用户在过期主题中的回复', now: at });
  const oldReply = store.addReply({ topicId: surviving.id, author: old, body: '过期账号在其他主题中的回复', now: at });
  const liveReply = store.addReply({ topicId: surviving.id, author: live, body: '其他用户保留回复', now: at });
  db.prepare('UPDATE community_replies SET quote_id=? WHERE id=?').run(oldReply.id, liveReply.id);
  db.prepare('UPDATE community_topics SET accepted_reply_id=?, accepted_at=? WHERE id=?').run(oldReply.id, at, surviving.id);
  db.prepare('INSERT INTO community_revisions VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'topic', expired.id, '旧标题', '旧正文', '[]', 'reader', old.id, at);
  db.prepare("INSERT INTO community_banner_entries VALUES ('home',0,?,'qa','',NULL)").run(expired.id);
  db.prepare("UPDATE community_banners SET version=4 WHERE scope='home'").run();
  store.ledger.credit(live, 80, 'thank', { kind: 'topic', id: expired.id }, at, 'in');
  store.ledger.credit(old, 250, 'thank', null, at, 'in');
  const balance = store.ledger.balance(live);
  const image = randomUUID(), shared = randomUUID();
  for (const id of [image, shared]) db.prepare('INSERT INTO community_images(id,uploader_kind,uploader_id,topic_id,width,height,created_at) VALUES (?,\'reader\',?,?,1,1,?)').run(id, old.id, expired.id, at);
  db.prepare("INSERT INTO community_banner_entries VALUES ('qa',0,?,'qa','',?)").run(surviving.id, shared);
  db.prepare("UPDATE community_banners SET version=2 WHERE scope='qa'").run();
  db.prepare("INSERT INTO community_shop_items(id,cat,name,description,price,stock,stock_left,created_at,updated_at) VALUES ('goods','goods','物品','说明',50,5,2,?,?)").run(at, at);
  for (const status of ['pending','shipped']) db.prepare('INSERT INTO community_orders(id,member_kind,member_id,item,item_name,price,status,ship_address,created_at) VALUES (?,\'reader\',?,\'goods\',\'物品\',50,?,\'地址\',?)').run(randomUUID(), old.id, status, at);
  db.prepare("INSERT INTO community_audit_events VALUES ('audit','reader','old','delete','{}',?,NULL)").run(at);
  const result = store.purgeReaderData(old.id, workflow.queueFile);
  assert.equal(result.topics, 1); assert.equal(result.replies, 2);
  for (const table of ['community_topics','community_replies','community_revisions']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'community_revisions' ? 'target_id' : 'id'} IN (?,?,?)`).get(expired.id, oldReply.id, child.id)?.n, 0);
  }
  assert.equal(store.topic(surviving.id)?.replyCount, 1);
  assert.equal(store.topic(surviving.id)?.replies[0].id, liveReply.id);
  assert.equal(db.prepare('SELECT quote_id FROM community_replies WHERE id=?').get(liveReply.id)?.quote_id, null);
  assert.equal(db.prepare('SELECT accepted_reply_id FROM community_topics WHERE id=?').get(surviving.id)?.accepted_reply_id, null);
  assert.equal(store.ledger.balance(old), 0); assert.equal(store.ledger.balance(live), balance);
  assert.equal(db.prepare("SELECT stock_left FROM community_shop_items WHERE id='goods'").get()?.stock_left, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_orders WHERE member_id='old'").get()?.n, 0);
  assert.equal(db.prepare("SELECT version FROM community_banners WHERE scope='home'").get()?.version, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_audit_events WHERE actor_id='old'").get()?.n, 1);
  assert.equal(db.prepare('SELECT id FROM community_images WHERE id=?').get(shared)?.id, shared);
  assert.equal(db.prepare('SELECT topic_id FROM community_images WHERE id=?').get(shared)?.topic_id, null);
  assert.equal(workflow.cleanupFiles().length, 2);
  store.purgeReaderData(old.id, workflow.queueFile);
  assert.equal(db.prepare("SELECT stock_left FROM community_shop_items WHERE id='goods'").get()?.stock_left, 3, 'retry must not restore the same stock twice');
  assert.throws(() => store.purgeReaderData(live.id, workflow.queueFile), /still exists/);
});

test('SQL failure rolls back content; queued files remain protected until a retry succeeds', async t => {
  const { directory, db, store, workflow, old, at, topic } = await fixture(t);
  const target = topic();
  store.addReply({ topicId: target.id, author: old, body: '回复回复回复', now: at });
  const image = randomUUID();
  db.prepare('INSERT INTO community_images(id,uploader_kind,uploader_id,topic_id,width,height,created_at) VALUES (?,\'reader\',?,?,1,1,?)').run(image, old.id, target.id, at);
  await mkdir(resolve(directory, 'uploads'));
  const file = resolve(directory, 'uploads', `community-image-${image}.webp`);
  await writeFile(file, 'file');
  db.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON community_replies BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END");
  assert.throws(() => store.purgeReaderData(old.id, workflow.queueFile), /injected/);
  assert.ok(store.topic(target.id));
  assert.equal((await cleanReaderFiles({ directory, workflow, payload: {} })).protected, 2);
  await access(file);
  db.exec('DROP TRIGGER fail_cleanup');
  store.purgeReaderData(old.id, workflow.queueFile);
  assert.equal((await cleanReaderFiles({ directory, workflow, payload: {} })).cleaned, 2);
  await assert.rejects(access(file));
});

test('reader deletion failure cannot purge content; persisted follow-up jobs survive cleanup failure', async t => {
  const { directory, db, store, workflow, old, topic } = await fixture(t);
  const target = topic(); db.prepare('INSERT INTO readers VALUES (?)').run(old.id);
  let deleteFails = true, purgeFails = true;
  const payload = {
    findByID: async () => db.prepare('SELECT id FROM readers WHERE id=?').get(old.id) ? { id: old.id } : null,
    delete: async () => { if (deleteFails) throw Error('delete failed'); db.prepare('DELETE FROM readers WHERE id=?').run(old.id); },
  };
  const purgeCommunity = (id: string) => { if (purgeFails) throw Error('purge failed'); return store.purgeReaderData(id, workflow.queueFile); };
  const options = { directory, payload, workflow, uidStore: { get: () => '123456' }, row: { id: old.id }, audit: async () => {}, action: 'auto-delete-inactive', purgeCommunity };
  await assert.rejects(removeReaderAccount(options), /delete failed/);
  assert.ok(store.topic(target.id));
  deleteFails = false;
  await removeReaderAccount(options);
  assert.equal(workflow.cleanupAccounts().length, 1); assert.ok(store.topic(target.id));
  purgeFails = false;
  assert.equal((await resumeReaderCleanup({ directory, payload, workflow, purgeCommunity })).cleaned, 1);
  assert.equal(workflow.cleanupAccounts().length, 0); assert.equal(store.topic(target.id), null);
});

test('pending avatar queue insertion and profile removal roll back together', async t => {
  const { directory, workflow, old } = await fixture(t);
  const avatar = randomUUID(); workflow.putProfile(old.id, 'avatar', avatar);
  const jobs = new DatabaseSync(resolve(directory, 'reader-workflow.db'));
  try {
    jobs.exec("CREATE TRIGGER fail_avatar_queue BEFORE INSERT ON reader_file_cleanup BEGIN SELECT RAISE(ABORT,'queue failure'); END");
    assert.throws(() => workflow.removeProfilesFor(old.id), /queue failure/);
    assert.equal(workflow.profileFor(old.id, 'avatar')?.proposed_value, avatar);
    jobs.exec('DROP TRIGGER fail_avatar_queue');
    workflow.removeProfilesFor(old.id);
    assert.equal(workflow.profileFor(old.id, 'avatar'), null);
    assert.equal(workflow.cleanupFiles()[0].filename, `pending-reader-avatar-${avatar}.webp`);
  } finally { jobs.close(); }
});
