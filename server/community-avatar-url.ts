const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const rawAvatar = new RegExp(`^${uuid}$`);
const mainAvatar = new RegExp(`^/api/reader/avatar/(${uuid})\\.webp$`);

export const isApprovedAvatarVersion = (value: unknown): value is string => typeof value === 'string' && rawAvatar.test(value);

// Profile state carries a UUID; the main identity projection carries its own URL.
// Both describe the same approved asset, without shortening its cache version.
export function communityApprovedAvatarURL(uid: string | null, avatar: string | null): string | null {
  if (!uid || !avatar) return null;
  const version = rawAvatar.test(avatar) ? avatar : mainAvatar.exec(avatar)?.[1];
  return `/api/community/avatar/${encodeURIComponent(uid)}.webp${version ? `?v=${version}` : ''}`;
}
