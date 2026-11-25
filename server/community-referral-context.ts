import type { CommunityAuthor } from './community-db.ts';
import { fail, memberKey } from './community-db.ts';
import type { Ctx, CommunityMutationConfirmation } from './community-context.ts';
import type { IdentityReferralAttribution } from './community-identity-protocol.ts';

// Resolve authority reads before the synchronous approval transaction. Ten
// concurrent lookups bound a bulk review's bridge traffic (at most 50 topics).
export async function prepareReferralAttributions(ctx: Ctx, authors: readonly CommunityAuthor[]) {
  const ids = [...new Set(authors.filter(author => author.kind === 'reader').map(author => author.id))];
  const values = new Map<string, IdentityReferralAttribution>();
  if (ctx.options.referralAttribution) {
    for (let start = 0; start < ids.length; start += 10) {
      await Promise.all(ids.slice(start, start + 10).map(async id => {
        values.set(id, await ctx.options.referralAttribution!(id));
      }));
    }
  } else if (ids.some(id => ctx.live.referrals.needsReview(id))) throw fail('邀请资格服务尚未就绪，请稍后重试。', 503);
  const participants = new Map<string, CommunityAuthor>();
  for (const [id, attribution] of values) if (attribution) {
    participants.set(`reader:${id}`, { kind: 'reader', id });
    participants.set(memberKey(attribution.inviter), attribution.inviter);
  }
  // The reviewer identity refresh follows attribution lookup. Include the
  // reward participants in its existing last profile batch, so a deactivation
  // during that wait cannot award using the earlier attribution snapshot.
  const confirmation: CommunityMutationConfirmation = { participants: [...participants.values()], inspect(map) {
    for (const [id, attribution] of values) if (attribution
      && (map.get(`reader:${id}`)?.active !== true || map.get(memberKey(attribution.inviter))?.active !== true)) values.set(id, null);
  } };
  return { values, confirmation, assertCurrent() {
    ctx.options.assertActive?.(ctx.req);
    for (const id of ids) {
      const attribution = values.get(id);
      ctx.options.assertReferralActive?.(attribution ? [id, attribution.inviter.id] : [id]);
    }
  } };
}
