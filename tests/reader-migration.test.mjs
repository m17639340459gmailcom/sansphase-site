import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getPayload } from 'payload';
import { DatabaseSync } from 'node:sqlite';
import { makePayloadConfig } from '../server/payload/config.ts';
import { migrateReaderAccounts } from '../server/payload/reader-migration.ts';

test('reader migration preserves the existing author database and is idempotent', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-reader-migration-'));
  const secret = randomBytes(48).toString('hex');
  const legacy = makePayloadConfig({ directory, secret, push: true, includeReaders: false });
  let payload;
  try {
    payload = await getPayload({ config: legacy, key: `legacy-${directory}` });
    await payload.create({ collection: 'authors', data: { email: 'owner@example.test', password: 'owner-secret-long', first_name: 'Owner', role: 'owner' } });
    await payload.destroy(); await payload.db.client.close(); payload = undefined;
    await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
    const result = await migrateReaderAccounts(directory);
    assert.equal(result.migrated, true);
    const auditCheck = new DatabaseSync(resolve(directory, 'content.db'));
    assert.equal(auditCheck.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='login_events'").get().name, 'login_events');
    assert.equal(auditCheck.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reader_uids'").get().name, 'reader_uids');
    assert.ok(auditCheck.prepare('PRAGMA table_info(readers)').all().some(row => row.name === 'signature'));
    assert.ok(auditCheck.prepare('PRAGMA table_info(readers)').all().some(row => row.name === 'avatar'));
    auditCheck.close();
    assert.equal((await migrateReaderAccounts(directory)).migrated, false);
    payload = await getPayload({ config: makePayloadConfig({ directory, secret, push: false }), key: `migrated-${directory}` });
    assert.equal((await payload.find({ collection: 'authors' })).docs.length, 1);
    await payload.create({ collection: 'readers', data: { email: 'reader@example.test', password: 'reader-secret-long', nickname: 'Reader', phone: '13800138000' }, disableVerificationEmail: true });
    await payload.create({ collection: 'readers', data: { email: 'later@example.test', password: 'reader-secret-long', nickname: 'Later', phone: '13900139000' }, disableVerificationEmail: true });
    assert.equal((await payload.find({ collection: 'readers' })).docs.length, 2);
    assert.ok((await payload.find({ collection: 'readers' })).docs.some(row => row.phone === '13800138000'));
    await payload.destroy(); await payload.db.client.close(); payload = undefined;
    const db = new DatabaseSync(resolve(directory, 'content.db'));
    try {
      db.exec("UPDATE readers SET created_at='2026-01-01T00:00:00.000Z' WHERE email='reader@example.test'");
      db.exec("UPDATE readers SET created_at='2026-01-02T00:00:00.000Z' WHERE email='later@example.test'");
      db.exec('DROP TRIGGER reader_uids_on_insert; DROP TABLE reader_uids; ALTER TABLE readers DROP COLUMN phone; ALTER TABLE readers DROP COLUMN signature; ALTER TABLE readers DROP COLUMN avatar');
    } finally { db.close(); }
    assert.equal((await migrateReaderAccounts(directory)).reason, 'reader-schema-upgrade');
    assert.equal((await migrateReaderAccounts(directory)).migrated, false);
    const upgradedDb = new DatabaseSync(resolve(directory, 'content.db'));
    assert.deepEqual(upgradedDb.prepare('SELECT r.email, u.uid FROM reader_uids u JOIN readers r ON r.id=u.reader_id ORDER BY u.uid').all().map(row => [row.email, row.uid]), [['reader@example.test', 1], ['later@example.test', 2]]);
    assert.ok(upgradedDb.prepare('PRAGMA table_info(readers)').all().some(row => row.name === 'signature'));
    assert.ok(upgradedDb.prepare('PRAGMA table_info(readers)').all().some(row => row.name === 'avatar'));
    upgradedDb.close();
    payload = await getPayload({ config: makePayloadConfig({ directory, secret, push: false }), key: `upgraded-${directory}` });
    assert.equal((await payload.find({ collection: 'authors' })).docs.length, 1);
    await payload.create({ collection: 'readers', data: { email: 'third@example.test', password: 'reader-secret-long', nickname: 'Third', phone: '13700137000' }, disableVerificationEmail: true });
    const check = new DatabaseSync(resolve(directory, 'content.db'));
    assert.equal(check.prepare("SELECT uid FROM reader_uids JOIN readers ON readers.id=reader_uids.reader_id WHERE readers.email='third@example.test'").get().uid, 3);
    check.close();
  } finally {
    if (payload) { await payload.destroy(); await payload.db.client.close(); }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
