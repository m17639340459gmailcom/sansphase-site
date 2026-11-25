import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createTeahouseStore } from '../server/teahouse-store.ts';
import type { TeahouseActor } from '../src/teahouse-types.ts';

const member: TeahouseActor = { kind: 'reader', id: '1', name: '会员', role: null, vip: true };
const other: TeahouseActor = { ...member, id: '2', name: '另一会员' };
const manager: TeahouseActor = { ...member, id: '3', name: '版主', role: 'moderator', vip: false };
const owner: TeahouseActor = { kind: 'owner', id: '4', name: '作者', role: 'owner', vip: false };
const denied = (status: number) => (error: unknown) => error instanceof Error && 'status' in error && error.status === status;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'teahouse-store-'));
  let now = Date.parse('2026-10-12T00:00:00Z');
  const store = createTeahouseStore({ directory, now: () => now });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, store, advance: (ms: number) => { now += ms; } };
}

test('membership boundary covers managers, VIP assistants and revocation', (t) => {
  const { store } = fixture(t);
  for (const role of ['owner', 'general', 'moderator'] as const) {
    assert.equal(store.readMessages({ ...member, vip: false, role }).messages.length, 0);
  }
  assert.equal(store.readMessages({ ...member, role: 'assistant' }).messages.length, 0);
  for (const role of [null, 'assistant'] as const) {
    const expired = { ...member, vip: false, role };
    assert.throws(() => store.readMessages(expired), denied(403));
    assert.throws(() => store.sendMessage(expired, { id: randomUUID(), text: 'no' }), denied(403));
    assert.throws(() => store.listAnnouncements(expired), denied(403));
  }
});

test('message persistence, idempotency, paging and server timestamps', (t) => {
  const { store, directory } = fixture(t);
  const first = store.sendMessage(member, { id: randomUUID(), text: '第一条' });
  const second = store.sendMessage(member, { id: randomUUID(), text: '第二条' });
  assert.equal(first.createdAt, '2026-10-12T00:00:00.000Z');
  assert.equal(store.sendMessage(member, { id: first.id, text: 'retry' }).text, '第一条');
  assert.throws(() => store.sendMessage(other, { id: first.id, text: 'stolen' }), denied(409));
  const last = store.readMessages(member, { limit: 1 });
  assert.equal(last.messages[0].id, second.id);
  assert.equal(last.hasMore, true);
  const previous = store.readMessages(member, { before: second.seq, limit: 1 });
  assert.equal(previous.messages[0].id, first.id);
  assert.equal(previous.hasMore, false);
  const reopened = createTeahouseStore({ directory });
  try { assert.equal(reopened.readMessages(member).messages.length, 2); }
  finally { reopened.close(); }
});

test('rejects malformed, empty, oversized and excessive-image messages', (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.sendMessage(member, { id: '../bad', text: 'a' }), denied(400));
  assert.throws(() => store.sendMessage(member, { id: randomUUID(), text: '  ' }), denied(400));
  assert.throws(() => store.sendMessage(member, { id: randomUUID(), text: 'a'.repeat(4001) }), denied(400));
  assert.throws(() => store.sendMessage(member, { id: randomUUID(), text: '', attachmentIds: Array.from({ length: 7 }, randomUUID) }), denied(400));
  assert.throws(() => store.readMessages(member, { before: 1, after: 1 }), denied(400));
});

test('attachments are account-bound, single use and transactionally validated', (t) => {
  const { store } = fixture(t);
  const attachment = store.registerAttachment(member, { id: randomUUID(), mime: 'image/webp', size: 10, width: 100, height: 100 });
  assert.throws(() => store.getAttachment(other, attachment.id), denied(404));
  assert.throws(() => store.sendMessage(other, { id: randomUUID(), text: '', attachmentIds: [attachment.id] }), denied(400));
  assert.throws(() => store.sendMessage(member, { id: randomUUID(), text: '', attachmentIds: [attachment.id, randomUUID()] }), denied(400));
  const message = store.sendMessage(member, { id: randomUUID(), text: '', attachmentIds: [attachment.id] });
  assert.equal(message.attachments[0].id, attachment.id);
  assert.equal(store.getAttachment(other, attachment.id).id, attachment.id);
  assert.throws(() => store.sendMessage(member, { id: randomUUID(), text: '', attachmentIds: [attachment.id] }), denied(400));
  assert.throws(() => store.getAttachment({ ...member, vip: false }, attachment.id), denied(403));
});

