import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateCommunity } from "../server/payload/community-migration.ts";
import { communityTablesReady } from "../server/community-store.ts";

// Kept in its own file (its own process): under the test runner, node:sqlite's
// backup() stalls for about 30 s when it follows an "already migrated" call in
// the same process. One migration per process, as in production, is unaffected.
async function workspace(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "sansphase-community-"));
  const db = new DatabaseSync(resolve(directory, "content.db"));
  db.exec("CREATE TABLE readers (id TEXT PRIMARY KEY)");
  db.close();
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return directory;
}

test("the community migration backs up content.db once and is idempotent", async (t) => {
  const directory = await workspace(t);
  assert.equal(communityTablesReady(directory), false);
  const first = await migrateCommunity(directory);
  assert.equal(first.changed, true);
  assert.match(first.backup, /schema-backups[\\/]before-community-/);
  assert.equal((await readdir(resolve(directory, "schema-backups"))).length, 1);
  assert.equal(communityTablesReady(directory), true);
  const second = await migrateCommunity(directory);
  assert.deepEqual(second, { changed: false });
  assert.equal((await readdir(resolve(directory, "schema-backups"))).length, 1, "no second backup");
});
