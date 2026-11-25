// The site's pages besides home, rebuilt from the live site's structure:
// Blog (+ articles in the reader), Work, Learning, Software, Community,
// Resource center, Contact, Support and 404. Routes are real paths handled
// by the router in main.ts; serve.mjs answers every page path with index.html.
import { community, posts, sections, services, socials } from './content';
import type { Section } from './content';
import { lang, pick, t } from './i18n';
import { DAY, esc, litDays, pad2, todayUTC } from './util';

export type PageId = 'home' | 'blog' | 'work' | 'learning' | 'software' | 'community' | 'resources' | 'contact' | 'support' | '404';
export type Route = { page: PageId; slug?: string };

// Primary navigation, in the live site's order.
export const NAV: { page: PageId; path: string; key: string }[] = [
  { page: 'home', path: '/', key: 'nav.home' },
  { page: 'blog', path: '/blog', key: 'nav.blog' },
  { page: 'work', path: '/work', key: 'nav.work' },
  { page: 'learning', path: '/learning', key: 'nav.learning' },
  { page: 'software', path: '/software', key: 'nav.software' },
  { page: 'community', path: '/community', key: 'nav.community' },
  { page: 'resources', path: '/resources', key: 'nav.resources' },
];
export const EXTRA: { page: PageId; path: string; key: string }[] = [
  { page: 'contact', path: '/contact', key: 'nav.contact' },
  { page: 'support', path: '/support', key: 'nav.support' },
];

// Live-site section id → page here.
const SECTION_PAGE: Record<string, PageId> = { notes: 'blog', works: 'work', resources: 'learning', software: 'software', community: 'community', 'resource-center': 'resources' };
const PAGE_SECTION: Partial<Record<PageId, string>> = Object.fromEntries(Object.entries(SECTION_PAGE).map(([s, p]) => [p, s]));

export const pathOf = (page: PageId) => [...NAV, ...EXTRA].find((n) => n.page === page)?.path ?? '/';
export const sectionPath = (s: Section) => pathOf(SECTION_PAGE[s.id] ?? 'home');
export const postPath = (i: number) => `/blog/${posts[i].slug}`;

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (!parts.length) return { page: 'home' };
  if (parts[0] === 'blog' && parts.length === 2) return posts.some((p) => p.slug === parts[1]) ? { page: 'blog', slug: parts[1] } : { page: '404' };
  const hit = [...NAV, ...EXTRA].find((n) => n.path === `/${parts[0]}`);
  return hit && parts.length === 1 ? { page: hit.page } : { page: '404' };
}

const en = () => lang() === 'en';
const arrow = '<i aria-hidden="true">↗</i>';

function head(kicker: string, title: string, accent: string, body: string, side = '') {
  return `<header class="page-head container">
    <div class="heading">
      <p class="eyebrow"><i></i><span>${esc(kicker)}</span></p>
      <h1 class="page-title"><span class="split">${esc(title)}</span>${en() ? ' ' : ''}<em class="accent"><span class="split">${esc(accent)}</span></em></h1>
      <p class="body">${esc(body)}</p>
    </div>${side}
  </header>`;
}

// ---------------------------------------------------------------- shared pieces
export function postCard(i: number) {
  const p = posts[i];
  return `<article class="post"><a href="${postPath(i)}" data-post="${i}">
    <div class="post-media"><img src="${p.cover}" alt="" loading="lazy" decoding="async" draggable="false"><span class="post-chip">${esc(pick(p.category))}</span></div>
    <div class="post-body">
      <p class="post-tags">${p.tags.slice(0, 3).map((tag) => `<span>${esc(pick(tag))}</span>`).join('')}</p>
      <h3 class="post-title">${esc(pick(p.title))}</h3>
      <p class="post-text">${esc(pick(p.summary))}</p>
      <p class="post-foot"><span>${esc(p.date)}</span><i aria-hidden="true">↗</i></p>
    </div>
  </a></article>`;
}

