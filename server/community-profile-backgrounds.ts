import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CommunityProfileBackground, CommunityProfileImage } from '../src/community-profile.ts';
import { fail, same } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';

type BackgroundRow = {
  member_kind: 'reader'; member_id: string; approved_image: string | null;
  pending_image: string | null; pending_at: string | null;
};
type ImageRow = { id: string; uploader_kind: CommunityAuthor['kind']; uploader_id: string; width: number; height: number; purpose: string; deleted_at: string | null; topic_id: string | null };
export type PendingCommunityBackground = { member: CommunityAuthor; imageId: string; imageUrl: string; createdAt: string; width: number; height: number };
type AdviceRow = { id: string; decision: 'approve'|'reject'; reason: string; by_kind: 'reader'|'owner'; by_id: string; created_at: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Custom profile backgrounds belong only to the community. Pending artwork never becomes public by uploading it. */
export function createCommunityProfileBackgrounds(db: DatabaseSync, tx: Transaction, retireImage: (id: string, reason: string) => void = () => {}) {
  const current = db.prepare('SELECT member_kind,member_id,approved_image,pending_image,pending_at FROM community_profile_backgrounds WHERE member_kind=? AND member_id=?');
  const image = db.prepare('SELECT id,uploader_kind,uploader_id,width,height,purpose,deleted_at,topic_id FROM community_images WHERE id=?');
  const save = db.prepare(`INSERT INTO community_profile_backgrounds(member_kind,member_id,pending_image,pending_at,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(member_kind,member_id) DO UPDATE SET pending_image=excluded.pending_image,pending_at=excluded.pending_at,updated_at=excluded.updated_at`);
  const reset = db.prepare('DELETE FROM community_profile_backgrounds WHERE member_kind=? AND member_id=?');
  const decide = db.prepare(`UPDATE community_profile_backgrounds SET approved_image=CASE WHEN ?=1 THEN pending_image ELSE approved_image END,
    pending_image=NULL,pending_at=NULL,updated_at=? WHERE member_kind=? AND member_id=? AND pending_image=?`);
  const receipt = db.prepare(`INSERT INTO community_profile_background_reviews(id,member_kind,member_id,image_id,approved,reason,by_kind,by_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const pending = db.prepare(`SELECT b.member_kind,b.member_id,b.pending_image,b.pending_at,i.width,i.height
    FROM community_profile_backgrounds b JOIN community_images i ON i.id=b.pending_image
    WHERE i.purpose='profile' AND i.deleted_at IS NULL ORDER BY b.pending_at,b.rowid LIMIT 100`);
  const referenced = db.prepare('SELECT member_kind,member_id,approved_image,pending_image FROM community_profile_backgrounds WHERE approved_image=? OR pending_image=?');
  const adviceRows = db.prepare('SELECT id,decision,reason,by_kind,by_id,created_at FROM community_profile_background_advice WHERE image_id=? ORDER BY created_at,id');
  const clearAdvice = db.prepare('DELETE FROM community_profile_background_advice WHERE image_id=?');
  const imageDTO = (id: string | null): CommunityProfileImage | null => {
    const row = id ? image.get(id) as ImageRow | undefined : undefined;
    return row && row.purpose === 'profile' && !row.deleted_at ? { id: row.id, url: `/api/community/images/${row.id}.webp`, width: row.width, height: row.height } : null;
  };
  const state = (member: CommunityAuthor): CommunityProfileBackground => {
    const row = current.get(member.kind, member.id) as BackgroundRow | undefined;
    const value = imageDTO(row?.pending_image ?? null);
    return { approved: imageDTO(row?.approved_image ?? null), pending: value && row?.pending_at ? { ...value, createdAt: row.pending_at } : null };
  };
  const reader = (member: CommunityAuthor) => { if (member.kind !== 'reader') throw fail('作者品牌资料不能通过读者编辑器修改。', 403); };
  const authorized = (actor: CommunityAuthor, guard?: () => void) => { if (guard) guard(); else if (actor.kind !== 'owner') throw fail('没有审核个人主页背景的权限。',403); };
  const note = (approve: boolean, reason: string) => {
    if (typeof approve !== 'boolean' || typeof reason !== 'string') throw fail('请填写有效的审核结果。');
    const value = reason.trim(); if ((!approve && !value) || [...value].length > 200 || /[\u0000-\u001f\u007f<>]/u.test(value)) throw fail('请填写驳回原因，最多 200 个字。'); return value;
  };
  const proposal = (member: CommunityAuthor, imageId: string) => {
    reader(member); const row = current.get(member.kind,member.id) as BackgroundRow | undefined;
    if (!uuid.test(imageId) || row?.pending_image !== imageId || !imageDTO(imageId)) throw fail('这份背景申请已被更新或处理，请刷新后再审核。',409);
    return row;
  };
  return {
    state,
    imageApproved(imageId: string) { return Boolean(imageDTO(imageId)) && (referenced.all(imageId,imageId) as BackgroundRow[]).some(row=>row.approved_image===imageId); },
    advice(imageId: string) { return (adviceRows.all(imageId) as AdviceRow[]).map(row => ({ id:row.id,decision:row.decision,reason:row.reason,by:{kind:row.by_kind,id:row.by_id},createdAt:row.created_at })); },
    submit(member: CommunityAuthor, imageId: string, now = new Date().toISOString()) {
      return tx(() => {
        reader(member);
        const row = uuid.test(imageId) ? image.get(imageId) as ImageRow | undefined : undefined;
        if (!row || row.deleted_at || row.purpose !== 'profile' || row.topic_id || !same(member, { kind: row.uploader_kind, id: row.uploader_id }))
          throw fail('背景图片已失效，请重新上传。');
        const previous = current.get(member.kind, member.id) as BackgroundRow | undefined;
        save.run(member.kind, member.id, imageId, now, now);
        if (previous?.pending_image) { clearAdvice.run(previous.pending_image); retireImage(previous.pending_image, 'profile-background-superseded'); }
        return state(member);
      });
    },
    remove(member: CommunityAuthor) {
      return tx(() => {
        reader(member);
        const previous = current.get(member.kind, member.id) as BackgroundRow | undefined;
        reset.run(member.kind, member.id);
        for (const id of new Set([previous?.approved_image, previous?.pending_image])) if (id) { clearAdvice.run(id); retireImage(id, 'profile-background-removed'); }
        return state(member);
      });
    },
    pending(): PendingCommunityBackground[] {
      return (pending.all() as Array<{ member_kind: 'reader'; member_id: string; pending_image: string; pending_at: string; width: number; height: number }>).map(row => ({
        member: { kind: row.member_kind, id: row.member_id }, imageId: row.pending_image, imageUrl: `/api/community/images/${row.pending_image}.webp`,
        createdAt: row.pending_at, width: row.width, height: row.height,
      }));
    },
    advise(member: CommunityAuthor, imageId: string, approve: boolean, actor: CommunityAuthor, reason: string, guard?: () => void, now = new Date().toISOString()) {
      return tx(() => {
        authorized(actor,guard); proposal(member,imageId); const value=note(approve,reason), id=randomUUID(); authorized(actor,guard);
        db.prepare(`INSERT INTO community_profile_background_advice(id,member_kind,member_id,image_id,decision,reason,by_kind,by_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)
          ON CONFLICT(image_id,by_kind,by_id) DO UPDATE SET id=excluded.id,decision=excluded.decision,reason=excluded.reason,created_at=excluded.created_at`)
          .run(id,member.kind,member.id,imageId,approve?'approve':'reject',value,actor.kind,actor.id,now);
        return {ok:true as const,action:'advise' as const,advice:{id,decision:approve?'approve' as const:'reject' as const,reason:value,by:actor,createdAt:now}};
      });
    },
    review(member: CommunityAuthor, imageId: string, approve: boolean, actor: CommunityAuthor, reason: string, now = new Date().toISOString(), guard?: () => void) {
      return tx(() => {
        authorized(actor,guard); const row=proposal(member,imageId), value=note(approve,reason); authorized(actor,guard);
        if (decide.run(approve ? 1 : 0, now, member.kind, member.id, imageId).changes !== 1) throw fail('背景申请已更新，请刷新。', 409);
        receipt.run(randomUUID(), member.kind, member.id, imageId, approve ? 1 : 0, value, actor.kind, actor.id, now); clearAdvice.run(imageId);
        const retired = approve ? row.approved_image : row.pending_image;
        if (retired) retireImage(retired, approve ? 'profile-background-replaced' : 'profile-background-rejected');
        return state(member);
      });
    },
    imageVisible(imageId: string, actor: CommunityAuthor, browsingAsReader = false, canInspect = false) {
      const value = imageDTO(imageId);
      if (!value) return false;
      return (referenced.all(imageId, imageId) as BackgroundRow[]).some(row => row.approved_image === imageId ||
        row.pending_image === imageId && (same(actor, { kind: row.member_kind, id: row.member_id }) || !browsingAsReader && (actor.kind === 'owner' || canInspect)));
    },
  };
}
