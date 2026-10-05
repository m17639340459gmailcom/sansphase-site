import type { CommunityStore } from '../../server/community-store.ts';
import type { CommunityAuthor } from '../../server/community-db.ts';

// Unrelated business tests start with accounts that already completed a real
// server-side read interval. Consent timing itself is tested through the HTTP API.
export function acceptCommunityConvention(store: CommunityStore, members: readonly CommunityAuthor[]) {
  const version = store.convention.current().version, now = Date.now();
  for (const member of members) {
    store.convention.read(member, version, now - 10000);
    store.convention.agree(member, version, now);
  }
}