const BOARD_ICONS: Record<string, string> = {
  qa: '<path d="M4 5h16v11H9l-5 4z"/><path d="M10 9.4a2 2 0 1 1 2.8 1.9c-.5.3-.8.7-.8 1.2"/><path d="M12 14.6h.01"/>',
  showcase: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="m3.5 16 5-5 4 4 3-3 5 5"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  tools: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  moments: '<path d="M20 4c-6 0-11 4-12 11l-3 5"/><path d="M8 15c4 0 7-2 9-6"/>',
};
export const boardsMarkup = () =>
  community.boards
    .map(
      (b, i) => `<article class="board">
        <p class="board-head"><span class="board-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${BOARD_ICONS[b.key] ?? ''}</svg></span><span>${pad2(i + 1)} / ${esc(t('community.board'))}</span></p>
        <h3>${esc(pick(b.name))}</h3>
        <p>${esc(pick(b.line))}</p>
      </article>`,
    )
    .join('');

// Publishing log: 26 weeks of days, lit where a post went live.
export function logMarkup() {
  const today = Math.max(todayUTC(), ...litDays);
  const end = today + (6 - new Date(today).getUTCDay()) * DAY;
  const weeks = 26;
  const start = end - (weeks * 7 - 1) * DAY;
  const months = en() ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] : ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  let cells = '';
  let lastMonth = -1;
  let count = 0;
  for (let w = 0; w < weeks; w++) {
    const first = start + w * 7 * DAY;
    const m = new Date(first).getUTCMonth();
    cells += `<span class="log-month" style="grid-column:${w + 1}">${m !== lastMonth ? months[m] : ''}</span>`;
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const time = first + d * DAY;
      const on = litDays.has(time);
      if (on) count++;
      const label = new Date(time).toISOString().slice(0, 10);
      cells += `<span class="log-day${on ? ' is-on' : ''}${time === today ? ' is-today' : ''}" style="grid-column:${w + 1};grid-row:${d + 2}" title="${label}${on ? ` · ${en() ? 'post published' : '发布文章'}` : ''}"></span>`;
    }
  }
  return { grid: `<div class="log-cols">${cells}</div>`, total: `<b>${pad2(count)}</b> ${esc(t('log.total'))}` };
}

// ---------------------------------------------------------------- blog
const blog = { category: 'all', query: '', view: 'grid' as 'grid' | 'list' };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function blogResults() {
  const q = norm(blog.query);
  return posts
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => blog.category === 'all' || p.category.zh === blog.category)
    .filter(({ p }) => !q || norm([p.title.en, p.title.zh, p.summary.en, p.summary.zh, ...p.tags.map((x) => `${x.en} ${x.zh}`)].join(' ')).includes(q));
}

function blogList() {
  const results = blogResults();
  const filtering = blog.category !== 'all' || blog.query.trim() !== '';
  const count = `<p class="blog-count" role="status">${esc(t('blog.count').replace('{n}', pad2(results.length)))}</p>`;
  if (!results.length) return `${count}<div class="empty-state"><p>${esc(t('blog.empty'))}</p><button class="btn ghost" type="button" data-blog-clear><span>${esc(t('blog.clear'))}</span></button></div>`;
  const [first, ...rest] = results;
  const feature = !filtering && blog.view === 'grid'
    ? `<a class="feature" href="${postPath(first.i)}" data-post="${first.i}">
        <div class="feature-media"><img src="${first.p.cover}" alt="" decoding="async" draggable="false"></div>
        <div class="feature-body">
          <p class="caption-meta">${esc(t('blog.latest'))} — ${esc(pick(first.p.category))} — ${esc(first.p.date)}</p>
          <h2 class="feature-title">${esc(pick(first.p.title))}</h2>
          <p class="body">${esc(pick(first.p.summary))}</p>
          <ul class="tags">${first.p.tags.map((tag) => `<li>${esc(pick(tag))}</li>`).join('')}</ul>
          <span class="btn primary"><span>${esc(t('work.read'))}</span><i aria-hidden="true">→</i></span>
        </div>
      </a>`
    : '';
  const items = feature ? rest : results;
  const list = blog.view === 'grid'
    ? `<div class="posts">${items.map(({ i }) => postCard(i)).join('')}</div>`
    : `<ol class="rows">${items
        .map(({ p, i }) => `<li><a href="${postPath(i)}" data-post="${i}"><span class="row-date">${esc(p.date)}</span><span class="row-main"><b>${esc(pick(p.title))}</b><small>${p.tags.slice(0, 3).map((x) => esc(pick(x))).join(' · ')}</small></span><span class="row-cat">${esc(pick(p.category))}</span>${arrow}</a></li>`)
        .join('')}</ol>`;
  return `${count}${feature}${list}`;
}

