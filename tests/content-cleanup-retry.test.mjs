import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createMediaRetention } from '../server/payload/media-retention.mjs';

test('a failed historical-version cleanup defers media deletion until a successful retry', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sansphase-content-cleanup-'));
  const parent = randomUUID(), mediaId = randomUUID();
  let versionFailure = true, mediaExists = true;
  const payload = {
    find: async ({ collection }) => ({ docs: collection === 'media' && mediaExists ? [{ id: mediaId, filename: 'cover.webp' }] : [] }),
    findVersions: async () => ({ totalDocs: 0 }),
    db: { deleteVersions: async () => { if (versionFailure) throw Error('temporary database failure'); } },
    delete: async () => { mediaExists = false; },
  };
  try {
    const retention = createMediaRetention({ payload, directory });
    retention.queueVersions('articles', parent);
    await retention.queueFromDeleted({ cover: mediaId });
    assert.equal((await retention.sweep()).deferred, true);
    assert.equal(retention.versions().length, 1);
    assert.equal(retention.list().length, 1);
    assert.equal(mediaExists, true);
    versionFailure = false;
    const cleaned = await retention.sweep();
    assert.equal(cleaned.cleaned, 1);
    assert.equal(retention.versions().length, 0);
    assert.equal(retention.list().length, 0);
    assert.equal(mediaExists, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
