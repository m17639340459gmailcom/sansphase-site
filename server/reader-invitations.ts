import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { assertReaderInvitationsReady } from './payload/invitation-migration.ts';
import type { IdentityReferralAttribution, IdentityReferralSelf } from './community-identity-protocol.ts';

const readerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const validInvitationCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{24}$/.test(value);
const unavailable = () => Object.assign(Error('邀请功能当前不可用，请确认账号仍然有效。'), { status: 403 });
const date = (value: unknown) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw Error('Invalid invitation registration timestamp.');
  return new Date(value).toISOString();
};
export type ReaderInvitations = ReturnType<typeof createReaderInvitations>;
export function createReaderInvitations({ directory }: { directory: string }) {
  assertReaderInvitationsReady(directory);
  const db = new DatabaseSync(resolve(directory, 'content.db'));
  db.exec('PRAGMA busy_timeout=5000');
  const active = (id: string) => readerIdPattern.test(id) && Boolean(db.prepare('SELECT 1 FROM readers WHERE id=? AND _verified=1 AND COALESCE(disabled,0)=0').get(id));
  const newCode = () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(18).toString('base64url');
      if (!db.prepare('SELECT 1 FROM readers WHERE invitation_code=?').get(code)) return code;
    }
    throw Error('Invitation code allocation failed.');
  };
  return {
    assertActive(readerIds: readonly string[]) {
      if (!readerIds.length || readerIds.length > 2 || readerIds.some(id => !active(id))) throw Object.assign(Error('邀请相关账号已经失效，不能发放奖励。'), { status: 409 });
    },
    resolveCode(code: unknown): string | null {
      if (!validInvitationCode(code)) return null;
      const row = db.prepare('SELECT id FROM readers WHERE invitation_code=? AND _verified=1 AND COALESCE(disabled,0)=0').get(code);
      return typeof row?.id === 'string' && readerIdPattern.test(row.id) ? row.id : null;
    },
    registrationFields(inviterId: string | null, bound: boolean) {
      return { invitation_code: newCode(), invited_by: bound && inviterId && active(inviterId) ? inviterId : null, invitation_bound: bound };
    },
    attribution(readerId: string): IdentityReferralAttribution {
      if (!readerIdPattern.test(readerId)) return null;
      const row = db.prepare(`SELECT r.invited_by,r.created_at FROM readers r JOIN readers i ON i.id=r.invited_by
        WHERE r.id=? AND r.invitation_bound=1 AND r.id<>i.id AND r._verified=1 AND COALESCE(r.disabled,0)=0
        AND i._verified=1 AND COALESCE(i.disabled,0)=0`).get(readerId);
      return typeof row?.invited_by === 'string' && readerIdPattern.test(row.invited_by)
        ? { inviter: { kind: 'reader', id: row.invited_by }, registeredAt: date(row.created_at) } : null;
    },
    self(readerId: string): IdentityReferralSelf {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!active(readerId)) throw unavailable();
        let code = db.prepare('SELECT invitation_code FROM readers WHERE id=?').get(readerId)?.invitation_code;
        if (code == null) {
          code = newCode(); db.prepare('UPDATE readers SET invitation_code=? WHERE id=? AND invitation_code IS NULL').run(String(code), readerId);
        }
        if (!validInvitationCode(code)) throw Error('Invalid persisted invitation code.');
        const invitees = db.prepare('SELECT id,created_at FROM readers WHERE invited_by=? AND invitation_bound=1 AND _verified=1 AND COALESCE(disabled,0)=0 ORDER BY created_at DESC,id DESC LIMIT 100')
          .all(readerId).map(row => ({ readerId: String(row.id), registeredAt: date(row.created_at) }));
        db.exec('COMMIT'); return { readerId, code, invitees };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    purge(readerId: string) {
      if (!readerIdPattern.test(readerId)) throw Error('Invalid reader invitation cleanup id.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM readers WHERE id=?').get(readerId)) throw Error('账号仍然存在，不能清除邀请归属。');
        db.prepare('UPDATE readers SET invited_by=NULL WHERE invited_by=?').run(readerId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}
