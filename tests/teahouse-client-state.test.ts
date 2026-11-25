import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMessages, mayWithdraw, mayEditAnnouncement, createPendingSend } from '../src/teahouse/client-state.ts';
import type { TeahouseActor, TeahouseMessage, TeahouseAnnouncement } from '../src/teahouse-types.ts';

const member: TeahouseActor = { kind: 'reader', id: 'a', name: '会员', role: null, vip: true };
const message: TeahouseMessage = { id: 'm', seq: 1, revisionSeq: 1, author: member, createdAt: '2026-10-12T00:00:00.000Z', withdrawn: false, text: '原文', attachments: [] };
test('socket delivery plus HTTP replay never duplicates a message', () => {
  const state = new Map<string, TeahouseMessage>();
  assert.equal(mergeMessages(state, [message]).length, 1);
  assert.equal(mergeMessages(state, [message]).length, 0);
  assert.equal(state.size, 1);
});
test('withdrawal arriving before old history prevents original content resurrection', () => {
  const state = new Map<string, TeahouseMessage>();
  mergeMessages(state, [{ ...message, revisionSeq: 3, withdrawn: true, text: undefined }]);
  mergeMessages(state, [message]);
  assert.equal(state.get('m')?.withdrawn, true);
  assert.equal(state.get('m')?.text, undefined);
});
test('same-revision messages refresh current author identity without replacing content', () => {
  const state = new Map<string, TeahouseMessage>();
  mergeMessages(state, [message]);
  const updated = { ...message, text: '不应覆盖原文', author: { ...member, name: '新昵称', icon: 'vip:3' as const } };
  assert.equal(mergeMessages(state, [updated]).length, 1);
  assert.equal(state.get('m')?.author.name, '新昵称');
  assert.equal(state.get('m')?.author.icon, 'vip:3');
  assert.equal(state.get('m')?.text, '原文');
});
test('withdrawal wins a defensive equal-revision merge and cannot be reversed', () => {
  const state = new Map<string, TeahouseMessage>();
  mergeMessages(state, [message]);
  mergeMessages(state, [{ ...message, withdrawn: true, text: undefined }]);
  mergeMessages(state, [{ ...message, revisionSeq: 20 }]);
  assert.equal(state.get('m')?.withdrawn, true);
});
test('same draft retry reuses UUID; edited draft gets another UUID', () => {
  let next = 0;
  const uuid = () => `id-${++next}`;
  const first = createPendingSend(undefined, 'hello', ['pic'], uuid);
  assert.equal(createPendingSend(first, 'hello', ['pic'], uuid).id, first.id);
  assert.notEqual(createPendingSend(first, 'changed', ['pic'], uuid).id, first.id);
});
test('only author can withdraw within five minutes unless a real manager', () => {
  const time = Date.parse(message.createdAt);
  assert.equal(mayWithdraw(member, message, time + 299999), true);
  assert.equal(mayWithdraw(member, message, time + 300000), false);
  assert.equal(mayWithdraw({ ...member, id: 'b', role: 'assistant' }, message, time), false);
  assert.equal(mayWithdraw({ ...member, id: 'b', role: 'moderator' }, message, time + 999999), true);
});
test('moderators edit own announcements; general and owner can edit all; assistant cannot', () => {
  const announcement: TeahouseAnnouncement = { id: 'n', title: '标题', text: '内容', author: member, createdAt: message.createdAt, updatedAt: message.createdAt, revision: 1, pinned: false };
  assert.equal(mayEditAnnouncement({ ...member, role: 'moderator' }, announcement), true);
  assert.equal(mayEditAnnouncement({ ...member, id: 'b', role: 'moderator' }, announcement), false);
  assert.equal(mayEditAnnouncement({ ...member, id: 'b', role: 'general' }, announcement), true);
  assert.equal(mayEditAnnouncement({ ...member, role: 'assistant' }, announcement), false);
});
test('reader deletion erases loaded message identity, text and pictures', () => {
  const state = new Map<string, TeahouseMessage>();
  mergeMessages(state, [message]);
  const purged = new Set([member.id]);
  mergeMessages(state, [message], purged);
  assert.equal(state.get(message.id)?.withdrawn, true);
  assert.equal(state.get(message.id)?.text, undefined);
  assert.deepEqual(state.get(message.id)?.attachments, []);
  assert.deepEqual(state.get(message.id)?.author, { kind: 'reader', id: member.id, name: '已注销用户', icon: null });
});
test('reader deletion precedes an in-flight history response for an unseen message', () => {
  const state = new Map<string, TeahouseMessage>();
  mergeMessages(state, [message], new Set([member.id]));
  assert.equal(state.get(message.id)?.withdrawn, true);
  assert.equal(state.get(message.id)?.text, undefined);
  assert.equal(state.get(message.id)?.author.name, '已注销用户');
});
