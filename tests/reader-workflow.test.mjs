import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createReaderWorkflow, registrationLifetimeMs } from '../server/reader-workflow.ts';

test('pending registration is separate, expires after five minutes, and does not retain plaintext password', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-workflow-'));
  try {
    const workflow = createReaderWorkflow(directory, 'a'.repeat(64));
    const start = Date.parse('2026-09-26T00:00:00Z');
    const request = workflow.putRegistration({ email: 'reader@example.test', nickname: '读者', phone: '13800138000', password: 'pass-123456' }, start);
    const db = new DatabaseSync(resolve(directory, 'reader-workflow.db'));
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE name=?').get('readers').count, 0);
      assert.doesNotMatch(db.prepare('SELECT password_cipher FROM reader_registration_requests').get().password_cipher, /pass-123456/);
    } finally { db.close(); }
    assert.equal(workflow.registrationByToken(request.token, start + registrationLifetimeMs - 1)?.password, 'pass-123456');
    assert.equal(workflow.registrationByToken(request.token, start + registrationLifetimeMs), null);
    assert.equal(workflow.expiredRegistrations(start + registrationLifetimeMs).length, 1);
    assert.equal(workflow.cleanupRegistrations(start + registrationLifetimeMs)[0].deleted, true);
    assert.equal(workflow.expiredRegistrations(start + registrationLifetimeMs).length, 0);
    const replacement = workflow.putRegistration({ email: 'reader@example.test', nickname: '读者', phone: '13800138000', password: 'new-password' }, start);
    assert.notEqual(replacement.token, request.token);
    assert.equal(workflow.registrationByToken(request.token, start), null);
    assert.equal(workflow.removeRegistration(replacement.id), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('profile review replaces only the same reader and kind; cleanup queue is idempotent', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-workflow-'));
  try {
    const workflow = createReaderWorkflow(directory, 'b'.repeat(64));
    const first = workflow.putProfile('reader-1', 'signature', 'hello');
    const next = workflow.putProfile('reader-1', 'signature', 'world');
    assert.equal(next.previous.id, first.id);
    assert.equal(workflow.profiles().length, 1);
    assert.equal(workflow.profile(first.id), null);
    assert.equal(workflow.profile(next.id).proposed_value, 'world');
    workflow.queueFile(`reader-avatar-${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}.webp`, 'replaced');
    workflow.queueFile(`reader-avatar-${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}.webp`, 'replaced');
    assert.equal(workflow.cleanupFiles().length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
