// SANSPHASE portfolio, version 4. Home's section order and the navigation
// bar's structure follow the reference portfolio; the other pages rebuild the
// live site's pages (pages.ts) behind a small history router; the text wordmark, hero, heading
// treatment and motion are SANSPHASE's own. Content comes from
// content.ts (live public data); articles load through serve.mjs.
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/noto-sans-sc/index.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import 'lenis/dist/lenis.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { SRGBColorSpace, WebGLRenderer } from 'three';
import { Reader } from './article';
import { community, fields, icp, numbers, posts, profile, sections, services, socials } from './content';
import { EXTRA, NAV, boardsMarkup, logMarkup, parseRoute, postCard, postPath, renderPage, sectionPath } from './pages';
import type { PageId, Route } from './pages';
import { DAY, clamp, esc, pad2, parseDate, todayUTC } from './util';
import { ParticleGallery } from './gl/particles';
import { initialLang, lang, onLang, pick, setLang, t, ui } from './i18n';
import { runLoader } from './loader';
import { Palette, postKeywords, sectionKeywords } from './palette';
import type { Command } from './palette';
import { initTheme, setTheme, theme } from './theme';

gsap.registerPlugin(ScrollTrigger, SplitText);
// The intro always starts at the top (ScrollTrigger owns scroll restoration).
ScrollTrigger.clearScrollMemory('manual');
scrollTo(0, 0);

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const html = document.documentElement;
const en = () => lang() === 'en';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const params = new URLSearchParams(location.search);

initTheme();
setLang(initialLang());

const SEP = '<svg class="sep" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 6v28M6 20h28"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

// ---------------------------------------------------------------- text helpers
function setRoll(el: HTMLElement, text: string) {
  el.innerHTML = `<span class="roll-a">${esc(text)}</span><span class="roll-b" aria-hidden="true">${esc(text)}</span>`;
}

// SplitText remembers the markup it split, so revert every split before new
// text goes in; otherwise a revert would bring the old language back.
const splits = new Map<HTMLElement, SplitText>();
function revertSplits() {
  splits.forEach((s) => s.revert());
  splits.clear();
}
function pieces(el: HTMLElement) {
  const s = splits.get(el);
  if (!s) return [];
  return (en() ? s.words : s.chars) as HTMLElement[];
}
function split(el: HTMLElement) {
  splits.set(el, SplitText.create(el, en() ? { type: 'words', mask: 'words' } : { type: 'chars', mask: 'chars' }));
}

function applyI18n() {
  revertSplits();
  $$('[data-i18n]').forEach((el) => {
    const text = t(el.dataset.i18n!);
    if (el.classList.contains('roll')) setRoll(el, text);
    else el.textContent = text;
  });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria!)));
  $('#mod-key').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
}

// Heading groups: diamond marker, words rising from masks, the accent settling
// through Archivo's width axis over its ink band.
const groups = () => $$('.heading, .hero-copy, .banner-copy');
const fadeTargets = ':scope > .body, .hero-lead, .hero-actions, .hero-stats, .services, .banner-actions, .eyebrow span';
function prepareGroup(group: HTMLElement) {
  $$('.split', group).forEach(split);
  if (group.dataset.played || reduced) return;
  $$('.split', group).forEach((el) => gsap.set(pieces(el), { yPercent: 118 }));
  gsap.set($$('.eyebrow i', group), { scale: 0, rotate: -135 });
  gsap.set($$('.accent', group), { '--wd': 62, '--band': 0 });
  gsap.set($$(fadeTargets, group), { y: 16, opacity: 0 });
}
function playGroup(group: HTMLElement) {
  if (group.dataset.played) return;
  group.dataset.played = '1';
  if (reduced) return;
  const tl = gsap.timeline();
  tl.to($$('.eyebrow i', group), { scale: 1, rotate: 45, duration: 0.9, ease: 'back.out(2.2)' }, 0);
  let at = 0.12;
  $$('.split', group).forEach((el) => {
    const p = pieces(el);
    tl.to(p, { yPercent: 0, duration: 1.05, ease: 'expo.out', stagger: en() ? 0.055 : 0.03 }, at);
    at += 0.1 + p.length * (en() ? 0.05 : 0.025);
  });
  tl.to($$('.accent', group), { '--wd': 122, duration: 1.4, ease: 'expo.out' }, Math.max(0.2, at - 0.3));
  tl.to($$('.accent', group), { '--band': 1, duration: 0.9, ease: 'expo.inOut' }, at);
  tl.to($$(fadeTargets, group), { y: 0, opacity: 1, duration: 0.9, ease: 'expo.out', stagger: 0.07, clearProps: 'transform,opacity' }, 0.3);
}

// ---------------------------------------------------------------- builders
function buildHero() {
  $('#hero-lead').textContent = `${pick(profile.tagline)}${en() ? ' ' : ''}${t('hero.lead')}`;
  $('#hero-stats').innerHTML = [
    [t('hero.posts'), pad2(numbers.posts)],
    [t('hero.sections'), pad2(numbers.sections)],
    [t('hero.latest'), numbers.latest],
  ]
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
  $('#hero-ticks').innerHTML = posts.map((p, i) => `<button type="button" aria-label="${esc(pick(p.title))}" data-i="${i}"></button>`).join('');
  $$('#hero-ticks button').forEach((b) => b.addEventListener('click', () => heroGo(Number(b.dataset.i))));
  heroCaption(heroShown, false);

}

const marqueeChips = () => {
  const seen = new Set<string>();
  const out: string[] = [];
  fields.forEach((f) => out.push(pick(f.name)));
  posts.forEach((p) => p.tags.forEach((tag) => out.push(pick(tag))));
  services.items.forEach((s) => out.push(pick(s)));
  return out.filter((x) => (seen.has(x.toLowerCase()) ? false : (seen.add(x.toLowerCase()), true)));
};
const giantWords = () => (en() ? ['SANSPHASE', '無相', 'Formless', 'Taking shape', 'Case notes', 'Written while building'] : ['SANSPHASE', '無相', '无形', '成相', '复盘', '边做边记']);

function buildMarquee() {
  const chips = marqueeChips()
    .map((c) => `<span class="chip">${esc(c)}</span>`)
    .join('');
  const giant = giantWords()
    .map((w) => `<span class="giant-word"><span class="o">${esc(w)}</span><span class="f" aria-hidden="true">${esc(w)}</span>${SEP}</span>`)
    .join('');
  // The first copy is read; the two loop copies are hidden from assistive tech.
  $('#marquee-chips').innerHTML = `${chips}<span class="marquee-copy" aria-hidden="true">${chips}${chips}</span>`;
  $('#marquee-giant').innerHTML = giant + giant + giant;
  marquees.forEach((m) => m.measure());
}

