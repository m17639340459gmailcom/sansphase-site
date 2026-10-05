import { communityReviewReasons } from '../src/community-rules.mjs';
import { fail } from './community-db.ts';
import type { Body, Ctx } from './community-context.ts';

// All selected posts are checked in one transaction before approval or rejection.
// The existing single-post operations retain rewards, notices and deletion reasons.
export async function reviewTopics(ctx: Ctx, body: Body) {
  if (!ctx.mod) throw fail('只有作者和版主能审核帖子。', 403);
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length)
    throw fail('请选择 1 到 50 个不同的待审帖子。');
  if (body.action !== 'approve' && body.action !== 'reject') throw fail('请选择审核操作。');
  const reason = body.action === 'reject' ? String(body.reason || '') : '';
  if (body.action === 'reject' && !(communityReviewReasons as readonly string[]).includes(reason)) throw fail('请选择审核不通过的理由。');
  const note = body.action === 'reject' && typeof body.note === 'string' && body.note.trim() ? ctx.clean(body.note, [1, 200], '补充说明', false) : '';
  const now = new Date().toISOString();
  await ctx.auditMutation(body.action === 'approve' ? 'bulk-approve-topics' : 'bulk-reject-topics', () => {
    for (const id of ids as string[]) {
      const topic = ctx.live.topic(id);
      if (!topic?.pending) throw fail('选择中有帖子已被处理，请刷新列表后重新选择。', 409);
      if (!ctx.canModerateBoard(topic.board)) throw fail('选择中有不属于你管理板块的帖子。', 403);
    }
    for (const id of ids as string[]) {
      if (body.action === 'approve') ctx.live.approveTopic(id, now);
      else ctx.live.rejectTopic(id, reason, note, now);
    }
  }, { topics: ids, ...(reason ? { reason, note } : {}) });
  ctx.send({ ok: true, count: ids.length });
}
