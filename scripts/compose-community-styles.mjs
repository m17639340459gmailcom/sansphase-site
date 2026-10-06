import { readFile } from 'node:fs/promises';

// Keep the accepted cascade explicit. No experimental style selection or server injection.
export const communityStyleFiles = ['community.css', 'community-layout/feed.css', 'community-layout/feed-thread.css', 'community-layout/stable-frame.css', 'community-layout/appearance.css', 'community-atlas/styles.css', 'community-management.css', 'community-profile.css', 'community-profile-crop.css'];
export async function composeCommunityStyles() {
  return (await Promise.all(communityStyleFiles.map(file => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')))).join('\n');
}
