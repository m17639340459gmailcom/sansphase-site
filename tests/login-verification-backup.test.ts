import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshotLoginVerification, rotateRestoredLoginVerificationKeys } from '../server/login-verification-backup.ts';

test('login proof state backups are optional and copy a consistent private SQLite snapshot', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'login-verification-backup-'));
  const source = resolve(directory, 'source'), target = resolve(directory, 'target');
  await mkdir(source); await mkdir(target);
  try {
    assert.equal(await snapshotLoginVerification(source, target), false);
    const db = new DatabaseSync(resolve(source, 'login-verification.db'));
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE login_verification_used(nonce_hash TEXT PRIMARY KEY NOT NULL CHECK(length(nonce_hash)=64), expires_at INTEGER NOT NULL)');
    db.prepare('INSERT INTO login_verification_used VALUES(?,?)').run('a'.repeat(64), 123456);
    assert.equal(await snapshotLoginVerification(source, target), true);
    if (process.platform !== 'win32') assert.equal((await stat(resolve(target, 'login-verification.db'))).mode & 0o777, 0o600);
    const copy = new DatabaseSync(resolve(target, 'login-verification.db'), { readOnly: true });
    try { assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM login_verification_used').get()?.n, 1); }
    finally { copy.close(); db.close(); }
    await assert.rejects(snapshotLoginVerification(source, target), /exist|already|已有/i);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test('restoring enabled verification rotates only ephemeral proof keys and preserves accounts configuration', () => {
  const config = { secret: 'p'.repeat(48), directory: '/private/payload', authorId: 'synthetic-owner',
    loginVerification: { enabled: true, engine: 'tianai', serviceOrigin: 'http://127.0.0.1:4253', serviceSecret: 's'.repeat(48), hmacSecret: 'h'.repeat(48), keySecret: 'k'.repeat(48) } };
  const restored = rotateRestoredLoginVerificationKeys(config);
  assert.equal(restored.secret, config.secret); assert.equal(restored.authorId, config.authorId);
  assert.equal(restored.directory, config.directory);
  assert.equal(restored.loginVerification.serviceSecret, config.loginVerification.serviceSecret);
  assert.equal(restored.loginVerification.serviceOrigin, config.loginVerification.serviceOrigin);
  assert.notEqual(restored.loginVerification.hmacSecret, config.loginVerification.hmacSecret);
  assert.notEqual(restored.loginVerification.keySecret, config.loginVerification.keySecret);
  assert.notEqual(restored.loginVerification.keySecret, restored.loginVerification.hmacSecret);
  assert.equal(config.loginVerification.hmacSecret, 'h'.repeat(48), 'does not mutate original backup settings');
  assert.equal(rotateRestoredLoginVerificationKeys({ secret: 'p'.repeat(48) }).secret, 'p'.repeat(48));
  assert.deepEqual(rotateRestoredLoginVerificationKeys({ loginVerification: { enabled: false } }), { loginVerification: { enabled: false } });
});

test('login proof backup rejects symbolic links', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'login-verification-link-'));
  const source = resolve(directory, 'source'), target = resolve(directory, 'target');
  await mkdir(source); await mkdir(target);
  const db = new DatabaseSync(resolve(directory, 'elsewhere.db'));
  db.close();
  try {
    try { await symlink(resolve(directory, 'elsewhere.db'), resolve(source, 'login-verification.db')); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EPERM') { t.skip('symlinks unavailable on this Windows host'); return; } throw error; }
    await assert.rejects(snapshotLoginVerification(source, target), /regular|symbolic|私有/);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