const bentoLayout = ['tall', 'wide', 'wide'];
const bentoCover = [0, 1, -1];
let bentoPlayed = false;
function buildBento() {
  $('#bento').innerHTML = fields
    .map((f, i) => {
      const postIndex = bentoCover[i] ?? -1;
      const post = postIndex >= 0 ? posts[postIndex] : null;
      const media = post ? `<div class="card-media"><img src="${post.cover}" alt="" loading="lazy" decoding="async" draggable="false"></div>` : '<div class="card-empty"></div>';
      const count = f.posts.length ? `${pad2(f.posts.length)} ${t('fields.posts')}` : t('fields.soon');
      const cta = post ? t('fields.open') : t('nav.cta');
      const other = en() ? 'zh-CN' : 'en';
      return `<article class="cell ${bentoLayout[i] ?? 'wide'}"><div class="cell-reveal"><div class="card">
        ${media}<span class="card-lamp" aria-hidden="true"></span>
        <p class="card-meta"><span>${pad2(i + 1)}</span><span class="rule"></span><span><span lang="${other}">${esc(en() ? f.name.zh : f.name.en)}</span> · ${esc(count)}</span></p>
        <div class="card-body">
          <h3 class="card-title">${esc(pick(f.name))}</h3>
          <p class="card-text">${esc(pick(f.line))}</p>
          <button class="card-cta" type="button" data-post="${postIndex}">${esc(cta)} <span aria-hidden="true">↗</span></button>
        </div>
      </div></div></article>`;
    })
    .join('');
  $$('.cell').forEach((cell) => {
    const card = cell.querySelector<HTMLElement>('.card')!;
    card.addEventListener('click', () => {
      const p = Number(card.querySelector<HTMLElement>('.card-cta')!.dataset.post);
      if (p >= 0) openArticle(p);
      else jumpTo('contact');
    });
    tilt(card, card);
  });
  if (!bentoPlayed && !reduced) gsap.set('.cell-reveal', { clipPath: 'inset(100% 0% 0% 0% round 20px)' });
}

function buildWork() {
  $('#screens').innerHTML = posts
    .map(
      (p, i) => `<figure class="screen" data-i="${i}">
        <div class="screen-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="url">sansphase.com/blog/${esc(p.slug)}</span></div>
        <div class="screen-img"><img src="${p.cover}" alt="${esc(pick(p.title))}" loading="lazy" decoding="async" draggable="false"></div>
      </figure>`,
    )
    .join('');
  $('#work-total').textContent = pad2(posts.length);
  $$('.screen').forEach((s) =>
    s.addEventListener('click', () => {
      if (dragged) return;
      const i = Number(s.dataset.i);
      if (i === workActive) openArticle(i);
      else workGo(i);
    }),
  );
  previousD.clear();
  layoutScreens(0);
  workCaption(false);
  if (!screensPlayed && !reduced) {
    gsap.set('#screens', { y: 80 });
    gsap.set('.screen', { opacity: 0 });
  }
}

function odometer(text: string) {
  const reels = Array.from(text)
    .map((c) => (/\d/.test(c) ? `<span class="reel" data-d="${c}">${'0123456789'.split('').map((d) => `<i>${d}</i>`).join('')}</span>` : `<span>${esc(c)}</span>`))
    .join('');
  return `<span class="odo" aria-hidden="true">${reels}</span><span class="visually-hidden">${esc(text)}</span>`;
}

let factsPlayed = false;
function buildFacts() {
  const days = Math.max(0, Math.round((todayUTC() - parseDate(numbers.latest)) / DAY));
  const tagCount = numbers.tags;
  const viz = [
    posts.map(() => '<i class="on"></i>').join(''),
    Array.from({ length: tagCount }, () => '<i class="tag on"></i>').join(''),
    `${sections.map((s) => `<i class="${s.open ? 'on' : ''}"></i>`).join('')}<span>&nbsp;${esc(t('facts.open').replace('{n}', String(sections.filter((s) => s.open).length)))}</span>`,
    `<span>${days === 0 ? esc(t('facts.today')) : `${days} ${esc(t('facts.daysAgo'))}`}</span>`,
  ];
  $('#facts-grid').innerHTML = [
    [pad2(numbers.posts), 'numbers.posts'],
    [pad2(numbers.tags), 'numbers.tags'],
    [pad2(numbers.sections), 'numbers.sections'],
    [numbers.latest, 'numbers.latest'],
  ]
    .map(
      ([value, key], i) =>
        `<div class="fact"><span class="fact-index" aria-hidden="true">${pad2(i + 1)}<b>${pad2(i + 1)}</b></span><div class="fact-value">${odometer(value)}</div><div class="fact-label">${esc(t(key))}</div><div class="fact-viz" aria-hidden="true">${viz[i]}</div></div>`,
    )
    .join('');
  if (factsPlayed || reduced) rollOdometers(true);
}

let manifestoWords: HTMLElement[] = [];
let manifestoProgress = 0;
function buildManifesto() {
  const keys = en() ? profile.bioKeys.en : profile.bioKeys.zh;
  const text = profile.bio.map((b) => pick(b)).join(en() ? ' ' : '');
  const units = en() ? text.split(' ') : Array.from(text);
  let markup: string;
  if (en()) {
    markup = units.map((w) => `<span class="mw${keys.some((k) => w.startsWith(k.replace('.', ''))) ? ' key' : ''}">${esc(w)}</span>`).join(' ');
  } else {
    const marks = new Array<boolean>(units.length).fill(false);
    keys.forEach((k) => {
      for (let at = text.indexOf(k); at >= 0; at = text.indexOf(k, at + k.length)) {
        for (let j = at; j < at + k.length; j++) marks[j] = true;
      }
    });
    markup = units.map((c, i) => `<span class="mw${marks[i] ? ' key' : ''}">${esc(c)}</span>`).join('');
  }
  $('#manifesto-text').innerHTML = markup;
  const alt = $('#manifesto-alt');
  alt.textContent = en() ? profile.bio.map((b) => b.zh).join('') : profile.bio.map((b) => b.en).join(' ');
  alt.lang = en() ? 'zh-CN' : 'en';
  manifestoWords = $$('#manifesto-text .mw');
  lightManifesto(reduced ? 1 : manifestoProgress);
}

