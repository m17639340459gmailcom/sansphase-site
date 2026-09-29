// The homepage and the complete blog are the only anonymous content surfaces.
// Keep this policy independent of the browser route and the `public=1` cache hint.
export { publicRoute, publicKind } from '../src/access-policy.mjs';

const restrictedKinds = ['works', 'resources', 'software', 'resource-center'];
type BookPreview = {
  id: string; recordId?: string; title: string; summary?: string; category?: string;
  tags?: string[]; date?: string; coverSrc?: string; coverWidth?: number;
  coverHeight?: number; vipOnly?: boolean; locked?: boolean;
};
type PublicData = Record<string, unknown> & { 'resource-center'?: BookPreview[] };
type ReaderAccess = boolean | { role?: string; vip?: boolean };

export function visibleBootstrap(data: PublicData, authenticated: ReaderAccess) {
  if (authenticated) {
    if (authenticated === true || authenticated.role === 'owner' || authenticated.vip) return data;
    return {
      ...data,
      'resource-center': (data['resource-center'] || []).map(item => item.vipOnly
        ? { id: item.id, recordId: item.recordId, title: item.title, summary: item.summary, category: item.category,
            tags: item.tags, date: item.date, coverSrc: item.coverSrc, coverWidth: item.coverWidth,
            coverHeight: item.coverHeight, vipOnly: true, locked: true }
        : item),
    };
  }
  const visible: Record<string, unknown> = { ...data };
  for (const kind of restrictedKinds) visible[kind] = [];
  return visible;
}
