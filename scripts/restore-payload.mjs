import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import {fileHash} from '../server/file-hash.mjs';
const [backupPath, targetPath, configPath] = process.argv.slice(2);
if (!backupPath || !targetPath || !configPath)
  throw Error(
    "Usage: node scripts/restore-payload.mjs BACKUP NEW_DATA_DIRECTORY NEW_CONFIG_FILE",
  );
const source = resolve(backupPath),
  target = resolve(targetPath);
const manifest = JSON.parse(
  await readFile(resolve(source, "backup-manifest.json"), "utf8"),
);
if (manifest.provider !== "payload") throw Error("Invalid backup");
for (const file of manifest.files) {
  const path = resolve(source, file.path);
  if (
    !path.startsWith(source + sep) ||
    !resolve(target, file.path).startsWith(target + sep)
  )
    throw Error("Unsafe backup path");
  if (
    await fileHash(path) !== file.sha256
  )
    throw Error(`Checksum mismatch: ${file.path}`);
}
// Refuse to overwrite an existing database or configuration, including live data.
await mkdir(target, { recursive: false });
for (const file of manifest.files) {
  if (file.path === "settings.json") continue;
  const destination = resolve(target, file.path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(source, file.path), destination);
}
const settings = JSON.parse(
  await readFile(resolve(source, "settings.json"), "utf8"),
);
settings.directory = target;
await writeFile(resolve(configPath), JSON.stringify(settings, null, 2), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  `Restored into a new directory: ${target}. Configuration: ${resolve(configPath)}. The active website has not been switched.`,
);
