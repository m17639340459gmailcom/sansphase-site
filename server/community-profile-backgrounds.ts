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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Custom profile backgrounds belong only to the community. Pending artwork never becomes public by uploading it. */
export function createCommunityProfileBackgrounds(db: DatabaseSync, tx: Transaction) {
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
  return {
    state,
    submit(member: CommunityAuthor, imageId: string, now = new Date().toISOString()) {
      return tx(() => {
        reader(member);
        const row = uuid.test(imageId) ? image.get(imageId) as ImageRow | undefined : undefined;
        if (!row || row.deleted_at || row.purpose !== 'profile' || row.topic_id || !same(member, { kind: row.uploader_kind, id: row.uploader_id }))
          throw fail('背景图片已失效，请重新上传。');
        save.run(member.kind, member.id, imageId, now, now);
        return state(member);
      });
    },
    remove(member: CommunityAuthor) {
      return tx(() => { reader(member); reset.run(member.kind, member.id); return state(member); });
    },
    pending(): PendingCommunityBackground[] {
      return (pending.all() as Array<{ member_kind: 'reader'; member_id: string; pending_image: string; pending_at: string; width: number; height: number }>).map(row => ({
        member: { kind: row.member_kind, id: row.member_id }, imageId: row.pending_image, imageUrl: `/api/community/images/${row.pending_image}.webp`,
        createdAt: row.pending_at, width: row.width, height: row.height,
      }));
    },
    review(member: CommunityAuthor, imageId: string, approve: boolean, actor: CommunityAuthor, reason: string, now = new Date().toISOString()) {
      return tx(() => {
        if (actor.kind !== 'owner') throw fail('只有作者能审核个人主页背景。', 403);
        reader(member);
        if (typeof approve !== 'boolean' || typeof reason !== 'string') throw fail('请填写有效的审核结果。');
        const note = reason.trim();
        if ((!approve && !note) || [...note].length > 200 || /[\u0000-\u001f\u007f<>]/u.test(note)) throw fail('请填写驳回原因，最多 200 个字。');
        const row = current.get(member.kind, member.id) as BackgroundRow | undefined;
        const value = imageDTO(imageId);
        if (!uuid.test(imageId) || row?.pending_image !== imageId || !value) throw fail('这份背景申请已被更新或处理，请刷新后再审核。', 409);
        if (decide.run(approve ? 1 : 0, now, member.kind, member.id, imageId).changes !== 1) throw fail('背景申请已更新，请刷新。', 409);
        receipt.run(randomUUID(), member.kind, member.id, imageId, approve ? 1 : 0, note, actor.kind, actor.id, now);
        return state(member);
      });
    },
    imageVisible(imageId: string, actor: CommunityAuthor, browsingAsReader = false) {
      const value = imageDTO(imageId);
      if (!value) return false;
      return (referenced.all(imageId, imageId) as BackgroundRow[]).some(row => row.approved_image === imageId ||
        row.pending_image === imageId && (same(actor, { kind: row.member_kind, id: row.member_id }) || actor.kind === 'owner' && !browsingAsReader));
    },
  };
}
