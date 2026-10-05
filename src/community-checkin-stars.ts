// Calendar-month visualization. Only recorded dates light up, including make-ups.
import { checkinMonth, communityRules } from './community-rules.mjs';
import type { Translate } from './community.ts';

type Point = { x: number; y: number };
const rays = 'M0-15C.45-3.4 1.05-1.05 12 0C1.05 1.05 .45 3.4 0 15C-.45 3.4-1.05 1.05-12 0C-1.05-1.05-.45-3.4 0-15Z';
const star = `<svg class="community-star-glyph" viewBox="-16 -16 32 32" aria-hidden="true"><path class="community-star-rays" d="${rays}"/><path class="community-star-cross" d="M-6-6 6 6M6-6-6 6"/><circle class="community-star-heart" r="1.6"/></svg>`;
// Fixed anchors follow the reference's open, irregular constellation silhouette:
// local turns run in both axes, with unequal segment lengths and no branches.
// These are progress-map positions, not coordinates of an astronomical constellation.
const anchors: ReadonlyArray<readonly [number, number]> = [
  [20, 47], [15, 43], [10, 49], [8, 61], [12, 70], [18, 80],
  [28, 81], [34, 77], [39, 80], [44, 72], [45, 58], [50, 52],
  [51, 41], [57, 35], [55, 22], [60, 18], [66, 21], [70, 12],
  [77, 12], [80, 22], [85, 15], [89, 24], [92, 36], [88, 44],
  [83, 38], [78, 45], [75, 59], [80, 67], [88, 66], [93, 78], [93, 92],
];
const wideTrail: Point[] = anchors.map(([x, y]) => ({ x, y }));
// Rotate the same shape on narrow screens; never fold it into a grid.
const compactTrail: Point[] = anchors.map(([x, y]) => ({ x: 50 + (50 - y) * .92, y: x }));
const point = (day: number, compact: boolean): Point => (compact ? compactTrail : wideTrail)[day - 1];
// Stable, sparse background grains supply scale; they never count as check-in days.
const dust = Array.from({ length: 52 }, (_, i) => {
  const x = 3 + ((i * 61 + 17) % 94), y = 5 + ((i * 37 + 9) % 90);
  return `<i style="left:${x}%;top:${y}%;--grain-size:${i % 9 === 0 ? 1.8 : .8}px;opacity:${.12 + (i % 5) * .045}"></i>`;
}).join('');
const detailShift = (x: number) => x < 22 ? '0%' : x > 78 ? '-100%' : '-50%';