test('own five-minute recall enforces server time; managers can recall and assistants cannot', (t) => {
  const { store, advance } = fixture(t);
  const first = store.sendMessage(member, { id: randomUUID(), text: 'a' });
  assert.throws(() => store.withdrawMessage(other, first.id), denied(403));
  assert.throws(() => store.withdrawMessage({ ...other, role: 'assistant' }, first.id), denied(403));
  advance(299999);
  assert.equal(store.withdrawMessage(member, first.id).message.withdrawn, true);
  const second = store.sendMessage(member, { id: randomUUID(), text: 'b' });
  advance(300000);
  assert.throws(() => store.withdrawMessage(member, second.id), denied(403));
  assert.equal(store.withdrawMessage(manager, second.id).message.withdrawn, true);
});

test('withdrawal removes body and attachment rows, and replays tombstones without moving original order', (t) => {
  const { store, directory } = fixture(t);
  const attachment = store.registerAttachment(member, { id: randomUUID(), mime: 'image/png', size: 10, width: 10, height: 10 });
  const original = 'UNIQUE-PRIVATE-TEXT-TO-REMOVE-298476';
  const message = store.sendMessage(member, { id: randomUUID(), text: original, attachmentIds: [attachment.id] });
  const later = store.sendMessage(other, { id: randomUUID(), text: 'later' });
  const cursor = store.readMessages(member).cursor;
  const removed = store.withdrawMessage(member, message.id);
  assert.equal(removed.message.seq, message.seq);
  assert.ok(removed.message.revisionSeq > later.revisionSeq);
  assert.equal(removed.message.text, undefined);
  assert.deepEqual(removed.message.attachments, []);
  assert.deepEqual(removed.attachmentIds, [attachment.id]);
  assert.deepEqual(store.pendingFileDeletions(), [attachment.id]);
  assert.throws(() => store.getAttachment(member, attachment.id), denied(404));
  const replay = store.readMessages(member, { after: cursor });
  assert.equal(replay.messages.length, 1);
  assert.equal(replay.messages[0].withdrawn, true);
  assert.equal(store.sendMessage(member, { id: message.id, text: original }).withdrawn, true);
  assert.deepEqual(store.withdrawMessage(member, message.id).attachmentIds, [attachment.id]);
  store.confirmFileDeletion(attachment.id);
  assert.deepEqual(store.pendingFileDeletions(), []);
  assert.equal(readFileSync(join(directory, 'db', 'chat.sqlite')).includes(Buffer.from(original)), false);
});

test('rate limits persist across retry and recall, and do not count idempotent retries', (t) => {
  const { store, advance } = fixture(t);
  let first = '';
  for (let i = 0; i < 20; i++) {
    const message = store.sendMessage(member, { id: randomUUID(), text: String(i) });
    first ||= message.id;
    store.withdrawMessage(member, message.id);
  }
  assert.equal(store.sendMessage(member, { id: first, text: 'retry' }).withdrawn, true);
  assert.throws(() => store.sendMessage(member, { id: randomUUID(), text: '21st' }), denied(429));
  advance(60001);
  assert.ok(store.sendMessage(member, { id: randomUUID(), text: 'later' }));
});

test('replay pagination does not skip old messages withdrawn after a newer cursor', (t) => {
  const { store } = fixture(t);
  const original = store.sendMessage(member, { id: randomUUID(), text: 'original' });
  const startingCursor = store.readMessages(member).cursor;
  const second = store.sendMessage(other, { id: randomUUID(), text: 'second' });
  const third = store.sendMessage(other, { id: randomUUID(), text: 'third' });
  store.withdrawMessage(manager, original.id);
  const page1 = store.readMessages(member, { after: startingCursor, limit: 1 });
  const page2 = store.readMessages(member, { after: page1.cursor, limit: 1 });
  const page3 = store.readMessages(member, { after: page2.cursor, limit: 1 });
  assert.deepEqual([page1.messages[0].id, page2.messages[0].id, page3.messages[0].id], [second.id, third.id, original.id]);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.hasMore, true);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.messages[0].withdrawn, true);
  assert.equal(store.readMessages(member, { after: page3.cursor }).messages.length, 0);
});