function buildCommunity() {
  $('#community-status').textContent = pick(community.status);
  $('#community-desc').textContent = pick(community.description);
  $('#club-stats').innerHTML = [
    [pad2(community.boards.length), t('community.boardsCount')],
    [pad2(community.systems.length), t('community.systemsCount')],
  ]
    .map(([v, k]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
  $('#club-cta').textContent = pick(community.status);
  $('#boards').innerHTML = boardsMarkup();
  $$('.board').forEach((b) => glare(b));
  $('#log-systems').innerHTML = community.systems.map((s) => `<span><b>${esc(pick(s.name))}</b>${esc(pick(s.line))}</span>`).join('');
  buildLog();
}

function buildLog() {
  const log = logMarkup();
  const grid = $('#log-grid');
  grid.innerHTML = log.grid;
  $('#log-total').innerHTML = log.total;
  // Newest weeks first on narrow screens.
  requestAnimationFrame(() => (grid.scrollLeft = grid.scrollWidth));
}

function buildJournal() {
  $('#posts').innerHTML = [0, 1, 2].map(postCard).join('');
}

function buildArchive() {
  $('#archive-map').innerHTML = sections.map((s) => `<i class="${s.open ? 'is-open' : ''}"></i>`).join('');
  $('#archive-list').innerHTML = sections
    .map(
      (s, i) => `<li><a href="${sectionPath(s)}" data-i="${i}">
        <span class="archive-num">${pad2(i + 1)}</span>
        <span><span class="archive-name">${esc(pick(s.name))}</span><span class="archive-desc">${esc(pick(s.description))}</span></span>
        <span class="archive-state${s.open ? ' is-open' : ''}">${esc(s.open ? `${t('index.open')} · ${pick(s.status)}` : pick(s.status))}</span>
        <span class="archive-arrow" aria-hidden="true">→</span>
      </a></li>`,
    )
    .join('');
  const tiles = $$('#archive-map i');
  $$('#archive-list a').forEach((a) => {
    const i = Number(a.dataset.i);
    const on = () => tiles[i]?.classList.add('is-hot');
    const off = () => tiles[i]?.classList.remove('is-hot');
    a.addEventListener('pointerenter', on);
    a.addEventListener('pointerleave', off);
    a.addEventListener('focus', on);
    a.addEventListener('blur', off);
  });
}

function buildContact() {
  $('#contact-summary').textContent = pick(services.summary);
  $('#services').innerHTML = services.items.map((s) => `<li>${esc(pick(s))}</li>`).join('');
  $('#banner-actions').innerHTML = `
    <a class="btn primary" href="${socials[1].url}" target="_blank" rel="noopener" data-magnetic><span class="roll"></span><i aria-hidden="true">↗</i></a>
    <a class="btn ghost" href="${socials[0].url}" target="_blank" rel="noopener" data-magnetic><span class="roll"></span><i aria-hidden="true">↗</i></a>`;
  const rolls = $$('#banner-actions .roll');
  setRoll(rolls[0], t('contact.qq'));
  setRoll(rolls[1], t('contact.douyin'));
}

const PAGES = [...NAV, ...EXTRA];
function buildNav() {
  $('#nav-list').innerHTML = NAV.map((n) => `<li><a href="${n.path}" data-page="${n.page}"><span class="roll"></span></a></li>`).join('');
  $$('#nav-list a').forEach((a, i) => setRoll(a.querySelector<HTMLElement>('.roll')!, t(NAV[i].key)));
  $$('#links li').forEach((li) => {
    li.addEventListener('pointerenter', () => movePill(li));
    li.addEventListener('focusin', (e) => (e.target as HTMLElement).matches(':focus-visible') && movePill(li));
  });
}
function buildFooter() {
  $('#footer-tagline').textContent = pick(profile.tagline);
  $('#footer-sign').textContent = profile.signature;
  const links = PAGES.map((n, i) => `<li><a href="${n.path}" data-page="${n.page}"><small>${pad2(i + 1)}</small>${esc(t(n.key))}</a></li>`).join('');
  $('#footer-links').innerHTML = links;
  $('#menu-links').innerHTML = links;
  $('#footer-connect').innerHTML = [
    `<li><a href="${socials[0].url}" target="_blank" rel="noopener">${ARROW}${esc(pick(socials[0].label))}</a></li>`,
    `<li><a href="${socials[1].url}" target="_blank" rel="noopener">${ARROW}${esc(pick(socials[1].label))}</a></li>`,
    `<li><a href="https://www.sansphase.com/" target="_blank" rel="noopener">${ARROW}${esc(t('footer.site'))} · sansphase.com</a></li>`,
  ].join('');
  const icpLink = $<HTMLAnchorElement>('#icp');
  icpLink.textContent = icp.text;
  icpLink.href = icp.url;
}

function renderAll() {
  applyI18n();
  buildNav();
  buildHero();
  buildMarquee();
  buildBento();
  buildWork();
  buildFacts();
  buildManifesto();
  buildCommunity();
  buildJournal();
  buildArchive();
  buildContact();
  buildFooter();
  renderCurrentPage();
  groups().forEach(prepareGroup);
  $$('.heading', viewPage).forEach(playGroup);
  hideReveals();
  bindJumps();
  bindMagnetic();
  markCurrent(viewShown ?? 'home');
}

// ---------------------------------------------------------------- interactions
// Pointer tilt with a moving glare (CSS variables on the target).
function tilt(area: HTMLElement, target: HTMLElement, strength = 1) {
  if (!finePointer || reduced) return;
  area.addEventListener('pointermove', (e) => {
    const r = area.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    target.style.setProperty('--px', ((x - 0.5) * 2 * strength).toFixed(3));
    target.style.setProperty('--py', ((y - 0.5) * 2 * strength).toFixed(3));
    target.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    target.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
  });
  area.addEventListener('pointerleave', () => {
    target.style.setProperty('--px', '0');
    target.style.setProperty('--py', '0');
  });
}
function glare(el: HTMLElement) {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', `${e.clientX - r.left}px`);
    el.style.setProperty('--gy', `${e.clientY - r.top}px`);
  });
}
// Buttons lean toward the pointer, and their fill grows from the entry point.
function bindMagnetic() {
  if (!finePointer || reduced) return;
  $$('[data-magnetic]').forEach((el) => {
    if (el.dataset.bound === 'mag') return;
    el.dataset.bound = 'mag';
    el.addEventListener('pointerenter', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--bx', `${e.clientX - r.left}px`);
      el.style.setProperty('--by', `${e.clientY - r.top}px`);
    });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.translate = `${((e.clientX - r.left - r.width / 2) * 0.22).toFixed(1)}px ${((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--bx', `${e.clientX - r.left}px`);
      el.style.setProperty('--by', `${e.clientY - r.top}px`);
      el.style.translate = '';
    });
  });
}

// ---------------------------------------------------------------- scroll
const lenis = new Lenis({ lerp: reduced ? 1 : 0.1, smoothWheel: !reduced });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

function jumpTo(id: string) {
  closeMenu();
  closeArticle();
  lenis.scrollTo(id === 'top' ? 0 : `#${id}`, { offset: id === 'top' ? 0 : -72, duration: reduced ? 0 : 1.4, immediate: reduced });
}
function bindJumps() {
  $$<HTMLAnchorElement>('[data-jump]').forEach((a) => {
    if (a.dataset.jumpBound) return;
    a.dataset.jumpBound = '1';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      jumpTo(a.dataset.jump!);
    });
  });
}

