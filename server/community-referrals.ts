import type { DatabaseSync } from 'node:sqlite';
import type { CommunityAuthor, Transaction } from './community-db.ts';
import { fail } from './community-db.ts';
import type { Ledger } from './community-ledger.ts';
import type { Notice } from './community-members.ts';
import type { IdentityReferralAttribution } from './community-identity-protocol.ts';
import { beijingDay } from '../src/community-rules.ts';

export const referralReward = 15;
export const referralMonthlyLimit = 10;
export const referralReviewReason = '受邀新成员首次发帖，等待人工审核';
export type ReferralStatus = 'waiting' | 'rewarded' | 'limit' | 'reverted' | 'ineligible';
type Row = { invitee_id: string; inviter_id: string; registered_at: string; status: ReferralStatus; topic_id: string | null;
  approved_at: string | null; reward_month: string | null; amount: number; reverted_amount: number; invitee_deleted: number; inviter_deleted: number };
type Notify = (member: CommunityAuthor, notice: Notice, now?: string) => void;
const reader = (id: string): CommunityAuthor => ({ kind: 'reader', id });
const validId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const checkedTime = (value: string) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw fail('邀请记录时间无效。', 503);
  return new Date(time).toISOString();
};

/** Only account-authority projections enter this module, never browser claims.
 * All settlement, notices and ledger writes join the existing content.db tx. */
export function createCommunityReferrals(db: DatabaseSync, tx: Transaction, ledger: Ledger, notify: Notify) {
  const one = db.prepare('SELECT * FROM community_referrals WHERE invitee_id=?');
  const insert = db.prepare('INSERT INTO community_referrals(invitee_id,inviter_id,registered_at) VALUES(?,?,?)');
  const count = db.prepare('SELECT COUNT(*) AS n FROM community_referrals WHERE inviter_id=? AND reward_month=? AND amount>0');
  const settle = db.prepare("UPDATE community_referrals SET status=?,topic_id=?,approved_at=?,reward_month=?,amount=? WHERE invitee_id=? AND status='waiting'");
  const invalidate = db.prepare("UPDATE community_referrals SET status='ineligible' WHERE invitee_id=? AND status='waiting'");
  const rows = db.prepare('SELECT * FROM community_referrals WHERE inviter_id=? ORDER BY registered_at DESC,invitee_id DESC LIMIT 100');
  const qualifying = db.prepare("SELECT * FROM community_referrals WHERE topic_id=? AND status='rewarded'");
  const reverted = db.prepare("UPDATE community_referrals SET status='reverted',reverted_amount=? WHERE invitee_id=? AND status='rewarded'");
  const get = (id: string) => one.get(id) as Row | undefined;
  const used = (id: string, month: string) => Number(count.get(id, month)?.n || 0);
  function bind(inviteeId: string, attribution: IdentityReferralAttribution) {
    if (!attribution) return false;
    const { inviter } = attribution;
    if (!validId(inviteeId) || inviter.kind !== 'reader' || !validId(inviter.id) || inviter.id === inviteeId) throw fail('邀请归属无效。', 503);
    const registeredAt = checkedTime(attribution.registeredAt);
    return tx(() => {
      const existing = get(inviteeId);
      if (existing) {
        if (existing.inviter_id !== inviter.id || existing.registered_at !== registeredAt) throw fail('邀请归属不一致，请稍后重试。', 503);
        return existing.status === 'waiting' && !existing.invitee_deleted && !existing.inviter_deleted;
      }
      insert.run(inviteeId, inviter.id, registeredAt);
      return true;
    });
  }
  return {
    bind,
    needsReview(inviteeId: string, attribution?: IdentityReferralAttribution) {
      const row = get(inviteeId);
      return row ? row.status === 'waiting' && !row.invitee_deleted && !row.inviter_deleted : Boolean(attribution);
    },
    // This is called ONLY by approveTopic, after its pending->published change.
    // Automatic publishing, hidden-topic restore and edits never invoke it.
    approved(invitee: CommunityAuthor, topicId: string, topicCreatedAt: string, attribution: IdentityReferralAttribution | undefined, now: string) {
      if (invitee.kind !== 'reader') return 0;
      return tx(() => {
        if (attribution) bind(invitee.id, attribution);
        const row = get(invitee.id);
        if (!row || row.status !== 'waiting') return 0;
        if (attribution === undefined) throw fail('邀请资格尚未校验，请稍后重新审核。', 503);
        if (!attribution || row.invitee_deleted || row.inviter_deleted || Date.parse(row.registered_at) > Date.parse(topicCreatedAt)) {
          invalidate.run(invitee.id); return 0;
        }
        const approvedAt = checkedTime(now), month = beijingDay(Date.parse(approvedAt)).slice(0, 7);
        const amount = used(row.inviter_id, month) < referralMonthlyLimit ? referralReward : 0;
        if (settle.run(amount ? 'rewarded' : 'limit', topicId, approvedAt, month, amount, invitee.id).changes !== 1) return 0;
        if (amount) {
          const inviter = reader(row.inviter_id);
          ledger.credit(inviter, amount, 'referral', { kind: 'referral', id: invitee.id }, approvedAt);
          notify(inviter, { type: 'system', text: '邀请成功，获得 15 星尘。', data: { amount, rewardMonth: month }, link: '#/community/stardust/invites' }, approvedAt);
        }
        return amount;
      });
    },
    revertTopic(topicId: string, now: string) {
      return tx(() => {
        const row = qualifying.get(topicId) as Row | undefined;
        if (!row) return 0;
        const amount = ledger.revert({ kind: 'referral', id: row.invitee_id }, now);
        reverted.run(amount, row.invitee_id);
        if (!row.inviter_deleted) notify(reader(row.inviter_id), { type: 'system', text: `邀请资格帖已被删除，已收回 ${amount} 星尘。`,
          data: { amount, rewardMonth: row.reward_month }, link: '#/community/stardust/invites' }, now);
        return amount;
      });
    },
    summary(inviter: CommunityAuthor, now = Date.now()) {
      const month = beijingDay(now).slice(0, 7), rewardedThisMonth = inviter.kind === 'reader' ? used(inviter.id, month) : 0;
      return { reward: referralReward, monthlyLimit: referralMonthlyLimit, month, rewardedThisMonth, remaining: Math.max(0, referralMonthlyLimit - rewardedThisMonth),
        records: inviter.kind === 'reader' ? (rows.all(inviter.id) as Row[]).map(row => ({ inviteeId: row.invitee_id, registeredAt: row.registered_at,
          status: row.status, topicId: row.topic_id, approvedAt: row.approved_at, rewardMonth: row.reward_month, amount: row.amount,
          revertedAmount: row.reverted_amount, inviteeDeleted: Boolean(row.invitee_deleted) })) : [] };
    },
    // Retention cleanup preserves other members' already-settled balances and
    // quota evidence. Minimal IDs remain as non-authenticating dedup tombstones.
    purgeReader(readerId: string) {
      db.prepare("UPDATE community_referrals SET invitee_deleted=1,topic_id=NULL,status=CASE WHEN status='waiting' THEN 'ineligible' ELSE status END WHERE invitee_id=?").run(readerId);
      db.prepare("UPDATE community_referrals SET inviter_deleted=1,status=CASE WHEN status='waiting' THEN 'ineligible' ELSE status END WHERE inviter_id=?").run(readerId);
    },
  };
}