test('single-message reads recheck membership and return current tombstones rather than a prior snapshot', (t) => {
  const { store } = fixture(t);
  const attachment = store.registerAttachment(member, { id: randomUUID(), mime: 'image/png', size: 20, width: 20, height: 20 });
  const stale = store.sendMessage(member, { id: randomUUID(), text: 'original', attachmentIds: [attachment.id] });
  assert.equal(store.getMessage(other, stale.id)?.text, 'original');
  assert.equal(store.getMessage(other, randomUUID()), null);
  store.withdrawMessage(manager, stale.id);
  assert.equal(stale.text, 'original');
  const fresh = store.getMessage(other, stale.id)!;
  assert.equal(fresh.withdrawn, true);
  assert.equal(fresh.text, undefined);
  assert.deepEqual(fresh.attachments, []);
  assert.ok(fresh.revisionSeq > stale.revisionSeq);
  assert.throws(() => store.getMessage({ ...other, vip: false }, stale.id), denied(403));
  assert.throws(() => store.getMessage(other, '../bad'), denied(400));
});

test('failed physical attachment deletion can be retried after a store restart', (t) => {
  const { store, directory } = fixture(t);
  const attachment = store.registerAttachment(member, { id: randomUUID(), mime: 'image/png', size: 20, width: 20, height: 20 });
  const message = store.sendMessage(member, { id: randomUUID(), text: 'private', attachmentIds: [attachment.id] });
  store.withdrawMessage(member, message.id);
  store.close();
  const reopened = createTeahouseStore({ directory });
  try {
    assert.deepEqual(reopened.pendingFileDeletions(), [attachment.id]);
    assert.throws(() => reopened.getAttachment(member, attachment.id), denied(404));
    assert.equal(reopened.readMessages(member).messages[0].text, undefined);
    reopened.confirmFileDeletion(attachment.id);
    assert.deepEqual(reopened.pendingFileDeletions(), []);
  } finally { reopened.close(); }
});

test('announcement permissions, revision conflicts and a single pin are enforced', (t) => {
  const { store } = fixture(t);
  for (const actor of [member, { ...member, role: 'assistant' as const }]) {
    assert.throws(() => store.saveAnnouncement(actor, { title: 't', text: 'body' }), denied(403));
  }
  const first = store.saveAnnouncement(manager, { title: '第一条', text: '正文', pinned: true });
  const second = store.saveAnnouncement(owner, { title: '第二条', text: '正文', pinned: true });
  const announcements = store.listAnnouncements(member);
  assert.equal(announcements.filter((a) => a.pinned).length, 1);
  assert.equal(announcements.find((a) => a.pinned)?.id, second.id);
  assert.throws(() => store.saveAnnouncement(manager, { id: second.id, title: 'x', text: 'x', revision: second.revision }), denied(403));
  const current = announcements.find((a) => a.id === first.id)!;
  const edited = store.saveAnnouncement(manager, { id: first.id, title: '改过', text: 'body', revision: current.revision });
  assert.throws(() => store.saveAnnouncement(manager, { id: first.id, title: 'stale', text: 'body', revision: current.revision }), denied(409));
  assert.throws(() => store.deleteAnnouncement(manager, second.id, second.revision), denied(403));
  store.deleteAnnouncement(owner, edited.id, edited.revision);
  assert.equal(store.listAnnouncements(member).length, 1);
});

test('private database uses no WAL and expired unbound attachments are queued for deletion', (t) => {
  const { store, directory, advance } = fixture(t);
  const db = new DatabaseSync(join(directory, 'db', 'chat.sqlite'));
  assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete');
  db.close();
  const attachment = store.registerAttachment(member, { id: randomUUID(), mime: 'image/jpeg', size: 10, width: 10, height: 10 });
  advance(3600001);
  assert.deepEqual(store.pruneUnboundAttachments(), [attachment.id]);
  assert.throws(() => store.getAttachment(member, attachment.id), denied(404));
});