// Header: docks into a glass capsule after the top, hides going down.
const header = $('#header');
let headerFocus = false;
let menuOpen = false;
lenis.on('scroll', (l: Lenis) => {
  const y = l.scroll;
  header.classList.toggle('is-docked', y > 24);
  if (menuOpen || headerFocus) header.classList.remove('is-hidden');
  else if (l.direction === 1 && y > 480) header.classList.add('is-hidden');
  else if (l.direction === -1) header.classList.remove('is-hidden');
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const p = clamp(0, 1, y / max);
  gsap.set('#progress', { scaleX: p });
  $('#top-ring').style.strokeDashoffset = String(1 - p);
});
header.addEventListener('focusin', (e) => {
  if ((e.target as HTMLElement).matches(':focus-visible')) {
    headerFocus = true;
    header.classList.remove('is-hidden');
  }
});
header.addEventListener('focusout', (e) => {
  if (!header.contains(e.relatedTarget as Node | null)) headerFocus = false;
});
addEventListener('pointermove', (e) => {
  if (finePointer && e.clientY < 36) header.classList.remove('is-hidden');
});

// One capsule glides between hovered or focused links; the current-section
// bar springs between links.
const pill = $('#pill');
const linksBox = $('#links');
let pillOn = false;
function movePill(li: HTMLElement) {
  if (!pillOn) pill.classList.add('is-instant');
  pill.style.setProperty('--l', `${li.offsetLeft}px`);
  pill.style.setProperty('--w', `${li.offsetWidth}px`);
  if (!pillOn) {
    void pill.offsetWidth;
    pill.classList.remove('is-instant');
  }
  pill.classList.add('is-on');
  pillOn = true;
}
function hidePill() {
  pill.classList.remove('is-on');
  pillOn = false;
}
linksBox.addEventListener('pointerleave', hidePill);
linksBox.addEventListener('focusout', (e) => !linksBox.contains(e.relatedTarget as Node | null) && hidePill());

function markCurrent(page: PageId) {
  let found: HTMLElement | null = null;
  $$<HTMLAnchorElement>('a[data-page]').forEach((a) => {
    const on = a.dataset.page === page;
    a.classList.toggle('is-current', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    if (on && a.closest('#links')) found = a.parentElement;
  });
  const bar = $('#current');
  const li = found as HTMLElement | null;
  if (li) bar.style.setProperty('--cl', `${li.offsetLeft + li.offsetWidth / 2}px`);
  bar.style.opacity = li ? '1' : '0';
}

// Mobile menu: a circle opens from the burger; the page behind is inert and
// Tab stays inside the burger + menu.
const burger = $('#burger');
const menu = $('#menu');
function menuTrap(e: KeyboardEvent) {
  if (e.key !== 'Tab') return;
  const targets = [burger, ...$$('a, button', menu)];
  const first = targets[0];
  const last = targets[targets.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
function openMenu() {
  const r = burger.getBoundingClientRect();
  menu.style.setProperty('--mx', `${r.left + r.width / 2}px`);
  menu.style.setProperty('--my', `${r.top + r.height / 2}px`);
  menu.style.setProperty('--mr', `${Math.hypot(innerWidth, innerHeight) + 80}px`);
  menuOpen = true;
  menu.classList.add('is-open');
  menu.setAttribute('aria-hidden', 'false');
  burger.setAttribute('aria-expanded', 'true');
  $('#main').inert = true;
  $('#footer').inert = true;
  lenis.stop();
  document.addEventListener('keydown', menuTrap);
  if (!reduced) gsap.fromTo('#menu-links li', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.05, delay: 0.2, clearProps: 'transform,opacity' });
  requestAnimationFrame(() => menu.querySelector<HTMLElement>('a')?.focus({ preventScroll: true }));
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  const hadFocus = menu.contains(document.activeElement);
  menu.classList.remove('is-open');
  menu.setAttribute('aria-hidden', 'true');
  burger.setAttribute('aria-expanded', 'false');
  $('#main').inert = false;
  $('#footer').inert = false;
  document.removeEventListener('keydown', menuTrap);
  if (!reader.open) lenis.start();
  if (hadFocus) burger.focus({ preventScroll: true });
}
burger.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
matchMedia('(min-width: 1024px)').addEventListener('change', (e) => e.matches && closeMenu());

// Theme and language.
$('#theme').addEventListener('click', (e) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  setTheme(theme() === 'dark' ? 'light' : 'dark', { x: r.left + r.width / 2, y: r.top + r.height / 2 }, reduced);
});
$$('#lang, #menu-lang').forEach((b) => b.addEventListener('click', () => setLang(en() ? 'zh' : 'en')));
onLang(() => {
  renderAll();
  setDocTitle(viewShown ?? 'home');
  if (reader.open) reader.fill();
  ScrollTrigger.refresh();
});
$$('#open-palette, #open-palette-icon').forEach((b) =>
  b.addEventListener('click', () => {
    closeMenu();
    palette.show();
  }),
);

// Pointer position, for the hero cover's crater (the system cursor stays as is).
const pointer = { x: -100, y: -100, inside: false };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
});
document.addEventListener('pointerleave', () => (pointer.inside = false));

