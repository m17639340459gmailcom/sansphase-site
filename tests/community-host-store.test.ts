import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
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

test('opaque host sessions persist hashed tokens and enforce idle and maximum lifetime', async t => {
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
  assert.ok(store.session(token, created + 29 * 60_000));
  assert.equal(store.session(token, created + 30 * 60_000), null);
  const continuous = store.createSession('remote-reference-2', { kind: 'reader', id: 'r2' }, created);
  for (let hour = 1; hour < 24; hour++) {
    const now = created + hour * 29 * 60_000;
    assert.ok(store.session(continuous, now));
    store.touchSession(continuous, now);
  }
  assert.equal(store.session(continuous, created + 12 * 60 * 60_000), null);
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
