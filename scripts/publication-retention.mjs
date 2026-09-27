import { lstat, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';

// Only completed, explicitly marked preparations qualify. Existing unmarked
// copies require a reviewed maintenance plan; arbitrary .local files never do.
export async function prunePublications(base, current, now = Date.now()) {
  base = resolve(base);
  if ((await lstat(base)).isSymbolicLink() || await realpath(base) !== base)
    throw Error('Unsafe publication root');
  const candidates = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^sansphase-site-[a-zA-Z0-9]+$/.test(entry.name)) continue;
    const path = resolve(base, entry.name);
    if (dirname(path) !== base || !path.startsWith(base + sep)) throw Error('Unsafe publication path');
    try {
      const marker = JSON.parse(await readFile(resolve(path, '.publication-complete.json'), 'utf8'));
      const created = Date.parse(marker.createdAt);
      if (marker.kind === 'sansphase-publication' && Number.isFinite(created)) candidates.push({ path, created });
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  candidates.sort((a,b) => b.created - a.created);
  const removed = [];
  for (const item of candidates.slice(3)) {
    if (item.path === resolve(current) || now - item.created < 7 * 86400000) continue;
    if ((await lstat(item.path)).isSymbolicLink() || await realpath(item.path) !== item.path)
      throw Error('Publication changed before cleanup');
    await rm(item.path, { recursive: true, force: false });
    removed.push(item.path);
  }
  return removed;
}
