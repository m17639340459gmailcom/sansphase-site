import { lstat, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

const filename = 'login-verification.db';
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Optional proof state belongs to the private backup, never the static release. */
export async function snapshotLoginVerification(source: string, target: string): Promise<boolean> {
  const path = resolve(source, filename), destination = resolve(target, filename);
  let file;
  try { file = await lstat(path); } catch (error) { if (missing(error)) return false; throw error; }
  if (!file.isFile() || file.isSymbolicLink()) throw Error('Login verification state must be a regular private file.');
  try { await lstat(destination); throw Error('Login verification backup already exists.'); }
  catch (error) { if (!missing(error)) throw error; }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='login_verification_used'").get())
      throw Error('Login verification state schema is invalid.');
    await backup(db, destination);
    await chmod(destination, 0o600);
  } finally { db.close(); }
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    if (snapshot.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw Error('Login verification snapshot is corrupt.');
  } finally { snapshot.close(); }
  return true;
}

/** Old snapshots must not revive a recently consumed proof. Account/session keys stay intact. */
export function rotateRestoredLoginVerificationKeys<T extends Record<string, unknown>>(settings: T): T {
  const config = settings.loginVerification;
  if (!config || typeof config !== 'object' || !('enabled' in config) || config.enabled !== true) return { ...settings };
  return { ...settings, loginVerification: { ...config,
    hmacSecret: randomBytes(48).toString('hex'), keySecret: randomBytes(48).toString('hex'),
  } };
}