// ---------------------------------------------------------------- hero cover
const heroWindow = $('#hero-window');
const heroMedia = $('#hero-media');
const heroCanvas = $<HTMLCanvasElement>('#hero-canvas');
const loading = { fonts: 0, covers: 0 };
let heroGL: { renderer: WebGLRenderer; gallery: ParticleGallery } | null = null;
let heroShown = 0;
const heroState = { f: 0, scatter: 1 };
let heroTween: gsap.core.Tween | null = null;
let heroPending: number | null = null;
let heroHover = false;
let heroFocus = false;
let heroPaused = reduced;
try {
  if (params.has('static')) throw new Error('static');
  const renderer = new WebGLRenderer({ canvas: heroCanvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  // The first cover repeats at the end so the cycle can morph last → first.
  const gallery = new ParticleGallery([...posts.map((p) => p.cover), posts[0].cover], () => (loading.covers = 1));
  heroGL = { renderer, gallery };
} catch {
  heroWindow.classList.add('is-static');
  loading.covers = 1;
}

function heroCaption(i: number, animate = true) {
  const p = posts[i];
  $('#hero-url').textContent = `sansphase.com/blog/${p.slug}`;
  $('#hero-kicker').textContent = `${pad2(i + 1)} / ${pad2(posts.length)} — ${pick(p.category)} — ${p.date}`;
  const link = $<HTMLAnchorElement>('#hero-caption');
  link.textContent = pick(p.title);
  link.href = p.url;
  $<HTMLImageElement>('#hero-fallback').src = p.cover;
  $$('#hero-ticks button').forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  if (animate && !reduced) gsap.fromTo('.window-caption > *', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out', stagger: 0.05, clearProps: 'transform,opacity' });
}

const HERO_HOLD = 6.5;
let heroClock = 0;
function heroGo(target: number) {
  const n = posts.length;
  const next = ((target % n) + n) % n;
  if (heroTween?.isActive()) {
    heroPending = next;
    return;
  }
  const from = heroShown;
  if (next === from) return;
  heroClock = 0;
  if (!heroGL) {
    heroShown = next;
    heroCaption(next);
    return;
  }
  // Forward morph through the textures; wrap from the last to the first via the copy.
  const to = next === 0 && from === n - 1 ? n : next;
  heroState.f = from;
  heroTween = gsap.to(heroState, {
    f: to,
    duration: reduced ? 0.01 : 1.5 + Math.abs(to - from) * 0.25,
    ease: 'power2.inOut',
    onUpdate: () => {
      const shown = Math.round(heroState.f) % n;
      if (shown !== heroShown) {
        heroShown = shown;
        heroCaption(shown);
      }
    },
    onComplete: () => {
      heroState.f = next;
      heroShown = next;
      if (heroPending !== null) {
        const p = heroPending;
        heroPending = null;
        heroGo(p);
      }
    },
  });
}
heroWindow.addEventListener('click', () => openArticle(heroShown));
$('#hero-caption').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  openArticle(heroShown);
});
heroWindow.addEventListener('pointerenter', () => {
  heroHover = true;
  reader.prefetch(heroShown);
});
heroWindow.addEventListener('pointerleave', () => (heroHover = false));
const heroStage = $('#hero-stage');
heroStage.addEventListener('focusin', (e) => (e.target as HTMLElement).matches(':focus-visible') && (heroFocus = true));
heroStage.addEventListener('focusout', (e) => !heroStage.contains(e.relatedTarget as Node | null) && (heroFocus = false));
tilt(heroStage, $('#scene'), 1);
function setPaused(button: HTMLElement, paused: boolean) {
  button.setAttribute('aria-pressed', String(paused));
}
const heroPause = $('#hero-pause');
setPaused(heroPause, heroPaused);
heroPause.addEventListener('click', () => {
  heroPaused = !heroPaused;
  setPaused(heroPause, heroPaused);
});

function sizeHero() {
  if (!heroGL) return;
  const r = heroMedia.getBoundingClientRect();
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  const w = heroMedia.clientWidth;
  const h = heroMedia.clientHeight;
  if (heroCanvas.width !== Math.round(w * pr) || heroCanvas.height !== Math.round(h * pr)) {
    heroGL.renderer.setPixelRatio(pr);
    heroGL.renderer.setSize(w, h, false);
  }
  heroGL.gallery.layout({ x: r.left, y: r.top, w, h }, pr);
}

// ---------------------------------------------------------------- marquee
class Marquee {
  x = 0;
  third = 1;
  skew = 0;
  slow = 1;
  constructor(
    readonly el: HTMLElement,
    readonly dir: number,
    readonly base: number,
  ) {
    el.addEventListener('pointerenter', () => (this.slow = 0.15));
    el.addEventListener('pointerleave', () => (this.slow = 1));
  }
  measure() {
    this.third = Math.max(1, this.el.scrollWidth / 3);
  }
  update(dt: number, velocity: number) {
    const speed = (this.base + Math.abs(velocity) * 4) * this.slow;
    this.x += this.dir * speed * dt;
    if (this.x <= -this.third) this.x += this.third;
    if (this.x > 0) this.x -= this.third;
    this.skew += (clamp(-7, 7, velocity * 0.25 * this.dir) - this.skew) * Math.min(1, dt * 6);
    this.el.style.transform = `translate3d(${this.x.toFixed(2)}px,0,0) skewX(${this.skew.toFixed(2)}deg)`;
  }
}
const marquees = [new Marquee($('#marquee-chips'), -1, 42), new Marquee($('#marquee-giant'), 1, 30)];
const giantRow = $('#marquee-giant');
giantRow.addEventListener('pointermove', (e) => {
  $$('.giant-word', giantRow).forEach((w) => {
    const r = w.getBoundingClientRect();
    w.style.setProperty('--mx', `${e.clientX - r.left - 16}px`);
    w.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});
giantRow.addEventListener('pointerleave', () => $$('.giant-word', giantRow).forEach((w) => w.style.setProperty('--mx', '-999px')));

// ---------------------------------------------------------------- cases carousel
let workActive = 0;
let dragged = false;
let workTween: gsap.core.Tween | null = null;
let workInView = false;
let workHover = false;
let workFocus = false;
let workPaused = reduced;
let screensPlayed = false;
const workBar = { p: 0 };
const previousD = new Map<number, number>();
const stage = $('#stage');

// shift: a fractional offset while the pointer drags (−1 … 1).
function layoutScreens(shift = 0) {
  const n = posts.length;
  $$('.screen').forEach((s, i) => {
    let d = i - workActive + shift;
    while (d > n / 2) d -= n;
    while (d <= -n / 2) d += n;
    const ad = Math.abs(d);
    const prev = previousD.get(i);
    // A card that wraps around jumps without sweeping across the stage.
    const jump = prev !== undefined && Math.abs(prev - d) > 1.5;
    if (jump) s.style.transition = 'none';
    s.style.transform = `translate(-50%, -50%) translateX(${d * 64}%) translateZ(${-ad * 280}px) rotateY(${-d * 26}deg)`;
    s.style.opacity = String(ad <= 1 ? 1 - 0.4 * ad : 0.6 * clamp(0, 1, 2 - ad));
    s.style.filter = ad > 0.5 ? 'saturate(0.55) brightness(0.7)' : 'none';
    s.style.zIndex = String(10 - Math.round(ad));
    s.style.pointerEvents = ad >= 1.5 ? 'none' : 'auto';
    s.classList.toggle('is-active', Math.round(d) === 0);
    if (jump) {
      void s.offsetWidth;
      s.style.transition = '';
    }
    previousD.set(i, d);
  });
}
function workCaption(animate = true) {
  const p = posts[workActive];
  $('#work-current').textContent = pad2(workActive + 1);
  $('#stage-num').textContent = pad2(workActive + 1);
  $('#work-meta').textContent = `${t('work.of')} ${pad2(workActive + 1)} — ${pick(p.category)} — ${p.date}`;
  $('#work-title').textContent = pick(p.title);
  $('#work-summary').textContent = pick(p.summary);
  $('#work-tags').innerHTML = p.tags.map((tag) => `<li>${esc(pick(tag))}</li>`).join('');
  if (!animate || reduced) return;
  gsap.fromTo('#work-caption .caption-main > :not(.caption-bar), #work-caption .caption-side > *', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.05, clearProps: 'transform,opacity' });
  gsap.fromTo('#stage-num', { yPercent: 30, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.9, ease: 'expo.out' });
}
function workGo(i: number) {
  const n = posts.length;
  workActive = ((i % n) + n) % n;
  layoutScreens(0);
  workCaption();
  startWorkTimer();
}
const workShouldRun = () => workInView && !workHover && !workFocus && !workPaused && !reader.open;
function syncWorkTimer() {
  if (workShouldRun()) workTween?.resume();
  else workTween?.pause();
  // Announce caption changes only when the user is driving the carousel.
  $('#work-caption').setAttribute('aria-live', workShouldRun() ? 'off' : 'polite');
}
function startWorkTimer() {
  workTween?.kill();
  workBar.p = 0;
  gsap.set('#work-bar', { scaleX: 0 });
  workTween = gsap.to(workBar, {
    p: 1,
    duration: 7,
    ease: 'none',
    paused: !workShouldRun(),
    onUpdate: () => gsap.set('#work-bar', { scaleX: workBar.p }),
    onComplete: () => workGo(workActive + 1),
  });
}
$('#work-prev').addEventListener('click', () => workGo(workActive - 1));
$('#work-next').addEventListener('click', () => workGo(workActive + 1));
$('#work-open').addEventListener('click', () => openArticle(workActive));
const workPause = $('#work-pause');
setPaused(workPause, workPaused);
workPause.addEventListener('click', () => {
  workPaused = !workPaused;
  setPaused(workPause, workPaused);
  syncWorkTimer();
});
stage.addEventListener('pointerenter', () => {
  workHover = true;
  syncWorkTimer();
});
stage.addEventListener('pointerleave', () => {
  workHover = false;
  syncWorkTimer();
});
$$('#work .carousel-nav, #work-caption').forEach((el) => {
  el.addEventListener('focusin', (e) => {
    if (!(e.target as HTMLElement).matches(':focus-visible')) return;
    workFocus = true;
    syncWorkTimer();
  });
  el.addEventListener('focusout', (e) => {
    if (el.contains(e.relatedTarget as Node | null)) return;
    workFocus = false;
    syncWorkTimer();
  });
});
// Live drag: the screens follow the pointer and commit on release.
const drag = { x: 0, y: 0, id: -1, tracking: false, scrubbing: false };
stage.addEventListener('dragstart', (e) => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.id = e.pointerId;
  drag.tracking = true;
  drag.scrubbing = false;
  dragged = false;
});
stage.addEventListener('pointermove', (e) => {
  if (!drag.tracking || e.pointerId !== drag.id) return;
  if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
    if (drag.scrubbing) endDrag(e);
    else drag.tracking = false;
    return;
  }
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.scrubbing) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    drag.scrubbing = true;
    dragged = true;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-scrub');
    workTween?.pause();
  }
  const width = stage.querySelector<HTMLElement>('.screen.is-active')?.offsetWidth ?? stage.offsetWidth * 0.6;
  layoutScreens(clamp(-1, 1, dx / (width * 0.64)));
});
function endDrag(e: PointerEvent) {
  if (!drag.tracking || e.pointerId !== drag.id) return;
  drag.tracking = false;
  if (!drag.scrubbing) return;
  drag.scrubbing = false;
  stage.classList.remove('is-scrub');
  const dx = e.clientX - drag.x;
  if (e.type === 'pointerup' && Math.abs(dx) > 50) workGo(workActive + (dx < 0 ? 1 : -1));
  else {
    layoutScreens(0);
    syncWorkTimer();
  }
  window.setTimeout(() => (dragged = false), 50);
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
ScrollTrigger.create({
  trigger: '#work',
  start: 'top 70%',
  end: 'bottom 30%',
  onToggle: (self) => {
    workInView = self.isActive;
    syncWorkTimer();
  },
});
addEventListener('keydown', (e) => {
  if (!workInView || reader.open || palette.open || menuOpen) return;
  if ((e.target as HTMLElement).closest('input, textarea')) return;
  if (e.key === 'ArrowRight') workGo(workActive + 1);
  if (e.key === 'ArrowLeft') workGo(workActive - 1);
});

// ---------------------------------------------------------------- reveals
function rollOdometers(instant = false) {
  factsPlayed = true;
  $$('#facts-grid .reel').forEach((reel, i) => {
    const d = Number(reel.dataset.d);
    if (instant) gsap.set(reel, { yPercent: -d * 10 });
    else gsap.fromTo(reel, { yPercent: 0 }, { yPercent: -d * 10, duration: 1.6 + (i % 5) * 0.12, ease: 'expo.out', delay: i * 0.05 });
  });
}
function lightManifesto(p: number) {
  manifestoProgress = p;
  const lit = Math.round(p * manifestoWords.length);
  manifestoWords.forEach((w, i) => w.classList.toggle('is-on', i < lit));
}

// Content blocks are hidden before they enter (so nothing blinks), then rise
// in; inline styles are cleared afterwards so CSS hover states work.
type Reveal = { sel: string; trigger: string; played: boolean };
const revealList: Reveal[] = [
  { sel: '.fact', trigger: '#facts-grid', played: false },
  { sel: '.club, .board', trigger: '.community-grid', played: false },
  { sel: '.log', trigger: '#log', played: false },
  { sel: '.post', trigger: '#posts', played: false },
  { sel: '.archive', trigger: '.archive', played: false },
  { sel: '.banner', trigger: '#banner', played: false },
];
function hideReveals() {
  if (reduced) return;
  revealList.forEach((r) => !r.played && gsap.set(r.sel, { y: 40, opacity: 0 }));
}

function reveals() {
  groups().forEach((group) => {
    if (group.closest('.hero')) return;
    ScrollTrigger.create({ trigger: group, start: 'top 84%', once: true, onEnter: () => playGroup(group) });
  });
  ScrollTrigger.create({
    trigger: '#bento',
    start: 'top 82%',
    once: true,
    onEnter: () => {
      bentoPlayed = true;
      if (reduced) return;
      gsap.to('.cell-reveal', { clipPath: 'inset(0% 0% 0% 0% round 20px)', duration: 1.3, ease: 'expo.inOut', stagger: 0.1, clearProps: 'clipPath' });
      gsap.fromTo('.card-media img', { scale: 1.3 }, { scale: 1.08, duration: 2, ease: 'expo.out', stagger: 0.1, clearProps: 'scale,transform' });
      gsap.fromTo('.card-meta .rule', { scaleX: 0 }, { scaleX: 1, duration: 1, ease: 'expo.out', delay: 0.6, stagger: 0.1, clearProps: 'transform' });
    },
  });
  revealList.forEach((r) =>
    ScrollTrigger.create({
      trigger: r.trigger,
      start: 'top 84%',
      once: true,
      onEnter: () => {
        r.played = true;
        if (!reduced) gsap.to(r.sel, { y: 0, opacity: 1, duration: 1.1, ease: 'expo.out', stagger: 0.09, clearProps: 'transform,opacity' });
      },
    }),
  );
  ScrollTrigger.create({ trigger: '#facts-grid', start: 'top 84%', once: true, onEnter: () => rollOdometers(reduced) });
  if (!reduced) ScrollTrigger.create({ trigger: '#manifesto-text', start: 'top 80%', end: 'bottom 40%', scrub: true, onUpdate: (self) => lightManifesto(self.progress) });
  ScrollTrigger.create({
    trigger: '#stage',
    start: 'top 85%',
    once: true,
    onEnter: () => {
      screensPlayed = true;
      if (reduced) return;
      stage.classList.add('is-entering');
      gsap.to('#screens', { y: 0, duration: 1.2, ease: 'expo.out', clearProps: 'transform' });
      gsap.to('.screen', {
        opacity: (i: number) => Number(layoutOpacity(i)),
        duration: 1.2,
        ease: 'expo.out',
        stagger: 0.06,
        onComplete: () => {
          stage.classList.remove('is-entering');
          layoutScreens(0);
        },
      });
    },
  });
}
// The resting opacity layoutScreens gives screen i.
function layoutOpacity(i: number) {
  const n = posts.length;
  let d = i - workActive;
  while (d > n / 2) d -= n;
  while (d <= -n / 2) d += n;
  const ad = Math.abs(d);
  return ad <= 1 ? 1 - 0.4 * ad : 0.6 * clamp(0, 1, 2 - ad);
}

// Footer: clock, wordmark spotlight.
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const tickClock = () => ($('#footer-clock').textContent = clockFormat.format(new Date()));
tickClock();
setInterval(tickClock, 1000);
const wordmark = $('#wordmark');
$('#footer').addEventListener('pointermove', (e) => {
  const r = wordmark.getBoundingClientRect();
  wordmark.style.setProperty('--mx', `${e.clientX - r.left}px`);
  wordmark.style.setProperty('--my', `${e.clientY - r.top}px`);
});

// ---------------------------------------------------------------- router
// Real paths for every page (serve.mjs answers them all with index.html);
// home and the other pages live in two views, articles open in the reader.
const viewHome = $('#view-home');
const viewPage = $('#view-page');
let route: Route = parseRoute(location.pathname);
let viewShown: PageId | null = null;

function setDocTitle(page: PageId) {
  const entry = PAGES.find((n) => n.page === page);
  document.title = page === 'home' ? t('page.title') : `${entry ? t(entry.key) : '404'} — SANSPHASE 無相`;
}
function renderCurrentPage() {
  if (!viewShown || viewShown === 'home') return;
  renderPage(viewShown, viewPage, reduced);
  $$<HTMLElement>('.roll[data-roll]', viewPage).forEach((el) => setRoll(el, el.dataset.roll!));
  bindMagnetic();
}
async function swapView(page: PageId, animate: boolean) {
  const anim = animate && !reduced;
  if (anim) await gsap.to('#main', { opacity: 0, y: 14, duration: 0.22, ease: 'power2.in' });
  viewShown = page;
  viewHome.hidden = page !== 'home';
  viewPage.hidden = page === 'home';
  document.body.dataset.page = page;
  renderCurrentPage();
  const heading = viewPage.querySelector<HTMLElement>('.heading');
  if (page !== 'home' && heading) {
    prepareGroup(heading);
    playGroup(heading);
  }
  lenis.scrollTo(0, { immediate: true, force: true });
  markCurrent(page);
  setDocTitle(page);
  ScrollTrigger.refresh();
  if (anim) gsap.fromTo('#main', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out', clearProps: 'transform,opacity' });
  if (page !== 'home' && !reduced) gsap.from(viewPage.querySelectorAll('.page-body > *'), { y: 30, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.07, delay: 0.12, clearProps: 'transform,opacity' });
}
async function applyRoute(next: Route) {
  route = next;
  if (next.slug) {
    if (!viewShown) await swapView('blog', false);
    showArticle(posts.findIndex((p) => p.slug === next.slug));
    return;
  }
  if (reader.open) hideArticle();
  closeMenu();
  if (viewShown !== next.page) await swapView(next.page, viewShown !== null);
}
function navigate(path: string, replace = false) {
  if (path !== location.pathname) history[replace ? 'replaceState' : 'pushState']({ fromApp: true }, '', path);
  void applyRoute(parseRoute(path));
}
addEventListener('popstate', () => void applyRoute(parseRoute(location.pathname)));
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || /^\/(api|media|build)\//.test(url.pathname) || /\.[a-z0-9]+$/i.test(url.pathname)) return;
  if (url.pathname === location.pathname && url.hash) return;
  e.preventDefault();
  navigate(url.pathname);
});
document.addEventListener('pointerover', (e) => {
  const card = (e.target as Element).closest<HTMLElement>('[data-post]');
  if (card) reader.prefetch(Number(card.dataset.post));
});

