import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { Payload } from 'payload';
import { validReaderNickname } from '../src/reader-policy.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type OwnerReaderAccount = {
  id: string; collection?: string; email: string; nickname: string; phone?: string | null;
  signature?: string | null; avatar?: string | null; _verified?: boolean; disabled?: boolean;
  createdAt: string; vip_until?: string | null; vip_started_at?: string | null;
};
export function readOwnerReaderId(settings: { ownerReaderId?: unknown }): string | undefined {
  if (settings.ownerReaderId === undefined) return undefined;
  if (typeof settings.ownerReaderId !== 'string' || !uuid.test(settings.ownerReaderId)) throw Error('ownerReaderId must be an explicit lowercase reader UUID.');
  return settings.ownerReaderId;
}
export async function activeOwnerReader(payload: Payload, id: string): Promise<OwnerReaderAccount | null> {
  let row: OwnerReaderAccount;
  try { row = await payload.findByID({ collection: 'readers', id, depth: 0 }) as unknown as OwnerReaderAccount; }
  catch (error) { if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null; throw error; }
  return row && String(row.id) === id && row._verified === true && !row.disabled && typeof row.nickname === 'string' ? row : null;
}
type PrepareOptions = {
  payload: Payload; ownerId: string; ownerReaderId?: string; nickname?: string;
  uidStore: { get: (id: string) => string; assignRandom: (id: string) => string };
  saveBinding: (id: string) => Promise<void>;
};
/** Explicit maintenance only. Startup and request handling never create an identity. */
export async function prepareOwnerReaderAccount({ payload, ownerId, ownerReaderId, nickname, uidStore, saveBinding }: PrepareOptions) {
  if (!uuid.test(ownerId)) throw Error('Preparation requires the configured fixed owner ID.');
  const owner = await payload.findByID({ collection: 'authors', id: ownerId, depth: 0 }) as unknown as { id: string; role?: string; email?: string };
  if (String(owner.id) !== ownerId || owner.role !== 'owner' || typeof owner.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email)) throw Error('The configured author is not a valid owner account.');
  const binding = readOwnerReaderId({ ownerReaderId });
  if (binding) {
    const row = await activeOwnerReader(payload, binding);
    if (!row) throw Error('The explicit ownerReaderId must reference a verified active reader.');
    return { created: false, readerId: binding, uid: uidStore.get(binding) };
  }
  const email = owner.email.trim().toLowerCase();
  const existing = await payload.find({ collection: 'readers', where: { email: { equals: email } }, limit: 2, depth: 0 });
  if (existing.docs.length) throw Error('作者同邮箱的读者实体已存在；必须明确设置 ownerReaderId，不能猜测或自动关联。');
  const name = String(nickname || '').trim().normalize('NFC');
  if (!validReaderNickname(name)) throw Error('创建专属读者身份需要明确的 2 至 8 字个人昵称。');
  const row = await payload.create({ collection: 'readers', data: {
    email, password: randomBytes(48).toString('base64url'), nickname: name, _verified: true, disabled: false,
  }, disableVerificationEmail: true }) as unknown as { id: string };
  const id = String(row.id);
  if (!uuid.test(id)) throw Error('Created reader ID is invalid; no binding was written.');
  try {
    const uid = uidStore.assignRandom(id);
    await saveBinding(id);
    return { created: true, readerId: id, uid };
  } catch (error) {
    // A database row and a private config file cannot commit atomically. Keep
    // the known new identity for explicit recovery; never delete user data or
    // let the next run silently bind a same-email account.
    throw Error(`专属读者实体已创建，但关联未完成；请核对并恢复 ownerReaderId=${id}。`, { cause: error });
  }
}
/** Preserve every unrelated private setting and fail if the config changed since it was inspected. */
export async function writeOwnerReaderBinding(configPath: string, expected: string, id: string) {
  if (!isAbsolute(configPath) || !uuid.test(id)) throw Error('An absolute private config and reader UUID are required.');
  const stat = await lstat(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(configPath) !== resolve(configPath) || process.platform !== 'win32' && (stat.mode & 0o077)) throw Error('Private configuration must be a regular private file without symlinks.');
  if (await readFile(configPath, 'utf8') !== expected) throw Error('Private configuration changed; no binding was written.');
  const settings: unknown = JSON.parse(expected);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Private configuration is invalid.');
  const record = settings as Record<string, unknown>;
  if (record.ownerReaderId !== undefined) throw Error('A binding already exists; no replacement is allowed.');
  const temporary = configPath + `.owner-reader-${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify({ ...record, ownerReaderId: id }, null, 2) + '\n', 'utf8');
    if (process.platform !== 'win32') {
      // This tool may run as root while the application reads a service-owned
      // private config. Preserve that owner before the atomic replacement.
      await file.chown(stat.uid, stat.gid);
      await file.chmod(stat.mode & 0o777);
      const prepared = await file.stat();
      if (prepared.uid !== stat.uid || prepared.gid !== stat.gid || (prepared.mode & 0o777) !== (stat.mode & 0o777)) throw Error('Private configuration ownership or permissions could not be preserved.');
    }
    await file.sync(); await file.close();
    const current = await lstat(configPath);
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino
      || process.platform !== 'win32' && (current.uid !== stat.uid || current.gid !== stat.gid || (current.mode & 0o777) !== (stat.mode & 0o777))) throw Error('Private configuration changed; no binding was written.');
    if (await readFile(configPath, 'utf8') !== expected) throw Error('Private configuration changed; no binding was written.');
    await rename(temporary, configPath);
  } catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}
