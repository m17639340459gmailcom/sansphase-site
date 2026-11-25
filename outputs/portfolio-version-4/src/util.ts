// Small helpers shared by the home page and the other pages.
import { posts } from './content';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
export const DAY = 86400000;

export const parseDate = (d: string) => {
  const [y, m, dd] = d.split('.').map(Number);
  return Date.UTC(y, m - 1, dd);
};
export const litDays = new Set(posts.map((p) => parseDate(p.date)));
export const todayUTC = () => {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
};
