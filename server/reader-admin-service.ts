import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Payload, Where } from 'payload';
import { uuidPattern } from './content-service.ts';
import { addCalendarMonth, addMembershipDays, membershipState } from './reader-membership.ts';
import { readerAudit, removeReaderAccount } from './reader-account-removal.ts';
import type { PurgeCommunity } from './reader-account-removal.ts';
import { createReaderWorkflow, registrationLifetimeMs } from './reader-workflow.ts';
import { cleanReaderFiles } from './reader-file-cleanup.ts';
import { createReaderProfileCommands } from './reader-profile-commands.ts';
import type { ReaderProfileCommands } from './reader-profile-commands.ts';
import { createMediaRetention } from './payload/media-retention.ts';
import type { createReaderUidStore } from './reader-uids.ts';

type ReaderAdminRow = { id: string; email: string; nickname: string; phone?: string | null; _verified?: boolean; disabled?: boolean; createdAt: string; avatar?: string | null; vip_until?: string | null; vip_started_at?: string | null };
type AuthorService = { identity: (req: IncomingMessage) => Promise<unknown> };
type LoginLedger = { latest: (actorType: string, actorId: string) => { ip?: string; at?: string } | null; list: (actorType: string, actorId: string) => unknown[] };
type MediaRetentionView = Pick<ReturnType<typeof createMediaRetention>, 'versions' | 'list'> & {
  sweep: (options: { ids: string[]; limit: number }) => Promise<unknown>;
  sweepVersions: (options: { ids: string[]; limit: number }) => Promise<unknown>;
};
type AdminOptions = { payload: Payload; authorService: AuthorService; siteOrigin: string; directory: string; authorId: string; loginLedger?: LoginLedger; uidStore: ReturnType<typeof createReaderUidStore>; workflow?: ReturnType<typeof createReaderWorkflow>; mediaRetention?: ReturnType<typeof createMediaRetention>; purgeCommunity?: PurgeCommunity; profileCommands?: ReaderProfileCommands };
type AdminBody = Record<string, unknown>;
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const errorStatus = (error: unknown): number | undefined => error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const errorCode = (error: unknown): string | undefined => error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
export function createReaderAdminService({ payload, authorService, siteOrigin, directory, authorId, loginLedger, uidStore, workflow = createReaderWorkflow(directory, payload.config.secret), mediaRetention = createMediaRetention({ payload, directory }), purgeCommunity, profileCommands }: AdminOptions) {
  if (!payload || !authorService || !directory || !authorId || !uidStore) throw Error('Reader administration requires the owner service and private storage.');
  // The JavaScript retention service accepts selected ID arrays at runtime.
  const retention = mediaRetention as unknown as MediaRetentionView;
  const auditPath = resolve(directory, 'reader-admin-audit.jsonl');
  let membershipQueue: Promise<unknown> = Promise.resolve();
  const serializeMembership = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = membershipQueue.then(operation);
    membershipQueue = next.catch(() => {});
    return next;
  };
  const send = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const dto = (value: unknown) => {
    const row = value as ReaderAdminRow;
    const last = loginLedger?.latest('reader', row.id);
    return { id: row.id, uid: uidStore.get(row.id), email: row.email, nickname: row.nickname, phone: row.phone || '', verified: row._verified === true, disabled: Boolean(row.disabled), createdAt: row.createdAt, lastLoginIp: last?.ip || null, lastLoginAt: last?.at || null, ...membershipState(row) };
  };
  const body = async (req: IncomingMessage): Promise<AdminBody> => {
    if (Number(req.headers['content-length']) > 8192) throw fail('请求内容过大。', 413);
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 8192) throw fail('请求内容过大。', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as AdminBody; } catch { throw fail('请求格式无效。'); }
  };
  const audit = readerAudit(directory, authorId);
  const profiles = profileCommands || createReaderProfileCommands({ payload, directory, workflow, uidStore });
  const assertOwner = async (req: IncomingMessage) => { if (!await authorService.identity(req)) throw fail('只有作者可以管理读者。', 403); };
  // Payload has no generated collection types here; narrow documents at its boundary.
  const findReader = async (id: string) => await payload.findByID({ collection: 'readers', id }) as ReaderAdminRow;
  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      try {
        if (!await authorService.identity(req)) throw fail('只有作者可以管理读者。', 403);
        if (req.method !== 'GET' && (req.headers.origin !== siteOrigin || req.headers['x-author-request'] !== '1')) throw fail('请求来源验证失败。', 403);
        const url = new URL(req.url || '', siteOrigin);
        const path = url.pathname.slice('/api/manage/'.length).split('/').filter(Boolean);
        if (req.method === 'GET' && path[0] === 'review' && path[1] === 'avatar' && path.length === 3) {
          const id = path[2].replace(/\.webp$/, '');
          if (!uuidPattern.test(id) || !path[2].endsWith('.webp')) throw fail('待审核头像不存在。', 404);
          const image = await profiles.reviewImage(id, () => assertOwner(req));
          res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(image); return;
        }
        if (req.method === 'GET' && path[0] === 'review' && path.length === 1) {
          const profiles = [];
          for (const row of workflow.profiles()) {
            const user = await findReader(row.reader_id).catch(() => null);
            profiles.push({ id: row.id, readerId: row.reader_id, nickname: user?.nickname || '已删除账号',
              kind: row.kind, proposedValue: row.kind === 'signature' ? row.proposed_value : null,
              avatarUrl: row.kind === 'avatar' ? `/api/manage/review/avatar/${row.id}.webp` : null, createdAt: row.created_at });
          }
          const legacy = await payload.find({ collection: 'readers', depth: 0, limit: 100,
            where: { and: [{ _verified: { equals: false } }, { createdAt: { less_than_equal: new Date(Date.now() - registrationLifetimeMs).toISOString() } }] } });
          send(res, { profiles, expired: [...workflow.expiredRegistrations(), ...legacy.docs.map(row => ({ id: row.id, email: row.email,
            expiresAt: new Date(Date.parse(row.createdAt) + registrationLifetimeMs).toISOString(), source: 'legacy' }))],
            files: workflow.cleanupFiles(), versions: retention.versions(), media: retention.list() }); return;
        }
        if (req.method === 'POST' && path[0] === 'review' && path[1] === 'expired' && path[2] === 'cleanup' && path.length === 3) {
          const input = await body(req);
          if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100 || !input.ids.every(id => uuidPattern.test(id))) throw fail('请选择有效的过期申请。');
          const expired = new Set(workflow.expiredRegistrations(Date.now(), 1000).map(row => row.id));
          let cleaned = 0;
          for (const id of new Set(input.ids)) {
            if (expired.has(id)) { if (workflow.removeRegistration(id)) cleaned++; continue; }
            const legacy = await findReader(id).catch(() => null);
            if (legacy && legacy._verified !== true && Date.now() - Date.parse(legacy.createdAt) >= registrationLifetimeMs) {
              await removeReaderAccount({ payload, directory, uidStore, row: legacy, audit, action: 'manual-delete-unverified', workflow, purgeCommunity });
              cleaned++;
            }
          }
          send(res, { cleaned }); return;
        }
        if (req.method === 'POST' && path[0] === 'review' && path[1] === 'files' && path[2] === 'cleanup' && path.length === 3) {
          const input = await body(req);
          if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100 || !input.ids.every(id => uuidPattern.test(id))) throw fail('请选择有效的待清理文件。');
          send(res, await cleanReaderFiles({ workflow, payload, directory, ids: input.ids as string[], limit: 1000 })); return;
        }
        if (req.method === 'POST' && path[0] === 'review' && path[1] === 'media' && path[2] === 'cleanup' && path.length === 3) {
          const input = await body(req);
          if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100 || !input.ids.every(id => uuidPattern.test(id))) throw fail('请选择有效的待清理媒体。');
          send(res, await retention.sweep({ ids: input.ids as string[], limit: 1000 })); return;
        }
        if (req.method === 'POST' && path[0] === 'review' && path[1] === 'versions' && path[2] === 'cleanup' && path.length === 3) {
          const input = await body(req);
          if (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 100 || !input.ids.every(id => uuidPattern.test(id))) throw fail('请选择有效的待清理版本。');
          send(res, await retention.sweepVersions({ ids: input.ids as string[], limit: 1000 })); return;
        }
        if (req.method === 'POST' && path[0] === 'review' && path[1] === 'profile' && uuidPattern.test(path[2] || '') && ['approve', 'reject'].includes(path[3]) && path.length === 4) {
          await profiles.review(path[2], path[3] as 'approve'|'reject', { kind: 'owner', id: authorId, source: 'main' }, ['avatar', 'signature'], () => assertOwner(req));
          send(res, { ok: true }); return;
        }
        if (req.method === 'GET' && path[0] === 'readers' && uuidPattern.test(path[1] || '') && path[2] === 'logins' && path.length === 3) {
          const row = await findReader(path[1]);
          if (!row || row._verified !== true) throw fail('用户不存在。', 404);
          send(res, { events: loginLedger?.list('reader', row.id) || [] }); return;
        }
        if (req.method === 'GET' && path[0] === 'readers' && path.length === 1) {
          const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
          const status = url.searchParams.get('status') || 'all';
          if (!['all', 'active', 'disabled'].includes(status)) throw fail('账号状态无效。');
          const membership = url.searchParams.get('membership') || 'all';
          if (!['all', 'vip', 'expired'].includes(membership)) throw fail('会员状态无效。');
          const now = new Date().toISOString();
          const membershipConditions: Record<'vip' | 'expired', Where> = {
            vip: { vip_until: { greater_than: now } },
            expired: { and: [{ vip_until: { exists: true } }, { vip_until: { less_than_equal: now } }] },
          };
          const membershipWhere = membership === 'vip' || membership === 'expired' ? membershipConditions[membership] : null;
          const sort = membership === 'vip' ? ['vip_until', 'id'] : membership === 'expired' ? ['-vip_until', 'id'] : '-createdAt';
          const page = Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1));
          const statusWhere: Record<'all' | 'active' | 'disabled', Where> = {
            all: { _verified: { equals: true } },
            active: { and: [{ _verified: { equals: true } }, { disabled: { equals: false } }] },
            disabled: { and: [{ _verified: { equals: true } }, { disabled: { equals: true } }] },
          };
          const uidMatch = uidStore.readerId(q.replace(/^UID\s*/i, ''));
          const searchWhere: Where | null = q ? { or: [{ email: { contains: q } }, { nickname: { contains: q } }, { phone: { contains: q } }, ...(uidMatch ? [{ id: { equals: uidMatch } }] : [])] } : null;
          const where: Where[] = [searchWhere, statusWhere[status as 'all' | 'active' | 'disabled'], membershipWhere].filter((condition): condition is Where => Boolean(condition));
          const result = await payload.find({ collection: 'readers', limit: 20, page, sort, depth: 0,
            ...(where.length ? { where: where.length === 1 ? where[0] : { and: where } } : {}) });
          const [all, active, disabled, vip, expiredVip] = await Promise.all([
            payload.find({ collection: 'readers', limit: 1, depth: 0, where: statusWhere.all }),
            payload.find({ collection: 'readers', limit: 1, depth: 0, where: statusWhere.active }),
            payload.find({ collection: 'readers', limit: 1, depth: 0, where: statusWhere.disabled }),
            payload.find({ collection: 'readers', limit: 1, depth: 0, where: { and: [statusWhere.all, membershipConditions.vip] } }),
            payload.find({ collection: 'readers', limit: 1, depth: 0, where: { and: [statusWhere.all, membershipConditions.expired] } }),
          ]);
          send(res, { users: result.docs.map(dto), page: result.page, totalPages: result.totalPages, total: result.totalDocs,
            summary: { total: all.totalDocs, active: active.totalDocs, disabled: disabled.totalDocs, vip: vip.totalDocs, expiredVip: expiredVip.totalDocs } }); return;
        }
        if (req.method === 'GET' && path[0] === 'audit' && path.length === 1) {
          const lines = (await readFile(auditPath, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))).trim().split('\n').filter(Boolean);
          send(res, { events: lines.slice(-100).reverse().map(line => JSON.parse(line)).filter(event => ['disable', 'enable', 'revoke', 'vip-grant', 'vip-add-days', 'vip-revoke', 'uid-change', 'delete', 'auto-delete-inactive'].includes(event.action)).slice(0, 20) }); return;
        }
        if (req.method === 'POST' && path[0] === 'readers' && uuidPattern.test(path[1] || '') && path.length === 3) {
          const input = await body(req);
          if (input.confirmId !== path[1]) throw fail('用户编号不匹配。');
          const row = await findReader(path[1]);
          if (!row || row._verified !== true) throw fail('用户不存在。', 404);
          if (path[2] === 'delete') {
            if (String(input.confirmEmail || '').trim().toLowerCase() !== row.email.toLowerCase()) throw fail('请完整输入该账号的邮箱以确认删除。');
            const result = await profiles.accountMutation(async () => {
              await assertOwner(req);
              const latest = await findReader(row.id);
              if (!latest || latest._verified !== true) throw fail('用户不存在。', 404);
              if (String(input.confirmEmail || '').trim().toLowerCase() !== latest.email.toLowerCase()) throw fail('请完整输入该账号的邮箱以确认删除。');
              return removeReaderAccount({ payload, directory, uidStore, row: latest, audit, action: 'delete', workflow, purgeCommunity });
            });
            send(res, result); return;
          }
          if (path[2] === 'uid') {
            let change;
            try { change = uidStore.set(row.id, input.uid as string); }
            catch (error) {
              if (errorCode(error) === 'UID_INVALID') throw fail(errorMessage(error));
              if (errorCode(error) === 'UID_TAKEN') throw fail(errorMessage(error), 409);
              if (errorCode(error) === 'UID_READER_MISSING') throw fail(errorMessage(error), 404);
              throw error;
            }
            if (change.changed) await audit('uid-change', row.id, { from: change.previous, to: change.uid });
            send(res, dto(row)); return;
          }
          if (path[2] === 'disable') {
            const updated = await profiles.accountMutation(async () => {
              await assertOwner(req); await audit('request-disable', row.id);
              const result = await payload.update({ collection: 'readers', id: row.id, data: { disabled: true, sessions: [] } });
              await audit('disable', row.id); return result;
            });
            send(res, dto(updated)); return;
          }
          if (path[2] === 'enable') {
            const updated = await profiles.accountMutation(async () => {
              await assertOwner(req); await audit('request-enable', row.id);
              const result = await payload.update({ collection: 'readers', id: row.id, data: { disabled: false } });
              await audit('enable', row.id); return result;
            });
            send(res, dto(updated)); return;
          }
          if (path[2] === 'revoke') {
            const updated = await profiles.accountMutation(async () => {
              await assertOwner(req); await audit('request-revoke', row.id);
              const result = await payload.update({ collection: 'readers', id: row.id, data: { sessions: [] } });
              await audit('revoke', row.id); return result;
            });
            send(res, dto(updated)); return;
          }
          if (path[2] === 'vip-grant') {
            const updated = await serializeMembership(async () => {
              const latest = await findReader(row.id);
              const now = new Date();
              const current = membershipState(latest, now);
              const until = addCalendarMonth(current.vip && current.vipUntil ? current.vipUntil : now.toISOString());
              await audit('request-vip-grant', row.id, { previousUntil: current.vipUntil, until });
              const result = await payload.update({ collection: 'readers', id: row.id, data: { vip_started_at: current.vip ? current.vipStartedAt || now.toISOString() : now.toISOString(), vip_until: until } });
              await audit('vip-grant', row.id, { until });
              return result;
            });
            send(res, dto(updated)); return;
          }
          if (path[2] === 'vip-add-days') {
            if (typeof input.days !== 'number' || !Number.isInteger(input.days) || input.days < 1 || input.days > 365) throw fail('请输入 1 至 365 的整数天数。');
            const updated = await serializeMembership(async () => {
              const latest = await findReader(row.id);
              if (!latest || latest._verified !== true) throw fail('用户不存在。', 404);
              const now = new Date();
              const current = membershipState(latest, now);
              const until = addMembershipDays(current.vip && current.vipUntil ? current.vipUntil : now.toISOString(), input.days as number);
              await audit('request-vip-add-days', row.id, { days: input.days, previousUntil: current.vipUntil, until });
              const result = await payload.update({ collection: 'readers', id: row.id, data: { vip_started_at: current.vip ? current.vipStartedAt || now.toISOString() : now.toISOString(), vip_until: until } });
              await audit('vip-add-days', row.id, { days: input.days, previousUntil: current.vipUntil, until });
              return result;
            });
            send(res, dto(updated)); return;
          }
          if (path[2] === 'vip-revoke') {
            const updated = await serializeMembership(async () => {
              const latest = await findReader(row.id);
              await audit('request-vip-revoke', row.id, { previousUntil: latest.vip_until || null });
              const result = await payload.update({ collection: 'readers', id: row.id, data: { vip_started_at: null, vip_until: null } });
              await audit('vip-revoke', row.id);
              return result;
            });
            send(res, dto(updated)); return;
          }
        }
        throw fail('不存在的操作。', 404);
      } catch (error) { send(res, { error: errorStatus(error) ? errorMessage(error) : '服务暂时不可用，请稍后重试。' }, errorStatus(error) || 503); }
    },
  };
}
