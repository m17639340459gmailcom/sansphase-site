import { fail } from './community-db.ts';
import type { Ctx } from './community-context.ts';

type ShopActor = Pick<Ctx, 'owner' | 'staff' | 'browsingAsReader' | 'readOnly'>;

/** Current verified appointments grant product management without changing stored capabilities. */
export function canManageCommunityShop(ctx: ShopActor) {
  return !ctx.browsingAsReader && !ctx.readOnly && (ctx.owner || ctx.staff?.role === 'general');
}

export function requireCommunityShopManagement(ctx: ShopActor) {
  if (!canManageCommunityShop(ctx)) throw fail('只有作者和有效总版主能管理兑换所商品。', 403);
}