// ---------------------------------------------------------------- reader
let readerOpener: HTMLElement | null = null;
const reader = new Reader((i) => navigate(postPath(i), true), reduced);
// Opening a post is a navigation to /blog/<slug>; the route shows the reader.
function openArticle(i: number) {
  if (posts[i]) navigate(postPath(i));
}
function closeArticle() {
  if (!reader.open) return;
  if ((history.state as { fromApp?: boolean } | null)?.fromApp) history.back();
  else navigate('/blog', true);
}
function showArticle(i: number) {
  if (!posts[i]) return;
  closeMenu();
  palette.close();
  if (reader.open) {
    reader.prepare(i);
    reader.root.scrollTop = 0;
    reader.reveal();
    reader.root.focus({ preventScroll: true });
    return;
  }
  if (!reader.open) readerOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  reader.prepare(i);
  html.classList.add('is-reading');
  ['header', 'main', 'footer'].forEach((id) => (document.getElementById(id)!.inert = true));
  lenis.stop();
  workTween?.pause();
  requestAnimationFrame(() => {
    reader.reveal();
    reader.root.focus({ preventScroll: true });
  });
}
function hideArticle() {
  reader.conceal();
  html.classList.remove('is-reading');
  ['header', 'main', 'footer'].forEach((id) => (document.getElementById(id)!.inert = false));
  if (!menuOpen) lenis.start();
  syncWorkTimer();
  if (readerOpener?.isConnected) readerOpener.focus({ preventScroll: true });
  readerOpener = null;
}
$('#reader-close').addEventListener('click', closeArticle);
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (reader.open) closeArticle();
  else closeMenu();
});

