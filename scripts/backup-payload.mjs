import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import {fileHash} from '../server/file-hash.ts';
const settings = JSON.parse(
  await readFile(
    process.env.PAYLOAD_CONFIG_FILE || ".local/payload-env.json",
    "utf8",
  ),
);
const source = resolve(settings.directory);
const target = resolve(
  process.argv[2] ||
    `.local/backups/payload-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);
await mkdir(target, { recursive: false });
await mkdir(resolve(target, "uploads"));
const db = new DatabaseSync(resolve(source, "content.db"), { readOnly: true });
try {
  await backup(db, resolve(target, "content.db"));
} finally {
  db.close();
}
const snapshot = new DatabaseSync(resolve(target, "content.db"), {
  readOnly: true,
});
let files, readerAvatars = [], communityImages = [];
try {
  files = snapshot.prepare("SELECT filename FROM media").all();
  if (snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='readers'").get())
    readerAvatars = snapshot.prepare("SELECT avatar FROM readers WHERE avatar IS NOT NULL AND avatar <> ''").all();
  // Content, product artwork and custom banner covers share this image store.
  // Only genuinely unreferenced uploads can disappear during normal retention.
  if (snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_images'").get()) {
    const references = ['i.topic_id IS NOT NULL'];
    // A pre-upgrade snapshot may still have the original product table without
    // artwork. Backup must work before migration, not require it to run first.
    if (snapshot.prepare('PRAGMA table_info(community_shop_items)').all().some(column => column.name === 'image'))
      references.push('EXISTS (SELECT 1 FROM community_shop_items item WHERE item.image = i.id)');
    if (snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_banner_entries'").get())
      references.push('EXISTS (SELECT 1 FROM community_banner_entries banner WHERE banner.cover = i.id)');
    communityImages = snapshot.prepare(`SELECT i.id, CASE WHEN ${references.join(' OR ')} THEN 1 ELSE 0 END AS referenced FROM community_images i`).all();
  }
} finally {
  snapshot.close();
}
const paths = ["content.db", "settings.json", "migration-complete.json"];
await writeFile(
  resolve(target, "settings.json"),
  JSON.stringify(settings, null, 2),
  { mode: 0o600 },
);
await copyFile(
  resolve(source, "migration-complete.json"),
  resolve(target, "migration-complete.json"),
);
for (const { filename } of files) {
  if (!filename || basename(filename) !== filename)
    throw Error("Unsafe media filename");
  await copyFile(
    resolve(source, "uploads", filename),
    resolve(target, "uploads", filename),
  );
  paths.push(`uploads/${filename}`);
}
for (const { avatar } of readerAvatars) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(avatar)) continue;
  const filename = `reader-avatar-${avatar}.webp`;
  await copyFile(resolve(source, 'uploads', filename), resolve(target, 'uploads', filename));
  paths.push(`uploads/${filename}`);
}
for (const { id, referenced } of communityImages) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) continue;
  for (const filename of [`community-image-${id}.webp`, `community-thumb-${id}.webp`]) {
    // An unused upload may be swept at any moment; a persisted reference may not.
    try { await copyFile(resolve(source, 'uploads', filename), resolve(target, 'uploads', filename)); }
    catch (error) { if (referenced || error?.code !== 'ENOENT') throw error; continue; }
    paths.push(`uploads/${filename}`);
  }
}
const manifest = {
  provider: "payload",
  createdAt: new Date().toISOString(),
  files: [],
};
for (const path of paths)
  manifest.files.push({
    path,
    sha256: await fileHash(resolve(target,path)),
  });
await writeFile(
  resolve(target, "backup-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Verified backup created: ${target} (${files.length} media files). Contains private settings; keep outside the public website.`,
);
