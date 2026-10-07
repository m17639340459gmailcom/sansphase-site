import type { DatabaseSync } from 'node:sqlite';
import { communityBoards } from '../src/community.ts';
import type { CommunityBannerConfig } from '../src/community-banners.ts';
import { fail, same } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';
import type { createMembers } from './community-members.ts';

const scopes = ['home', ...communityBoards.map(board => board.id)];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Access = { actor: CommunityAuthor; browsingAsReader: boolean; canSeeBoard: (board: string) => boolean };
type Entry = { scope: string; position: number; topic_id: string | null; topic_board: string; title: string; cover: string | null };
type Topic = { id: string; board: string; title: string; body: string; pending: number; hidden_at: string | null; deleted_at: string | null };
type Image = { id: string; uploader_kind: CommunityAuthor['kind']; uploader_id: string; purpose: string; banner_scope: string | null; deleted_at: string | null };

/** The homepage and each board own a separate ordered selection. Post flags never alter it. */
export function createCommunityBanners(db: DatabaseSync, tx: Transaction, members: ReturnType<typeof createMembers>, staff: ReturnType<typeof import('./community-staff.ts').createCommunityStaff>) {
  const current = db.prepare('SELECT version FROM community_banners WHERE scope=?');
  const entries = db.prepare('SELECT scope, position, topic_id, topic_board, title, cover FROM community_banner_entries WHERE scope=? ORDER BY position');
  const topicById = db.prepare('SELECT id, board, title, body, pending, hidden_at, deleted_at FROM community_topics WHERE id=?');
  const imageById = db.prepare('SELECT id, uploader_kind, uploader_id, purpose, banner_scope, deleted_at FROM community_images WHERE id=?');
  const firstImage = db.prepare("SELECT id FROM community_images WHERE topic_id=? AND reply_id IS NULL AND deleted_at IS NULL AND purpose='content' ORDER BY position LIMIT 1");
  const imageEntries = db.prepare('SELECT scope, position, topic_id, topic_board, title, cover FROM community_banner_entries WHERE cover=?');
  const ensure = db.prepare('INSERT INTO community_banners(scope,version) VALUES(?,0) ON CONFLICT(scope) DO NOTHING');
  const bump = db.prepare('UPDATE community_banners SET version=version+1 WHERE scope=? AND version=?');
  const clear = db.prepare('DELETE FROM community_banner_entries WHERE scope=?');
  const insert = db.prepare('INSERT INTO community_banner_entries(scope,position,topic_id,topic_board,title,cover) VALUES(?,?,?,?,?,?)');
  const validTopic = (entry: Entry, canSeeBoard: Access['canSeeBoard']) => {
    if (entry.topic_id === null) return null;
    const topic = topicById.get(entry.topic_id) as Topic | undefined;
    return topic && !topic.deleted_at && !topic.pending && !topic.hidden_at && topic.board === entry.topic_board
      && (entry.scope === 'home' || entry.scope === topic.board) && canSeeBoard(topic.board) ? topic : null;
  };
  const imageBoard = (scope: string) => scope === 'home' ? '' : scope;
  const validImageEntry = (entry: Entry, canSeeBoard: Access['canSeeBoard']) => entry.topic_id === null
    && scopes.includes(entry.scope) && entry.topic_board === imageBoard(entry.scope) && Boolean(entry.cover)
    && (entry.scope === 'home' || canSeeBoard(entry.scope));
  const validateScope = (scope: string) => { if (!scopes.includes(scope)) throw fail('没有这个横幅范围。', 404); };
  const authorize = (scope: string, access: Access) => {
    validateScope(scope);
    if (access.browsingAsReader || (scope === 'home' ? staff.state(access.actor)?.role !== 'owner' : !staff.can(access.actor,'banner.manage',scope)))
      throw fail(scope === 'home' ? '只有作者能设置社区首页横幅。' : '你没有这个板块的横幅管理权限。', 403);
  };
  const get = (scope: string, canSeeBoard: Access['canSeeBoard']): CommunityBannerConfig => {
    validateScope(scope);
    if (scope !== 'home' && !canSeeBoard(scope)) throw fail('没有这个版块。', 404);
    const items: CommunityBannerConfig['items'] = [];
    for (const entry of entries.all(scope) as Entry[]) {
      const cover = entry.cover ? imageById.get(entry.cover) as Image | undefined : null;
      if (entry.cover && (!cover || cover.deleted_at || cover.purpose !== 'banner' || cover.banner_scope !== scope)) continue;
      if (entry.topic_id === null) {
        if (!validImageEntry(entry, canSeeBoard) || !entry.cover) continue;
        items.push({ kind: 'image', topicId: null, title: entry.title, cover: entry.cover, board: imageBoard(scope),
          topicTitle: '', topicImage: null, image: entry.cover });
        continue;
      }
      const topic = validTopic(entry, canSeeBoard);
      if (!topic) continue;
      const topicImage = (firstImage.get(topic.id) as { id: string } | undefined)?.id ?? null;
      items.push({ topicId: topic.id, title: entry.title, cover: entry.cover, board: topic.board,
        topicTitle: topic.title || ([...topic.body.replace(/\s+/g, ' ').trim()].slice(0, 36).join('') + ([...topic.body].length > 36 ? '…' : '')),
        topicImage, image: entry.cover || topicImage });
    }
    return { scope, version: Number((current.get(scope) as { version: number } | undefined)?.version ?? 0), items };
  };
  return {
    authorize,
    get,
    managed(access: Access) {
      if (access.browsingAsReader) throw fail('请先返回管理身份。', 403);
      const allowed = staff.state(access.actor)?.role === 'owner' ? scopes : members.moderationBoards(access.actor).filter(scope=>staff.can(access.actor,'banner.manage',scope));
      return allowed.map(scope => get(scope, access.canSeeBoard));
    },
    replace(scope: string, version: unknown, value: unknown, access: Access) {
      return tx(() => {
        authorize(scope, access);
        if (!Number.isSafeInteger(version) || Number(version) < 0) throw fail('横幅版本无效，请重新打开设置。');
        if (!Array.isArray(value) || value.length > 5) throw fail('每个页面最多设置 5 张横幅。');
        const used = new Set<string>();
        const previous = entries.all(scope) as Entry[];
        const prepared = value.map((input: unknown) => {
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('横幅内容格式无效。');
          const item = input as Record<string, unknown>;
          const independent = item.kind === 'image';
          if (item.kind !== undefined && item.kind !== 'post' && !independent) throw fail('横幅类型无效。');
          if (independent ? item.topicId !== null : typeof item.topicId !== 'string' || !item.topicId || used.has(item.topicId))
            throw fail(independent ? '独立图片不能关联帖子。' : '请选择不同的帖子作为横幅。');
          if (!independent) used.add(item.topicId as string);
          if (typeof item.title !== 'string' || [...item.title.trim()].length > 80 || /[\u0000-\u001f\u007f]/.test(item.title)) throw fail('横幅标题最多 80 个字。');
          const topic = independent ? null : topicById.get(item.topicId as string) as Topic | undefined;
          if (!independent && (!topic || topic.deleted_at || topic.pending || topic.hidden_at || !access.canSeeBoard(topic.board) || scope !== 'home' && topic.board !== scope))
            throw fail('只能选择这个范围内已发布且正常显示的帖子。');
          let cover: string | null = null;
          if (independent && item.cover === null) throw fail('请上传独立横幅图片。');
          if (item.cover !== null) {
            if (typeof item.cover !== 'string' || !uuid.test(item.cover)) throw fail('请重新选择横幅封面。');
            const image = imageById.get(item.cover) as Image | undefined;
            const retained = previous.some(entry => entry.cover === item.cover);
            if (!image || image.deleted_at || image.purpose !== 'banner' || image.banner_scope !== scope
              || !(same(access.actor, { kind: image.uploader_kind, id: image.uploader_id }) || retained))
              throw fail('这张图片不能用于当前页面横幅。');
            cover = item.cover;
          }
          return { topicId: topic?.id ?? null, board: topic?.board ?? imageBoard(scope), title: item.title.trim(), cover };
        });
        ensure.run(scope);
        if (bump.run(scope, Number(version)).changes !== 1) throw fail('横幅已被其他管理者更新，请刷新后再保存。', 409);
        clear.run(scope);
        prepared.forEach((entry, position) => insert.run(scope, position, entry.topicId, entry.board, entry.title, entry.cover));
        return get(scope, access.canSeeBoard);
      });
    },
    imageVisible(id: string, actor: CommunityAuthor, canSeeBoard: Access['canSeeBoard'], canManage?: (scope:string)=>boolean) {
      const image = imageById.get(id) as Image | undefined;
      if (!image || image.deleted_at || image.purpose !== 'banner') return false;
      const references = imageEntries.all(id) as Entry[];
      if (!references.length) return same(actor, { kind: image.uploader_kind, id: image.uploader_id }) && Boolean(image.banner_scope && (canManage ? canManage(image.banner_scope) : image.banner_scope==='home' ? staff.state(actor)?.role==='owner' : staff.can(actor,'banner.manage',image.banner_scope)));
      return references.some(entry => image.banner_scope === entry.scope
        && (entry.topic_id === null ? validImageEntry(entry, canSeeBoard) : Boolean(validTopic(entry, canSeeBoard))));
    },
  };
}
