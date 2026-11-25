import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createTeahouseStore, prepareTeahouseDirectory, teahouseTablesReady } from '../server/teahouse-store.ts';
import type { TeahouseActor } from '../src/teahouse-types.ts';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'teahouse-reader-cleanup-'));
  const store = createTeahouseStore({ directory });
  const old: TeahouseActor = { kind: 'reader', id: randomUUID(), name: 'Private-name-to-remove-23568', avatarUrl: '/private-avatar', role: 'moderator', vip: true };
  const live: TeahouseActor = { kind: 'reader', id: randomUUID(), name: '在用会员', role: null, vip: true };
  const owner: TeahouseActor = { kind: 'owner', id: old.id, name: '独立作者身份', role: 'owner', vip: false };
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, directory, old, live, owner };
}

test('reader purge erases own bodies, profiles, attachments and announcements while preserving other identities', (t) => {
  const { store, directory, old, live, owner } = fixture(t);
  const attached = store.registerAttachment(old, { id: randomUUID(), mime: 'image/webp', size: 10, width: 1, height: 1 });
  const unbound = store.registerAttachment(old, { id: randomUUID(), mime: 'image/webp', size: 10, width: 1, height: 1 });
  const keptAttachment = store.registerAttachment(live, { id: randomUUID(), mime: 'image/webp', size: 10, width: 1, height: 1 });
  const privateText = 'Private-message-to-remove-65432359';
  const message = store.sendMessage(old, { id: randomUUID(), text: privateText, attachmentIds: [attached.id] });
  const withdrawn = store.sendMessage(old, { id: randomUUID(), text: '之前已经撤回' });
  store.withdrawMessage(old, withdrawn.id);
  const kept = store.sendMessage(live, { id: randomUUID(), text: '保留其他会员历史', attachmentIds: [keptAttachment.id] });
  const ownerMessage = store.sendMessage(owner, { id: randomUUID(), text: '保留作者独立身份' });
  store.saveAnnouncement(old, { title: 'Private-title-to-remove', text: 'Private-announcement-to-remove', pinned: true });
  const keptAnnouncement = store.saveAnnouncement(owner, { title: '保留作者公告', text: '公告正文' });
  const cursor = store.readMessages(live).cursor;
  const result = store.purgeReaderData(old.id);
  assert.equal(result.messages, 2);
  assert.equal(result.announcements, 1);
  assert.equal(result.attachments, 2);
  assert.equal(store.readerDeleted(old.id), true);
  for (const id of [message.id, withdrawn.id]) {
    const current = store.getMessage(live, id)!;
    assert.equal(current.withdrawn, true);
    assert.equal(current.text, undefined);
    assert.equal(current.author.name, '已注销用户');
    assert.equal(current.author.avatarUrl, undefined);
    assert.deepEqual(current.attachments, []);
    assert.ok(current.revisionSeq > cursor);
  }
  assert.deepEqual(store.readMessages(live, { after: cursor }).messages.map((row) => row.id), [message.id, withdrawn.id]);
  assert.equal(store.getMessage(live, kept.id)?.text, '保留其他会员历史');
  assert.equal(store.getMessage(live, ownerMessage.id)?.text, '保留作者独立身份');
  assert.equal(store.getAttachment(live, keptAttachment.id).id, keptAttachment.id);
  assert.deepEqual(store.listAnnouncements(live).map((item) => item.id), [keptAnnouncement.id]);
  assert.deepEqual(new Set(store.pendingFileDeletions()), new Set([attached.id, unbound.id]));
  const bytes = readFileSync(join(directory, 'db', 'chat.sqlite'));
  for (const text of [privateText, old.name, 'Private-title-to-remove', 'Private-announcement-to-remove']) assert.equal(bytes.includes(Buffer.from(text)), false);
});

test('reader purge is idempotent, survives restart, and rejects a stale trusted actor before any write', (t) => {
  const { store, directory, old, live } = fixture(t);
  const attachment = store.registerAttachment(old, { id: randomUUID(), mime: 'image/webp', size: 10, width: 1, height: 1 });
  const message = store.sendMessage(old, { id: randomUUID(), text: '被删除账号原文', attachmentIds: [attachment.id] });
  store.purgeReaderData(old.id);
  const cursor = store.readMessages(live).cursor;
  assert.deepEqual(store.purgeReaderData(old.id), { messages: 0, attachments: 0, announcements: 0 });
  assert.equal(store.readMessages(live).cursor, cursor);
  assert.deepEqual(store.pendingFileDeletions(), [attachment.id]);
  const unauthorized = (error: unknown) => error instanceof Error && 'status' in error && error.status === 401;
  assert.throws(() => store.sendMessage(old, { id: randomUUID(), text: 'stale' }), unauthorized);
  assert.throws(() => store.sendMessage(old, { id: message.id, text: 'retry' }), unauthorized);
  assert.throws(() => store.readMessages(old), unauthorized);
  assert.throws(() => store.saveAnnouncement(old, { title: 'stale', text: 'stale' }), unauthorized);
  assert.throws(() => store.registerAttachment(old, { id: randomUUID(), mime: 'image/webp', size: 10, width: 1, height: 1 }), unauthorized);
  store.close();
  const reopened = createTeahouseStore({ directory });
  try {
    assert.equal(reopened.readerDeleted(old.id), true);
    assert.throws(() => reopened.sendMessage(old, { id: randomUUID(), text: 'stale' }), unauthorized);
    assert.deepEqual(reopened.pendingFileDeletions(), [attachment.id]);
  } finally { reopened.close(); }
});

test('a failed cleanup transaction preserves all content until a successful retry', (t) => {
  const { store, directory, old, live } = fixture(t);
  const attachment = store.registerAttachment(old, { id: randomUUID(), mime: 'image/webp', size: 10, width: 1, height: 1 });
  const message = store.sendMessage(old, { id: randomUUID(), text: '仍待清理', attachmentIds: [attachment.id] });
  const db = new DatabaseSync(join(directory, 'db', 'chat.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_cleanup BEFORE UPDATE ON teahouse_messages BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END");
    assert.throws(() => store.purgeReaderData(old.id), /injected cleanup failure/);
    assert.equal(store.getMessage(live, message.id)?.text, '仍待清理');
    assert.equal(store.getAttachment(live, attachment.id).id, attachment.id);
    assert.deepEqual(store.pendingFileDeletions(), []);
    assert.equal(store.readerDeleted(old.id), false);
    db.exec('DROP TRIGGER fail_cleanup');
    assert.equal(store.purgeReaderData(old.id).messages, 1);
    assert.equal(store.getMessage(live, message.id)?.withdrawn, true);
  } finally { db.close(); }
});

test('production open requires explicit preparation and rejects symlinked database directories', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'teahouse-prepare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'chat');
  assert.equal(teahouseTablesReady(directory), false);
  assert.throws(() => createTeahouseStore({ directory, requirePrepared: true }), /prepar/i);
  assert.equal(existsSync(directory), false);
  prepareTeahouseDirectory(directory);
  assert.equal(teahouseTablesReady(directory), true);
  const store = createTeahouseStore({ directory, requirePrepared: true });
  store.close();
  const external = join(root, 'protected');
  const linked = join(root, 'linked-chat');
  mkdirSync(external); mkdirSync(linked);
  symlinkSync(external, join(linked, 'db'), 'junction');
  assert.equal(teahouseTablesReady(linked), false);
  assert.throws(() => createTeahouseStore({ directory: linked }), /symlink|regular|directory/i);
  assert.equal(existsSync(join(external, 'chat.sqlite')), false);
});