function blogPage() {
  const notes = sections.find((s) => s.id === 'notes')!;
  const categories = [...new Map(posts.map((p) => [p.category.zh, p.category])).values()];
  const chips = [{ value: 'all', label: t('blog.all') }, ...categories.map((c) => ({ value: c.zh, label: pick(c) }))]
    .map((c) => `<button type="button" class="chip-btn${blog.category === c.value ? ' is-on' : ''}" data-category="${esc(c.value)}" aria-pressed="${blog.category === c.value}">${esc(c.label)}</button>`)
    .join('');
  const latest = posts.map((p) => p.date).sort().at(-1) ?? '';
  const side = `<dl class="page-meta"><div><dt>${esc(t('hero.posts'))}</dt><dd>${pad2(posts.length)}</dd></div><div><dt>${esc(t('hero.latest'))}</dt><dd>${esc(latest)}</dd></div></dl>`;
  return `${head(`${en() ? 'Blog' : '博客'} / 01`, t('journal.title'), t('journal.accent'), pick(notes.description), side)}
  <div class="container page-body">
    <div class="blog-tools">
      <div class="chips" role="group" aria-label="${esc(t('blog.filter'))}">${chips}</div>
      <label class="field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" data-blog-search placeholder="${esc(t('blog.search'))}" aria-label="${esc(t('blog.search'))}" value="${esc(blog.query)}"></label>
      <div class="view-toggle" role="group" aria-label="${esc(t('blog.view'))}">
        <button type="button" data-view="grid" aria-pressed="${blog.view === 'grid'}">${esc(t('blog.grid'))}</button>
        <button type="button" data-view="list" aria-pressed="${blog.view === 'list'}">${esc(t('blog.list'))}</button>
      </div>
    </div>
    <div class="blog-results" data-blog-results>${blogList()}</div>
  </div>`;
}

function bindBlog(root: HTMLElement) {
  const results = root.querySelector<HTMLElement>('[data-blog-results]')!;
  const refresh = () => {
    results.innerHTML = blogList();
    root.dispatchEvent(new CustomEvent('page:content', { bubbles: true }));
  };
  root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((b) =>
    b.addEventListener('click', () => {
      blog.category = b.dataset.category!;
      root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((x) => {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      refresh();
    }),
  );
  root.querySelector<HTMLInputElement>('[data-blog-search]')!.addEventListener('input', (e) => {
    blog.query = (e.target as HTMLInputElement).value;
    refresh();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      blog.view = b.dataset.view as 'grid' | 'list';
      root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      refresh();
    }),
  );
  results.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('[data-blog-clear]')) return;
    blog.category = 'all';
    blog.query = '';
    root.querySelector<HTMLInputElement>('[data-blog-search]')!.value = '';
    root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((x) => {
      const on = x.dataset.category === 'all';
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', String(on));
    });
    refresh();
  });
}

// ---------------------------------------------------------------- sections not open yet
function sectionPage(page: PageId) {
  const id = PAGE_SECTION[page]!;
  const index = sections.findIndex((s) => s.id === id);
  const s = sections[index];
  const others = sections
    .filter((x) => x.id !== id)
    .map((x) => `<a class="other" href="${sectionPath(x)}"><span class="other-num">${pad2(sections.indexOf(x) + 1)}</span><b>${esc(pick(x.name))}</b><span class="archive-state${x.open ? ' is-open' : ''}">${esc(x.open ? `${t('index.open')} · ${pick(x.status)}` : pick(x.status))}</span></a>`)
    .join('');
  return `${head(`${s.name.en} / ${pad2(index + 1)}`, pick(s.name), en() ? '— in preparation.' : '· 整理中', pick(s.description), `<span class="status">${esc(pick(s.status))}</span>`)}
  <div class="container page-body">
    <div class="prep">
      <span class="prep-num" aria-hidden="true">${pad2(index + 1)}</span>
      <div class="prep-copy">
        <h2>${esc(t('page.prepTitle'))}</h2>
        <p class="body">${esc(t('page.prepBody'))}</p>
        <a class="btn primary" href="/blog" data-magnetic><span class="roll" data-roll="${esc(t('page.meanwhile'))}"></span><i aria-hidden="true">→</i></a>
      </div>
    </div>
    <h2 class="sub-title">${esc(t('page.others'))}</h2>
    <div class="others">${others}</div>
  </div>`;
}

