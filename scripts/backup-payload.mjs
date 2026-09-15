import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import {fileHash} from '../server/file-hash.mjs';
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
let files;
try {
  files = snapshot.prepare("SELECT filename FROM media").all();
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
