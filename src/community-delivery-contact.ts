import { find } from 'linkifyjs';
import { siQq } from 'simple-icons';
import { normalizeSocialLink } from './social-links.mjs';

// The author supplies the same public QQ entry used on the main site in the
// delivered text. Only explicitly configured, authorized deliveries render it.
export function communityDeliveryQQLink(delivery: string): string | null {
  for (const link of find(delivery, 'url')) {
    const normalized = normalizeSocialLink(link.value);
    if (!normalized) continue;
    const url = new URL(normalized);
    if (url.hostname === 'qm.qq.com' || url.hostname === 'wpa.qq.com') return url.href;
  }
  return null;
}

export const communityQQIcon = `<svg class="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${siQq.path}"/></svg>`;
