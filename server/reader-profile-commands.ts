import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Payload } from 'payload';
import sharp from 'sharp';
import { uuidPattern } from './content-service.ts';
import { readerAudit } from './reader-account-removal.ts';
import { cleanReaderFiles } from './reader-file-cleanup.ts';
import { contactDetailReason } from './reader-profile-policy.ts';
import { validReaderNickname } from '../src/reader-policy.ts';
import type { createReaderWorkflow, ProfileKind } from './reader-workflow.ts';

export const readerProfileAvatarBytes = 512 * 1024;
export type ReaderProfileState = {
  id: string; uid: string | null; nickname: string; signature: string; avatar: string | null;
  pendingSignature: string | null; pendingAvatar: boolean; pendingNickname: string | null;
};
export type ReaderProfileReview = {
  id: string; kind: ProfileKind; nickname: string; uid: string | null;
  proposedValue: string | null; avatarUrl: string | null; createdAt: string;
  advice: ReaderProfileAdvice[];
};
export type ReaderProfileAdvice = { id: string; decision: 'approve'|'reject'; reason: string; by: {kind:'owner'|'reader';id:string}; createdAt: string };
export type ReaderProfileActor = { kind: 'owner' | 'reader'; id: string; source: 'main' | 'community' };
export type ReaderProfileDecision = { ok: true; id: string; kind: ProfileKind; decision: 'approve' | 'reject' };
type ReaderRow = { id: string; nickname: string; signature?: string | null; avatar?: string | null; _verified?: boolean; disabled?: boolean };
type Options = { payload: Payload; directory: string; workflow: ReturnType<typeof createReaderWorkflow>; uidStore: { get: (id: string) => string | null } };
type Guard = (kind?: ProfileKind, action?: 'inspect'|'advise'|'decide') => Promise<void>;
const fail = (message: string, status = 400) => Object.assign(Error(message), { status });
const formats: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
// Existing reader HTTP, author review and the private bridge share this lock.
// A second adapter must not approve a proposal while another replaces it.
const queues = new WeakMap<Payload, { tail: Promise<unknown> }>();
export function readerSignature(value: unknown) {
  if (typeof value !== 'string') throw fail('请填写有效的个性签名。');
  const text = value.trim();
  if (text.length > 100 || /[\u0000-\u001f\u007f]/u.test(text)) throw fail('个性签名限 100 字，且不能换行。');
  const contact = contactDetailReason(text); if (contact) throw fail(contact);
  return text;
}
export function readerNickname(value: unknown) {
  if (typeof value !== 'string') throw fail('请填写有效的昵称。');
  const name = value.trim().normalize('NFC');
  if (!validReaderNickname(name)) throw fail('昵称需为 2 至 8 个可见字符。');
  return name;
}
export function readerProfileReason(value: unknown, decision: 'approve'|'reject', required = true) {
  if (value !== undefined && typeof value !== 'string') throw fail('请填写有效的审核理由。');
  const reason = typeof value === 'string' ? value.trim() : '';
  if (required && decision === 'reject' && !reason || [...reason].length > 200 || /[\u0000-\u001f\u007f<>]/u.test(reason)) throw fail('驳回需填写理由，最多 200 个字。');
  return reason;
}
export async function normalizeReaderAvatar(input: string | Buffer, mimetype: string): Promise<Buffer> {
  if (!formats[mimetype]) throw fail('头像只支持 JPG、PNG 或 WebP 图片。', 415);
  try {
    const source = sharp(input, { limitInputPixels: 25_000_000, animated: false });
    const metadata = await source.metadata();
    if (metadata.format !== formats[mimetype] || !metadata.width || !metadata.height)
      throw fail('请选择有效的图片文件。');
    const image = await source.rotate().resize(320, 320, { fit: 'cover', position: 'centre', withoutEnlargement: false }).webp({ quality: 82, effort: 4 }).toBuffer();
    if (image.length > readerProfileAvatarBytes) throw fail('头像处理后过大，请换一张图片。', 413);
    return image;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) throw error;
    throw fail('图片无法读取，请换一张 JPG、PNG 或 WebP 图片。');
  }
}
export function createReaderProfileCommands({ payload, directory, workflow, uidStore }: Options) {
  const uploads = resolve(directory, 'uploads');
  const path = (id: string, pending = false) => resolve(uploads, `${pending ? 'pending-' : ''}reader-avatar-${id}.webp`);
  let queue = queues.get(payload);
  if (!queue) { queue = { tail: Promise.resolve() }; queues.set(payload, queue); }
  const serialize = <T>(execute: () => Promise<T>): Promise<T> => {
    const next = queue!.tail.then(execute); queue!.tail = next.catch(() => {}); return next;
  };
  const find = async (id: string): Promise<ReaderRow | null> => {
    try { return await payload.findByID({ collection: 'readers', id, depth: 0 }) as unknown as ReaderRow; }
    catch (error) { if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null; throw error; }
  };
  const active = async (id: string) => { const row = await find(id); if (!row || row._verified !== true || row.disabled) throw fail('用户不存在。', 404); return row; };
  const project = (row: ReaderRow): ReaderProfileState => ({
    id: String(row.id), uid: uidStore.get(String(row.id)), nickname: row.nickname, signature: row.signature || '',
    avatar: uuidPattern.test(row.avatar || '') ? row.avatar! : null,
    pendingSignature: workflow.profileFor(String(row.id), 'signature')?.proposed_value ?? null,
    pendingAvatar: Boolean(workflow.profileFor(String(row.id), 'avatar')),
    pendingNickname: workflow.profileFor(String(row.id), 'nickname')?.proposed_value ?? null,
  });
  const guard = async (check?: Guard) => { await check?.(); };
  const currentReview = (id: string, kinds: readonly ProfileKind[]) => {
    const row = uuidPattern.test(id) ? workflow.profile(id) : null;
    if (!row) throw fail('待审核资料不存在或已处理，请刷新列表。', 404);
    if (!kinds.includes(row.kind)) throw fail('没有审核这类资料的权限。', 403);
    return row;
  };
  const clean = () => cleanReaderFiles({ workflow, payload, directory });
  return {
    // Disable, session revocation and deletion must not interleave with an
    // approval's account update or avatar move, across any HTTP adapter.
    accountMutation: serialize,
    state: async (readerId: string) => project(await active(readerId)),
    async submitSignature(readerId: string, value: unknown, check?: Guard): Promise<ReaderProfileState> {
      const proposed = readerSignature(value);
      return serialize(async () => {
        await guard(check); const row = await active(readerId); await guard(check);
        if (proposed !== (row.signature || '')) workflow.putProfile(readerId, 'signature', proposed);
        else { const previous = workflow.profileFor(readerId, 'signature'); if (previous) workflow.removeProfile(previous.id); }
        return project(row);
      });
    },
    async submitNickname(readerId: string, value: unknown, check?: Guard): Promise<ReaderProfileState> {
      const proposed = readerNickname(value);
      return serialize(async () => {
        await guard(check); const row = await active(readerId); await guard(check);
        if (proposed !== row.nickname) workflow.putProfile(readerId, 'nickname', proposed);
        else { const previous = workflow.profileFor(readerId, 'nickname'); if (previous) workflow.removeProfile(previous.id); }
        return project(row);
      });
    },
    submitAvatar(readerId: string, image: Buffer, check?: Guard): Promise<ReaderProfileState> {
      if (!Buffer.isBuffer(image) || image.length > readerProfileAvatarBytes) return Promise.reject(fail('头像内容过大。', 413));
      return serialize(async () => {
        await guard(check); const row = await active(readerId);
        const metadata = await sharp(image, { limitInputPixels: 25_000_000, animated: false }).metadata().catch(() => null);
        if (!metadata || metadata.format !== 'webp' || metadata.width !== 320 || metadata.height !== 320) throw fail('头像内容无效。');
        await guard(check);
        const id = randomUUID(); await mkdir(uploads, { recursive: true });
        await writeFile(path(id, true), image, { flag: 'wx', mode: 0o600 });
        let previous;
        try { await guard(check); ({ previous } = workflow.putProfile(readerId, 'avatar', id)); }
        catch (error) { await unlink(path(id, true)).catch(() => {}); throw error; }
        if (previous && uuidPattern.test(previous.proposed_value)) { workflow.queueFile(`pending-reader-avatar-${previous.proposed_value}.webp`, 'superseded-pending-avatar'); await clean(); }
        return project(row);
      });
    },
    removeAvatar(readerId: string, check?: Guard): Promise<ReaderProfileState> {
      return serialize(async () => {
        await guard(check); const row = await active(readerId); await guard(check);
        // Preserve pending until the account update succeeds.
        const updated = uuidPattern.test(row.avatar || '')
          ? await payload.update({ collection: 'readers', id: readerId, data: { avatar: null } }) as unknown as ReaderRow : row;
        const pending = workflow.profileFor(readerId, 'avatar');
        if (pending) { workflow.removeProfile(pending.id); workflow.queueFile(`pending-reader-avatar-${pending.proposed_value}.webp`, 'avatar-cancelled'); }
        if (uuidPattern.test(row.avatar || '')) workflow.queueFile(`reader-avatar-${row.avatar}.webp`, 'avatar-removed');
        if (pending || uuidPattern.test(row.avatar || '')) await clean();
        return project(updated);
      });
    },
    pendingAvatar(readerId: string, check?: Guard): Promise<Buffer> {
      return serialize(async () => {
        await active(readerId); await guard(check);
        const row = workflow.profileFor(readerId, 'avatar');
        if (!row || !uuidPattern.test(row.proposed_value)) throw fail('待审核头像不存在。', 404);
        const bytes = await readFile(path(row.proposed_value, true)); await guard(check); return bytes;
      });
    },
    async reviews(kinds: readonly ProfileKind[] = ['avatar', 'signature', 'nickname']): Promise<ReaderProfileReview[]> {
      const output: ReaderProfileReview[] = [];
      for (const row of workflow.profiles(1000).filter(row => kinds.includes(row.kind)).slice(0, 100)) {
        const user = await find(row.reader_id);
        output.push({ id: row.id, kind: row.kind, nickname: user?.nickname || '已删除账号', uid: user ? uidStore.get(row.reader_id) : null,
          proposedValue: row.kind !== 'avatar' ? row.proposed_value : null,
          avatarUrl: row.kind === 'avatar' ? `/api/community/manage/profiles/${row.id}/avatar.webp` : null, createdAt: row.created_at,
          advice: workflow.profileAdvice(row.id).map(item => ({ id: item.id, decision: item.decision, reason: item.reason, by: { kind: item.by_kind, id: item.by_id }, createdAt: item.created_at })) });
      }
      return output;
    },
    reviewImage(reviewId: string, check?: Guard): Promise<Buffer> {
      return serialize(async () => {
        await check?.('avatar', 'inspect'); const row = currentReview(reviewId, ['avatar']);
        if (!uuidPattern.test(row.proposed_value)) throw fail('待审核头像不存在。', 404);
        const bytes = await readFile(path(row.proposed_value, true)); await check?.('avatar', 'inspect'); return bytes;
      });
    },
    async advise(reviewId: string, decision: 'approve'|'reject', reasonValue: unknown, actor: ReaderProfileActor, kinds: readonly ProfileKind[], check?: Guard) {
      const reason = readerProfileReason(reasonValue, decision);
      return serialize(async () => {
        const row = currentReview(reviewId, kinds); await check?.(row.kind, 'advise');
        await active(row.reader_id); await check?.(row.kind, 'advise'); currentReview(reviewId, kinds);
        const advice = workflow.putProfileAdvice(row.id, decision, reason, { kind: actor.kind, id: actor.id });
        await readerAudit(directory, actor.id)('profile-advised', row.reader_id, { actorKind: actor.kind, source: actor.source, reviewId: row.id, kind: row.kind, decision, reason });
        return { ok: true as const, id: row.id, kind: row.kind, action: 'advise' as const, advice };
      });
    },
    async review(reviewId: string, decision: 'approve' | 'reject', actor: ReaderProfileActor, kinds: readonly ProfileKind[] = ['avatar', 'signature', 'nickname'], check?: Guard, reasonValue?: unknown): Promise<ReaderProfileDecision> {
      const reason = readerProfileReason(reasonValue, decision, actor.source === 'community');
      return serialize(async () => {
        const row = currentReview(reviewId, kinds); await check?.(row.kind, 'decide');
        if (decision === 'approve') await active(row.reader_id);
        await check?.(row.kind, 'decide');
        currentReview(reviewId, kinds);
        if (decision === 'approve') {
          const user = await active(row.reader_id);
          if (row.kind === 'signature' || row.kind === 'nickname') {
            const proposed = row.kind === 'signature' ? readerSignature(row.proposed_value) : readerNickname(row.proposed_value);
            await check?.(row.kind, 'decide'); currentReview(reviewId, kinds);
            await payload.update({ collection: 'readers', id: user.id, data: { [row.kind]: proposed } });
          } else {
            if (!uuidPattern.test(row.proposed_value)) throw fail('待审核头像不存在。', 404);
            await rename(path(row.proposed_value, true), path(row.proposed_value));
            try {
              await check?.(row.kind, 'decide'); await active(row.reader_id); await check?.(row.kind, 'decide'); currentReview(reviewId, kinds);
              await payload.update({ collection: 'readers', id: user.id, data: { avatar: row.proposed_value } });
            }
            catch (error) { await rename(path(row.proposed_value), path(row.proposed_value, true)); throw error; }
            if (uuidPattern.test(user.avatar || '')) workflow.queueFile(`reader-avatar-${user.avatar}.webp`, 'avatar-replaced');
          }
        }
        workflow.removeProfile(row.id);
        if (decision === 'reject' && row.kind === 'avatar') workflow.queueFile(`pending-reader-avatar-${row.proposed_value}.webp`, 'avatar-rejected');
        await readerAudit(directory, actor.id)(`profile-${decision === 'approve' ? 'approved' : 'rejected'}`, row.reader_id,
          { actorKind: actor.kind, source: actor.source, reviewId: row.id, kind: row.kind, decision, reason });
        await clean();
        return { ok: true, id: row.id, kind: row.kind, decision };
      });
    },
  };
}
export type ReaderProfileCommands = ReturnType<typeof createReaderProfileCommands>;