type MonthMap = { month: string; days: readonly string[]; today: string; owner?: boolean; monthBonus?: number };
export function checkinStarsHTML({ month, days, today, owner = false, monthBonus = 0 }: MonthMap, t: Translate): string {
  const attendance = checkinMonth(month, owner ? [] : days), count = attendance.totalDays;
  const signed = new Set(attendance.signed), litCount = signed.size;
  const key = (day: number) => attendance.dates[day - 1];
  const lit = (day: number) => signed.has(key(day));
  const isToday = (day: number) => !owner && key(day) === today;
  const inCurrentMonth = today.startsWith(`${month}-`), date = Number(today.slice(-2));
  const bonus = (day: number) => day === count ? communityRules.monthBonus : 0;
  const paths = (compact: boolean) => Array.from({ length: count - 1 }, (_, i) => {
    const a = point(i + 1, compact), b = point(i + 2, compact);
    const id = `checkin-light-${compact ? 'compact' : 'wide'}-${i}`;
    const on = lit(i + 1) && lit(i + 2), color = on ? 'var(--checkin-link-lit, #e9d4ac)' : 'var(--checkin-link-idle, #a6c4e5)';
    return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><stop offset="0" stop-color="${color}" stop-opacity=".1"/><stop offset=".22" stop-color="${color}" stop-opacity=".85"/><stop offset=".72" stop-color="${color}" stop-opacity=".6"/><stop offset="1" stop-color="${color}" stop-opacity=".1"/></linearGradient></defs>`
      + `<line class="community-star-link${on ? ' is-on' : isToday(i + 2) ? ' is-next' : ''}" stroke="url(#${id})" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
  }).join('');
  const stars = Array.from({ length: count }, (_, i) => {
    const day = i + 1, a = point(day, false), b = point(day, true);
    const state = lit(day) ? t('已点亮', 'Lit') : t('待点亮', 'Unlit');
    const label = t(`${month}-${String(day).padStart(2, '0')} · ${state}${bonus(day) ? ` · 本月满勤额外 +${bonus(day)} 星尘` : ''}`, `${key(day)} · ${state}${bonus(day) ? ` · Full-month bonus +${bonus(day)} stardust` : ''}`);
    return `<li class="community-cs${lit(day) ? ' is-on' : ''}${isToday(day) ? ' is-now' : ''}${bonus(day) ? ' is-bonus is-big' : ''}" data-day="${day}" data-detail-side="${a.y < 34 ? 'below' : 'above'}" data-compact-detail-side="${b.y < 32 ? 'below' : 'above'}" tabindex="0" aria-label="${label}" style="--star-x:${a.x}%;--star-y:${a.y}%;--compact-star-x:${b.x}%;--compact-star-y:${b.y}%;--star-size:${12 + (day * 7 % 5) * 1.4}px;--star-duration:${4.8 + day % 4}s;--star-delay:${-(day * .73)}s;--detail-shift:${detailShift(a.x)};--compact-detail-shift:${detailShift(b.x)}">`
      + `<span class="community-star-aura" aria-hidden="true"></span>${star}${isToday(day) ? '<span class="community-star-cursor" aria-hidden="true"></span>' : ''}`
      + `<span class="community-star-detail" aria-hidden="true"><b>${t(`${day} 日`, `Day ${day}`)}</b><span>${state}</span>${bonus(day) ? `<em>${t(`本月满勤 +${bonus(day)} 星尘`, `Full month +${bonus(day)} stardust`)}</em>` : ''}</span></li>`;
  }).join('');
  return `<div class="community-starfield">`
    + `<div class="community-star-status"><div class="community-star-current">${owner || !inCurrentMonth ? `${month}` : `<span>${t(`今天 · ${date} 日`, `Today · Day ${date}`)}</span><span class="community-star-state" data-lit="${lit(date)}">${lit(date) ? t('已点亮', 'Lit') : t('等待点亮', 'Ready to light')}</span>`}</div>`
    + `<span class="community-star-count">${t('已点亮', 'Lit')} <strong>${litCount}</strong><span> / ${count}</span></span></div>`
    + `<div class="community-constellation community-star-map" role="group" aria-label="${t(`${count} 天签到星座，已点亮 ${litCount} 颗`, `${count}-day check-in constellation, ${litCount} lit`)}">`
    + `<div class="community-star-dust" aria-hidden="true">${dust}</div>`
    + `<svg class="community-star-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g class="community-star-wide">${paths(false)}</g><g class="community-star-compact">${paths(true)}</g></svg>`
    + `<ol class="community-star-nodes">${stars}</ol></div>`
    + `<div class="community-star-rewards"><p>${t('自然月满勤奖励', 'Full-month bonus')}<span>${t('补签计入满勤', 'Make-ups count')}</span></p><ol class="community-star-milestones"><li data-day="${count}"${monthBonus ? ' class="is-on"' : ''}><span>${monthBonus ? t('已获得', 'Awarded') : t(`签满 ${count} 天额外获得`, `Complete all ${count} days for`)}</span><strong>+${communityRules.monthBonus}</strong></li></ol></div>`
    + `<div class="community-star-legend"><span class="is-on">${star}${t('已点亮', 'Lit')}</span><span class="is-now">${star}${t('今天', 'Today')}</span><span>${star}${t('待点亮', 'Unlit')}</span></div></div>`;
}