// ---------------------------------------------------------------- community
// The main site only keeps an entrance to the community site and a live
// "pulse" of how active it is. The community is not open yet, so the pulse
// shows clearly labelled preview numbers; swap `communityPulse()` for the
// community's real stats once it launches.
export type Pulse = { live: boolean; online: number; hours: number[]; stats: { key: string; value: number; series: number[] }[] };

function sampleSeries(n: number, seed: number, peak: number) {
  let s = seed;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: n }, (_, i) => {
    const hour = (i / n) * 24;
    // Quiet before dawn, busy in the evening (China time).
    const day = Math.max(0, Math.sin(((hour - 7) / 24) * Math.PI * 2)) * 0.55 + Math.exp(-((hour - 21) ** 2) / 6) * 0.6 + 0.08;
    return Math.round(peak * Math.min(1, day * (0.75 + rand() * 0.5)));
  });
}

export function communityPulse(): Pulse {
  return {
    live: false,
    online: 128,
    hours: sampleSeries(96, 7, 100),
    stats: [
      { key: 'activity.posts', value: 36, series: sampleSeries(24, 11, 10) },
      { key: 'activity.replies', value: 214, series: sampleSeries(24, 23, 40) },
      { key: 'activity.checkins', value: 402, series: sampleSeries(24, 37, 60) },
      { key: 'activity.stardust', value: 18600, series: sampleSeries(24, 51, 3000) },
    ],
  };
}

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function ringMarkup(hours: number[]) {
  const max = Math.max(1, ...hours);
  const bars = hours
    .map((v, i) => {
      const a = (i / hours.length) * Math.PI * 2 - Math.PI / 2;
      const r0 = 58;
      const r1 = r0 + 4 + (v / max) * 30;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return `<line class="ring-bar" data-i="${i}" style="--v:${(v / max).toFixed(3)};--i:${i}" x1="${(c * r0).toFixed(2)}" y1="${(s * r0).toFixed(2)}" x2="${(c * r1).toFixed(2)}" y2="${(s * r1).toFixed(2)}"/>`;
    })
    .join('');
  const ticks = [0, 6, 12, 18]
    .map((h) => {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      return `<text class="ring-hour" x="${(Math.cos(a) * 98).toFixed(1)}" y="${(Math.sin(a) * 98 + 3).toFixed(1)}">${pad2(h)}</text>`;
    })
    .join('');
  return `<svg class="ring" viewBox="-110 -110 220 220" aria-hidden="true">
    <circle class="ring-track" r="52"/>
    <circle class="ring-pulse" r="40"/><circle class="ring-pulse" r="40"/>
    ${bars}${ticks}
    <g class="ring-hand"><line x1="0" y1="0" x2="0" y2="-94"/><circle cx="0" cy="-94" r="2.6"/></g>
  </svg>`;
}

function sparkline(series: number[]) {
  const max = Math.max(1, ...series);
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * 120).toFixed(1)},${(34 - (v / max) * 30).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true"><polyline class="spark-fill" points="0,36 ${pts} 120,36"/><polyline class="spark-line" pathLength="1" points="${pts}"/></svg>`;
}

function communityPage() {
  const pulse = communityPulse();
  const label = pulse.live ? t('activity.live') : t('activity.preview');
  return `${head(`Community / ${pad2(sections.findIndex((x) => x.id === 'community') + 1)}`, t('community.title'), t('community.accent'), pick(community.description), `<span class="status">${esc(pick(community.status))}</span>`)}
  <div class="container page-body">
    <a class="portal" href="${community.url}" target="_blank" rel="noopener" data-portal>
      <canvas class="portal-flow" aria-hidden="true"></canvas>
      <span class="portal-fill" aria-hidden="true"></span>
      <span class="portal-copy">
        <span class="portal-kicker"><i aria-hidden="true"></i>community.sansphase.com</span>
        <b class="portal-title">${esc(t('community.enter'))}</b>
        <span class="portal-note">${esc(t('community.entryNote'))}</span>
      </span>
      <span class="portal-button" aria-hidden="true">
        <svg class="portal-ring" viewBox="0 0 120 120"><defs><path id="portal-circle" d="M60 60m-46 0a46 46 0 1 1 92 0a46 46 0 1 1-92 0"/></defs><text><textPath href="#portal-circle" textLength="286">${esc(t('community.ring'))}</textPath></text></svg>
        <span class="portal-core">↗</span>
      </span>
    </a>
    <section class="pulse" aria-labelledby="pulse-title" data-pulse>
      <header class="pulse-head">
        <h2 id="pulse-title">${esc(t('activity.title'))}</h2>
        <span class="pulse-badge${pulse.live ? ' is-live' : ''}"><i aria-hidden="true"></i>${esc(label)}</span>
      </header>
      <div class="pulse-main">
        <div class="pulse-ring">
          ${ringMarkup(pulse.hours)}
          <div class="pulse-centre"><b data-count="${pulse.online}">${pulse.online}</b><span>${esc(t('activity.online'))}</span></div>
          <p class="pulse-caption">${esc(t('activity.hours'))}</p>
        </div>
        <dl class="pulse-stats">${pulse.stats
          .map((s) => `<div class="pulse-stat"><dt>${esc(t(s.key))}</dt><dd data-count="${s.value}">${fmt(s.value)}</dd>${sparkline(s.series)}</div>`)
          .join('')}</dl>
      </div>
      <canvas class="pulse-line" aria-hidden="true"></canvas>
    </section>
  </div>`;
}