// ---------------------------------------------------------------- palette
const palette = new Palette((): Command[] => {
  const chapters: Command[] = PAGES.map((n, i) => ({
    id: `page-${n.page}`,
    group: t('palette.chapters'),
    label: t(n.key),
    hint: pad2(i + 1),
    keywords: `${ui[n.key].en} ${ui[n.key].zh} ${n.path}`,
    run: () => navigate(n.path),
  }));
  const postCommands: Command[] = posts.map((p, i) => ({ id: `post-${i}`, group: t('palette.posts'), label: pick(p.title), hint: p.date, keywords: postKeywords(i), run: () => openArticle(i) }));
  const sectionCommands: Command[] = sections.map((s, i) => ({
    id: `section-${s.id}`,
    group: t('palette.sections'),
    label: pick(s.name),
    hint: pick(s.status),
    keywords: sectionKeywords(i),
    run: () => navigate(sectionPath(s)),
  }));
  const actions: Command[] = [
    { id: 'theme', group: t('palette.actions'), label: t('palette.theme'), hint: theme() === 'dark' ? '☾' : '☀', keywords: 'theme dark light 主题 深色 浅色', run: () => setTheme(theme() === 'dark' ? 'light' : 'dark', undefined, reduced) },
    { id: 'lang', group: t('palette.actions'), label: t('palette.lang'), hint: en() ? '中' : 'EN', keywords: 'language 语言 english 中文', run: () => setLang(en() ? 'zh' : 'en') },
  ];
  return [...chapters, ...postCommands, ...sectionCommands, ...actions];
}, reduced);

