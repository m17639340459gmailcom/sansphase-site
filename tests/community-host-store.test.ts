import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCommunityHostStore, prepareCommunityHostDirectory } from '../server/community-host-store.ts';

let template: string;
test.before(async () => {
  template = await mkdtemp(resolve(tmpdir(), 'sansphase-host-template-'));
  await prepareCommunityHostDirectory(template);
});
test.after(() => rm(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
async function prepared() {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-host-'));
  await copyFile(resolve(template, 'content.db'), resolve(directory, 'content.db'));
  await copyFile(resolve(template, 'community-host.db'), resolve(directory, 'community-host.db'));
  await mkdir(resolve(directory, 'uploads'));
  return directory;
}

test('host storage is explicitly prepared and contains no reader or password database', async t => {
  const directory = await prepared();
  const db = new DatabaseSync(resolve(directory, 'content.db'), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('readers','authors')").get()?.count, 0);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='community_topics'").get());
  } finally { db.close(); }
  const store = createCommunityHostStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  store.healthCheck();
});

test('opaque host sessions survive a week of inactivity and restart without exceeding the fixed login lifetime', async t => {
  const directory = await prepared();
  let store = createCommunityHostStore(directory);
  const created = 1_000_000;
  const token = store.createSession('remote-reference', { kind: 'reader', id: 'r1' }, created);
  assert.equal(store.session(token, created)?.sessionRef, 'remote-reference');
  store.close();
  store = createCommunityHostStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const db = new DatabaseSync(resolve(directory, 'community-host.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT token_hash FROM community_host_sessions').get()?.token_hash, store.tokenHash(token)); }
  finally { db.close(); }
  const week = 7 * 24 * 60 * 60_000;
  assert.ok(store.session(token, created + 31 * 60_000), 'reading without requests for half an hour must not log the user out');
  assert.ok(store.session(token, created + week - 1), 'the persistent login remains usable without a keepalive');
  assert.equal(store.session(token, created + week), null);
  const continuous = store.createSession('remote-reference-2', { kind: 'reader', id: 'r2' }, created);
  for (let day = 1; day < 7; day++) {
    const now = created + day * 24 * 60 * 60_000;
    assert.ok(store.session(continuous, now));
    store.touchSession(continuous, now);
  }
  assert.equal(store.session(continuous, created + week), null, 'active use cannot turn a fixed seven-day login into an unlimited session');
});

test('replay prevention survives restart and revoked reader sessions cannot be reused', async t => {
  const directory = await prepared();
  let store = createCommunityHostStore(directory);
  const token = store.createSession('remote-reference', { kind: 'reader', id: 'r1' });
  assert.equal(store.consumeNonce('nonce-one', Date.now() + 60_000), true);
  store.close();
  store = createCommunityHostStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  assert.equal(store.consumeNonce('nonce-one', Date.now() + 60_000), false);
  store.revokeReader('r1');
  assert.equal(store.session(token), null);
});