// Hand on the current China-time hour, bars lighting up behind it, numbers
// counting in, and a heartbeat line where each spike is an event.
// Portal: particles drift in from the edges and spiral into the button; on
// hover a Klein fill floods out from the pointer and the stream speeds up.
function bindPortal(root: HTMLElement, reduced: boolean) {
  const portal = root.querySelector<HTMLAnchorElement>('[data-portal]');
  if (!portal) return;
  const setFrom = (e: PointerEvent) => {
    const r = portal.getBoundingClientRect();
    portal.style.setProperty('--fx', `${e.clientX - r.left}px`);
    portal.style.setProperty('--fy', `${e.clientY - r.top}px`);
  };
  portal.addEventListener('pointerenter', setFrom);
  portal.addEventListener('pointerleave', setFrom);
  const canvas = portal.querySelector<HTMLCanvasElement>('.portal-flow')!;
  const button = portal.querySelector<HTMLElement>('.portal-button')!;
  const ctx = canvas.getContext('2d');
  if (!ctx || reduced) return;
  type Mote = { a: number; r: number; speed: number; size: number; life: number };
  const motes: Mote[] = [];
  const spawn = (far: number): Mote => ({ a: Math.random() * Math.PI * 2, r: far * (0.55 + Math.random() * 0.6), speed: 0.25 + Math.random() * 0.5, size: 0.6 + Math.random() * 1.6, life: 0 });
  let hover = 0;
  let hot = false;
  portal.addEventListener('pointerenter', () => (hot = true));
  portal.addEventListener('pointerleave', () => (hot = false));
  let last = performance.now();
  const draw = (now: number) => {
    if (!canvas.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const pr = portal.getBoundingClientRect();
    const br = button.getBoundingClientRect();
    const cx = br.left + br.width / 2 - pr.left;
    const cy = br.top + br.height / 2 - pr.top;
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
    while (motes.length < 260) motes.push(spawn(far * (motes.length ? 1 : 0.5)));
    hover += ((hot ? 1 : 0) - hover) * Math.min(1, dt * 4);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const color = getComputedStyle(canvas).color;
    ctx.fillStyle = color;
    motes.forEach((m, i) => {
      const pull = (40 + m.speed * 90) * (1 + hover * 2.4);
      m.r -= pull * dt * (0.4 + 0.6 * (1 - m.r / far));
      m.a += dt * (0.25 + 26 / Math.max(28, m.r)) * (1 + hover);
      m.life = Math.min(1, m.life + dt * 1.5);
      if (m.r < br.width * 0.36) {
        motes[i] = spawn(far);
        return;
      }
      const x = cx + Math.cos(m.a) * m.r;
      const y = cy + Math.sin(m.a) * m.r * 0.62;
      const near = 1 - Math.min(1, m.r / far);
      ctx.globalAlpha = m.life * (0.3 + near * 0.7) * (0.6 + hover * 0.4);
      ctx.beginPath();
      ctx.arc(x, y, m.size * (0.6 + near), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function bindCommunity(root: HTMLElement, reduced: boolean) {
  bindPortal(root, reduced);
  const panel = root.querySelector<HTMLElement>('[data-pulse]');
  if (!panel) return;
  const hand = panel.querySelector<SVGGElement>('.ring-hand')!;
  const bars = Array.from(panel.querySelectorAll<SVGLineElement>('.ring-bar'));
  const china = () => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return (h % 24) + m / 60;
  };
  const place = () => {
    const now = china();
    // SVG rotate() turns around the viewBox origin, which is the ring's centre.
    hand.setAttribute('transform', `rotate(${((now / 24) * 360).toFixed(2)})`);
    const at = Math.floor((now / 24) * bars.length);
    bars.forEach((b, i) => {
      const age = (at - i + bars.length) % bars.length;
      b.classList.toggle('is-hot', age < 8);
      b.classList.toggle('is-now', age === 0);
    });
  };
  place();
  panel.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (reduced) return;
    const start = performance.now();
    const step = (t0: number) => {
      const k = Math.min(1, (t0 - start) / 1600);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 4))));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  if (!reduced) panel.classList.add('is-in');

  const canvas = panel.querySelector<HTMLCanvasElement>('.pulse-line')!;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const points: number[] = [];
  let spike = 0;
  let last = performance.now();
  let clock = 0;
  const draw = (now: number) => {
    if (!canvas.isConnected) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    const step = 3;
    const need = Math.ceil(w / step) + 2;
    // A new event every ~0.4–1.2 s draws a heartbeat-shaped spike.
    if (clock > 0.4 + Math.random() * 0.8) {
      clock = 0;
      spike = 6;
    }
    const shape = [0, -0.25, 0.9, -0.6, 0.2, 0];
    const v = spike > 0 ? shape[6 - spike] ?? 0 : (Math.random() - 0.5) * 0.04;
    if (spike > 0) spike--;
    points.push(v);
    while (points.length > need) points.shift();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const accent = getComputedStyle(canvas).color;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.7, accent);
    grad.addColorStop(1, accent);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = w - (points.length - 1 - i) * step;
      const y = h / 2 - p * (h * 0.42);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = accent;
    const tip = points[points.length - 1] ?? 0;
    ctx.beginPath();
    ctx.arc(w - 1, h / 2 - tip * (h * 0.42), 2.6, 0, Math.PI * 2);
    ctx.fill();
    if (Math.floor(now / 60000) !== Math.floor((now - dt * 1000) / 60000)) place();
    if (!reduced) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ---------------------------------------------------------------- contact & support
function contactPage() {
  const reach = socials
    .map((s, i) => `<a class="reach" href="${s.url}" target="_blank" rel="noopener"><span class="other-num">${pad2(i + 1)}</span><b>${esc(pick(s.label))}</b><span class="reach-go">${arrow}</span></a>`)
    .join('');
  return `${head(en() ? 'Contact' : '联系与合作', t('contact.title'), t('contact.accent'), pick(services.summary))}
  <div class="container page-body">
    <h2 class="sub-title">${esc(t('contact.services'))}</h2>
    <div class="systems">${services.items.map((x, i) => `<article class="system"><span class="other-num">${pad2(i + 1)}</span><h3>${esc(pick(x))}</h3></article>`).join('')}</div>
    <h2 class="sub-title">${esc(t('contact.reach'))}</h2>
    <div class="others reach-list">${reach}</div>
    <p class="page-note">${esc(t('contact.note'))}</p>
  </div>`;
}

function messagePage(kicker: string, title: string, accent: string, body: string) {
  return `${head(kicker, title, accent, body)}
  <div class="container page-body"><div class="page-actions">
    <a class="btn primary" href="/" data-magnetic><span class="roll" data-roll="${esc(t('nf.home'))}"></span><i aria-hidden="true">→</i></a>
    <a class="btn ghost" href="/blog" data-magnetic><span class="roll" data-roll="${esc(t('page.meanwhile'))}"></span><i aria-hidden="true">↗</i></a>
  </div></div>`;
}

// ---------------------------------------------------------------- entry
export function renderPage(page: PageId, root: HTMLElement, reduced = false) {
  const markup =
    page === 'blog' ? blogPage()
    : page === 'community' ? communityPage()
    : page === 'contact' ? contactPage()
    : page === 'support' ? messagePage(en() ? 'Support' : '赞助与支持', t('support.title'), t('support.accent'), t('support.body'))
    : page === '404' ? messagePage('404 / A little off track', t('nf.title'), t('nf.accent'), t('nf.body'))
    : sectionPage(page);
  root.innerHTML = `<div class="page" data-page="${page}">${markup}</div>`;
  if (page === 'blog') bindBlog(root);
  if (page === 'community') bindCommunity(root, reduced);
}

