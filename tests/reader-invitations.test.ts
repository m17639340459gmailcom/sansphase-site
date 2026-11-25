import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createReaderInvitations } from '../server/reader-invitations.ts';
import { assertReaderInvitationsReady, migrateReaderInvitations } from '../server/payload/invitation-migration.ts';

const inviter = '11111111-1111-4111-8111-111111111111';
const invitee = '22222222-2222-4222-8222-222222222222';
async function setup(t: test.TestContext) {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-invitations-'));
  await writeFile(resolve(directory, 'migration-complete.json'), JSON.stringify({ provider: 'payload' }));
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec("CREATE TABLE readers(id TEXT PRIMARY KEY, _verified INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL); INSERT INTO readers VALUES('11111111-1111-4111-8111-111111111111',1,0,'2026-10-01T00:00:00Z')");
  const opened: Array<ReturnType<typeof createReaderInvitations>> = [];
  t.after(async () => { opened.forEach(store => store.close()); db.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { directory, db, open: () => { const store = createReaderInvitations({ directory }); opened.push(store); return store; } };
}

test('invitation startup is read-only and requires an explicit backed-up migration', async t => {
  const { directory, db } = await setup(t);
  assert.throws(() => assertReaderInvitationsReady(directory), /migration/i);
  assert.equal(db.prepare('PRAGMA table_info(readers)').all().length, 4);
  const result = await migrateReaderInvitations(directory);
  assert.equal(result.migrated, true); assert.ok(result.backupPath);
  const backup = new DatabaseSync(result.backupPath!, { readOnly: true });
  try { assert.equal(backup.prepare('PRAGMA table_info(readers)').all().length, 4); } finally { backup.close(); }
  assertReaderInvitationsReady(directory);
  assert.equal((await migrateReaderInvitations(directory)).migrated, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM readers').get()!.n, 1);
});

test('codes are fixed, unique, confidential and resolve only for current active readers', async t => {
  const { directory, db, open } = await setup(t); await migrateReaderInvitations(directory);
  const invitations = open();
  const one = invitations.self(inviter), two = invitations.self(inviter);
  assert.match(one.code, /^[A-Za-z0-9_-]{24}$/); assert.equal(two.code, one.code);
  assert.equal(invitations.resolveCode(one.code), inviter);
  invitations.assertActive([inviter]);
  for (const code of ['../../secret', [one.code], one.code + '&inviter=other', '']) assert.equal(invitations.resolveCode(code), null);
  assert.deepEqual(Object.keys(one).sort(), ['code', 'invitees', 'readerId']);
  db.prepare('UPDATE readers SET disabled=1 WHERE id=?').run(inviter);
  assert.equal(invitations.resolveCode(one.code), null);
  assert.throws(() => invitations.assertActive([inviter]), /失效/);
  assert.throws(() => invitations.self(inviter), /不可用/);
});

test('schema readiness rejects partial or composite uniqueness', async t => {
  const { directory, db } = await setup(t); await migrateReaderInvitations(directory);
  db.exec('DROP INDEX readers_invitation_code_idx; CREATE UNIQUE INDEX wrong_invite_index ON readers(invitation_code,id)');
  assert.throws(() => assertReaderInvitationsReady(directory), /unique invitation code/);
  db.exec('DROP INDEX wrong_invite_index; CREATE UNIQUE INDEX wrong_invite_index ON readers(invitation_code) WHERE disabled=0');
  assert.throws(() => assertReaderInvitationsReady(directory), /unique invitation code/);
  await migrateReaderInvitations(directory); assertReaderInvitationsReady(directory);
});

test('migration refuses an incompatible existing invitation column without changing it', async t => {
  const { directory, db } = await setup(t);
  db.exec('ALTER TABLE readers ADD COLUMN invitation_code INTEGER');
  await assert.rejects(migrateReaderInvitations(directory), /Unexpected reader invitation column/);
  assert.equal(db.prepare('PRAGMA table_info(readers)').all().find(row => row.name === 'invitation_code')?.type, 'INTEGER');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM readers').get()!.n, 1);
});

test('new-account fields atomically retain the binding, and attribution requires both active accounts', async t => {
  const { directory, db, open } = await setup(t); await migrateReaderInvitations(directory);
  const invitations = open();
  const fields = invitations.registrationFields(inviter, true);
  assert.equal(fields.invited_by, inviter); assert.equal(fields.invitation_bound, true);
  db.prepare('INSERT INTO readers(id,_verified,disabled,created_at,invitation_code,invited_by,invitation_bound) VALUES(?,1,0,?,?,?,1)')
    .run(invitee, '2026-10-11T00:00:00Z', fields.invitation_code, fields.invited_by);
  assert.deepEqual(invitations.attribution(invitee), { inviter: { kind: 'reader', id: inviter }, registeredAt: '2026-10-11T00:00:00.000Z' });
  assert.deepEqual(invitations.self(inviter).invitees, [{ readerId: invitee, registeredAt: '2026-10-11T00:00:00.000Z' }]);
  db.prepare('UPDATE readers SET disabled=1 WHERE id=?').run(invitee); assert.equal(invitations.attribution(invitee), null);
  assert.deepEqual(invitations.self(inviter).invitees, [], 'one disabled invitee must not prevent an inviter opening their panel');
  db.prepare('UPDATE readers SET disabled=0 WHERE id=?').run(invitee);
  db.prepare('UPDATE readers SET disabled=1 WHERE id=?').run(inviter); assert.equal(invitations.attribution(invitee), null);
  const invalidated = invitations.registrationFields(inviter, true);
  assert.equal(invalidated.invited_by, null); assert.equal(invalidated.invitation_bound, true);
});

test('deleted inviter codes are revoked and existing invitees retain an irreversible binding marker', async t => {
  const { directory, db, open } = await setup(t); await migrateReaderInvitations(directory);
  const invitations = open();
  const code = invitations.self(inviter).code;
  db.prepare('INSERT INTO readers(id,_verified,disabled,created_at,invited_by,invitation_bound) VALUES(?,1,0,?,?,1)').run(invitee, '2026-10-11T00:00:00Z', inviter);
  assert.throws(() => invitations.purge(inviter), /仍然存在/);
  db.prepare('DELETE FROM readers WHERE id=?').run(inviter); invitations.purge(inviter); invitations.purge(inviter);
  assert.equal(invitations.resolveCode(code), null); assert.equal(invitations.attribution(invitee), null);
  assert.deepEqual({ ...db.prepare('SELECT invited_by,invitation_bound FROM readers WHERE id=?').get(invitee) }, { invited_by: null, invitation_bound: 1 });
});

test('inviter summaries remain bounded to the latest 100 registrations', async t => {
  const { directory, db, open } = await setup(t); await migrateReaderInvitations(directory);
  const invitations = open();
  const add = db.prepare('INSERT INTO readers(id,_verified,disabled,created_at,invited_by,invitation_bound) VALUES(?,1,0,?,?,1)');
  for (let i = 0; i < 105; i++) add.run(`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`, new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), inviter);
  const result = invitations.self(inviter);
  assert.equal(result.invitees.length, 100);
  assert.equal(result.invitees[0].readerId, '22222222-2222-4222-8222-000000000104');
  assert.equal(result.invitees.at(-1)!.readerId, '22222222-2222-4222-8222-000000000005');
});