test('explicit host session upgrade preserves only still-valid legacy logins and is idempotent', async t => {
  const directory = await prepared();
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const originalContent = await readFile(resolve(directory, 'content.db'));
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const week = 7 * 24 * 60 * 60_000, minute = 60_000;
  const rows = [
    { token: 'a'.repeat(43), created: now - 60 * minute, touched: now - 10 * minute },
    { token: 'b'.repeat(43), created: now - 60 * minute, touched: now - 30 * minute },
    { token: 'c'.repeat(43), created: now - 12 * 60 * minute, touched: now - minute },
    { token: 'd'.repeat(43), created: now + minute, touched: now + minute },
  ];
  const db = new DatabaseSync(resolve(directory, 'community-host.db'));
  try {
    db.exec(`DROP TABLE community_host_sessions; DROP TABLE community_host_session_lifetimes;
      CREATE TABLE community_host_sessions(token_hash TEXT PRIMARY KEY,session_ref TEXT NOT NULL,subject_kind TEXT NOT NULL,subject_id TEXT NOT NULL,created_at INTEGER NOT NULL,touched_at INTEGER NOT NULL);`);
    const insert = db.prepare('INSERT INTO community_host_sessions VALUES(?,?,?,?,?,?)');
    for (const row of rows) insert.run(createHash('sha256').update(row.token).digest('hex'), 'legacy-ref', 'reader', 'legacy-reader', row.created, row.touched);
  } finally { db.close(); }
  assert.throws(() => createCommunityHostStore(directory), /preparation/i, 'normal startup cannot silently upgrade persistent storage');
  await prepareCommunityHostDirectory(directory);
  let store = createCommunityHostStore(directory);
  try {
    assert.equal(store.session(rows[0].token)?.expiresAt, rows[0].created + week);
    for (const row of rows.slice(1)) assert.equal(store.session(row.token), null, 'expired and future-dated legacy rows must not become new logins');
    store.revokeSession(rows[0].token);
  } finally { store.close(); }
  now += minute;
  await prepareCommunityHostDirectory(directory);
  store = createCommunityHostStore(directory);
  try {
    for (const row of rows) assert.equal(store.session(row.token), null, 'preparation must never recreate a revoked session');
    const fresh = store.createSession('new-reference', { kind: 'reader', id: 'fresh-reader' });
    assert.equal(store.session(fresh)?.expiresAt, now + week);
    store.close();
    await prepareCommunityHostDirectory(directory);
    store = createCommunityHostStore(directory);
    assert.equal(store.session(fresh)?.expiresAt, now + week, 'repeated preparation never rolls the deadline forward');
  } finally { store.close(); }
  const rollback = new DatabaseSync(resolve(directory, 'community-host.db'));
  const rollbackToken = 'e'.repeat(43), rollbackHash = createHash('sha256').update(rollbackToken).digest('hex');
  try {
    assert.equal(rollback.prepare('PRAGMA table_info(community_host_sessions)').all().length, 6, 'the original runtime keeps its six-column INSERT contract');
    rollback.prepare('INSERT INTO community_host_sessions VALUES(?,?,?,?,?,?)').run(rollbackHash, 'rollback-ref', 'reader', 'rollback-reader', now, now);
    assert.ok(rollback.prepare('SELECT * FROM community_host_sessions WHERE token_hash=?').get(rollbackHash));
  } finally { rollback.close(); }
  await prepareCommunityHostDirectory(directory);
  store = createCommunityHostStore(directory);
  try { assert.equal(store.session(rollbackToken)?.expiresAt, now + week, 'still-valid sessions written by a rollback are adopted by the next explicit preparation'); }
  finally { store.close(); }
  const revokeAfterRollback = new DatabaseSync(resolve(directory, 'community-host.db'));
  try {
    revokeAfterRollback.prepare('DELETE FROM community_host_sessions WHERE token_hash=?').run(rollbackHash);
    assert.equal(revokeAfterRollback.prepare('SELECT 1 FROM community_host_session_lifetimes WHERE token_hash=?').get(rollbackHash), undefined, 'old runtime revocation also deletes its lifetime metadata');
  } finally { revokeAfterRollback.close(); }
  await prepareCommunityHostDirectory(directory);
  store = createCommunityHostStore(directory);
  try { assert.equal(store.session(rollbackToken), null); } finally { store.close(); }
  assert.deepEqual(await readFile(resolve(directory, 'content.db')), originalContent, 'the login upgrade must not modify community content');
});

test('file removal queue rejects unknown files and persists retry candidates', async t => {
  const directory = await prepared();
  let store = createCommunityHostStore(directory);
  const image = 'community-image-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
  assert.throws(() => store.queueFile('../content.db', 'bad'), /filename/i);
  assert.throws(() => store.queueFile('unknown.webp', 'bad'), /filename/i);
  store.queueFile(image, 'reader-deleted');
  store.close();
  store = createCommunityHostStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  assert.equal(store.fileQueue()[0]?.filename, image);
  store.completeFile(image);
  assert.deepEqual(store.fileQueue(), []);
});

test('deleted-reader tombstones survive restarts and reject later session creation', async t => {
  const directory = await prepared();
  let store = createCommunityHostStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const token = store.createSession('remote-reference', { kind: 'reader', id: 'removed-reader' });
  store.markReaderDeleted('removed-reader'); store.close();
  store = createCommunityHostStore(directory);
  assert.equal(store.session(token), null);
  assert.equal(store.readerDeleted('removed-reader'), true);
  assert.throws(() => store.createSession('new-ref', { kind: 'reader', id: 'removed-reader' }), { status: 401 });
});
