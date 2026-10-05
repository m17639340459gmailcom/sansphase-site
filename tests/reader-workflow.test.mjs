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
    assert.match(request.code, /^\d{6}$/);
    assert.equal(workflow.registrationByCode('reader@example.test', request.id, request.code, start + registrationLifetimeMs - 1)?.password, 'pass-123456');
    assert.equal(workflow.registrationByCode('reader@example.test', request.id, request.code, start + registrationLifetimeMs), null);
    assert.equal(workflow.expiredRegistrations(start + registrationLifetimeMs).length, 1);
    assert.equal(workflow.cleanupRegistrations(start + registrationLifetimeMs)[0].deleted, true);
    assert.equal(workflow.expiredRegistrations(start + registrationLifetimeMs).length, 0);
    const replacement = workflow.putRegistration({ email: 'reader@example.test', nickname: '读者', phone: '13800138000', password: 'new-password' }, start);
    assert.notEqual(replacement.id, request.id);
    assert.equal(workflow.removeRegistration(replacement.id), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('verification codes are email-scoped, limited to five wrong attempts and survive restart without plaintext', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-workflow-code-'));
  try {
    const secret = 'c'.repeat(64), start = Date.now();
    const workflow = createReaderWorkflow(directory, secret);
    const input = { email: 'reader@example.test', nickname: '读者', phone: '13800138000', password: 'pass-123456' };
    const issued = workflow.putRegistration(input, start);
    assert.equal(workflow.registrationByCode('another@example.test', issued.id, issued.code, start), null);
    for (let i = 0; i < 10; i++) assert.equal(workflow.registrationByCode(input.email, 'another-request', issued.code, start), null, 'other browsers cannot verify or exhaust this request');
    const invalid = issued.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) assert.equal(workflow.registrationByCode(input.email, issued.id, invalid, start), null);
    const restarted = createReaderWorkflow(directory, secret);
    assert.equal(restarted.registrationByCode(input.email, issued.id, issued.code, start)?.email, input.email);
    assert.equal(restarted.registrationByCode(input.email, issued.id, invalid, start), null);
    assert.equal(restarted.registrationByCode(input.email, issued.id, issued.code, start), null, 'five errors invalidate even the correct code');
    const replacement = restarted.putRegistration(input, start + 60000);
    assert.equal(restarted.registrationByCode(input.email, replacement.id, issued.code, start + 60000), null, 'resend replaces the prior code');
    assert.equal(restarted.registrationByCode(input.email, replacement.id, replacement.code, start + 60000)?.nickname, input.nickname);
    const db = new DatabaseSync(resolve(directory, 'reader-workflow.db'));
    try {
      const hash = db.prepare('SELECT token_hash FROM reader_registration_requests').get().token_hash;
      assert.notEqual(hash, replacement.code);
      assert.equal(hash.length, 64);
    } finally { db.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('mail cooldown and quotas persist across service restarts', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-workflow-rate-'));
  try {
    const workflow = createReaderWorkflow(directory, 'd'.repeat(64));
    const limits = [{ key: 'email-minute', limit: 1, windowMs: 60000 }, { key: 'email-hour', limit: 3, windowMs: 3600000 }];
    assert.equal(workflow.consumeAuthLimits(limits, 100000), true);
    assert.equal(createReaderWorkflow(directory, 'd'.repeat(64)).consumeAuthLimits(limits, 159999), false);
    assert.equal(workflow.consumeAuthLimits(limits, 160000), true);
    assert.equal(workflow.consumeAuthLimits(limits, 220000), true);
    assert.equal(workflow.consumeAuthLimits(limits, 280000), false);
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
