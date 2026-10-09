/** One approved frame, shared by every currently active VIP; selection stays personal. */
export const communityVipFrameRef = 'vipmoon';
export const communityVipFrameRevision = 'vip-moon-c78bcdb-r1';

export function communityVipFrameSource(compact: boolean): string {
  return `/assets/community/vip-frame/${compact ? 'compact/frame-moon.webp' : 'frame-moon.svg'}?v=${communityVipFrameRevision}`;
}

export function communityVipFrameHTML(): string {
  return `<span class="community-vip-frame" data-vip-frame="frame-moon" aria-hidden="true"><img class="community-vip-frame-image" src="${communityVipFrameSource(true)}" width="256" height="256" alt="" loading="lazy" decoding="async" draggable="false"></span>`;
}