// ---------------------------------------------------------------- frame loop
gsap.ticker.add((time, deltaMs) => {
  const dt = Math.min(deltaMs / 1000, 0.05);
  if (!reduced && viewShown === 'home') marquees.forEach((m) => m.update(dt, lenis.velocity));

  // Hero cover: hold, then morph to the next post.
  const heroRect = heroMedia.getBoundingClientRect();
  const heroVisible = viewShown === 'home' && heroRect.bottom > 0 && heroRect.top < innerHeight && !reader.open && !document.hidden;
  if (heroVisible && !heroHover && !heroFocus && !heroPaused && !(heroTween?.isActive() ?? false)) {
    heroClock += dt;
    if (heroClock > HERO_HOLD) heroGo(heroShown + 1);
  }
  $$('#hero-ticks button').forEach((b, i) => b.style.setProperty('--p', String(i === heroShown ? clamp(0, 1, heroClock / HERO_HOLD) : i < heroShown ? 1 : 0)));
  if (heroGL && heroVisible) {
    sizeHero();
    heroGL.gallery.set(heroState.f, heroState.scatter);
    heroGL.gallery.pointer(pointer.inside ? pointer.x : null, pointer.inside ? pointer.y : null);
    heroGL.gallery.calm(reduced ? 0 : 1 - heroState.scatter);
    heroGL.gallery.update(dt, time);
    heroGL.renderer.render(heroGL.gallery.scene, heroGL.gallery.camera);
  }
});

// ---------------------------------------------------------------- start
function layout() {
  sizeHero();
  marquees.forEach((m) => m.measure());
  markCurrent(viewShown ?? 'home');
  ScrollTrigger.refresh();
}
addEventListener('resize', () => {
  layout();
  layoutScreens(0);
});

async function start() {
  renderAll();
  await applyRoute(route);
  reveals();
  startWorkTimer();
  document.fonts.ready.then(() => {
    loading.fonts = 1;
    layout();
  });
  // Never hold the page behind the loader for a slow image.
  window.setTimeout(() => {
    loading.fonts = 1;
    loading.covers = 1;
  }, 6000);
  if (heroGL) heroGL.renderer.compile(heroGL.gallery.scene, heroGL.gallery.camera);
  const intro = () => {
    heroClock = 0;
    document.body.classList.remove('is-loading');
    if (!reader.open && !menuOpen) lenis.start();
    playGroup($('#hero-copy'));
    gsap.to(heroState, { scatter: 0, duration: reduced ? 0.01 : 2.4, ease: 'expo.out', delay: 0.35 });
    if (reduced) return;
    gsap.from('.hero-stage', { y: 60, opacity: 0, duration: 1.6, ease: 'expo.out', delay: 0.15, clearProps: 'transform,opacity' });
    gsap.fromTo('.bar', { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, ease: 'expo.out', delay: 0.2, clearProps: 'transform,opacity' });
    gsap.fromTo('.hero-cue', { opacity: 0 }, { opacity: 1, duration: 1, delay: 1.2, clearProps: 'opacity' });
  };
  if (params.has('skip')) {
    $('#loader').style.display = 'none';
    intro();
    return;
  }
  await runLoader({ progress: () => (loading.fonts + loading.covers) / 2, reduced, onHandOver: intro });
}
start();

Object.assign(window, { __v4: { lenis, ScrollTrigger, heroGL, heroState, openArticle, closeArticle, reader, palette, setLang, setTheme, workGo, heroGo, layoutScreens } });
