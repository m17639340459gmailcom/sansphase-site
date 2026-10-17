// Article reader: real public article bodies (via serve.mjs), an editorial
// column, a sticky contents list with the current section lit, and progress.
import gsap from 'gsap';
import { posts } from './content';
import { lang, pick, t } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const bodies = new Map<string, Promise<string>>();

function fetchBody(slug: string) {
  if (!bodies.has(slug)) {
    bodies.set(
      slug,
      fetch(`/api/article/${slug}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { bodyHTML: string }) => data.bodyHTML),
    );
  }
  return bodies.get(slug)!;
}

export class Reader {
  readonly root = $('reader');
  readonly heroImg = $<HTMLImageElement>('reader-img');
  index = -1;
  open = false;
  private headings: HTMLElement[] = [];
  private tocLinks: HTMLAnchorElement[] = [];

  constructor(
    private readonly onNext: (index: number) => void,
    private readonly reduced = false,
  ) {
    this.root.addEventListener('scroll', () => this.onScroll(), { passive: true });
    $('reader-next').addEventListener('click', () => this.onNext((this.index + 1) % posts.length));
  }

  prefetch(index: number) {
    fetchBody(posts[index].slug).catch(() => undefined);
  }

  // Lays the page out (still invisible) so its hero box can be measured.
  prepare(index: number) {
    this.index = index;
    this.fill();
    this.root.scrollTop = 0;
    this.root.classList.add('is-active');
    this.root.setAttribute('aria-hidden', 'false');
  }

  fill() {
    const post = posts[this.index];
    if (!post) return;
    const english = lang() === 'en';
    $('reader-meta').textContent = `${pick(post.category)} — ${post.date}`;
    $('reader-title').textContent = pick(post.title);
    $('reader-subtitle').textContent = english ? post.title.zh : '';
    $('reader-subtitle').hidden = !english;
    $('reader-lead').textContent = pick(post.summary);
    $('reader-only').textContent = t('article.only');
    $('reader-only').hidden = !english;
    $('reader-tags').innerHTML = post.tags.map((tag) => `<li>${pick(tag)}</li>`).join('');
    const next = posts[(this.index + 1) % posts.length];
    $('reader-next-title').textContent = pick(next.title);
    $<HTMLAnchorElement>('reader-original').href = post.url;
    if (this.heroImg.getAttribute('src') !== post.cover) this.heroImg.src = post.cover;
    const body = $('reader-body');
    body.innerHTML = '<p class="reader-loading">…</p>';
    this.headings = [];
    this.tocLinks = [];
    $('reader-toc').innerHTML = '';
    fetchBody(post.slug)
      .then((html) => {
        if (posts[this.index] !== post) return;
        body.innerHTML = html;
        this.decorate(body);
        const minutes = Math.max(1, Math.round((body.textContent ?? '').length / 400));
        $('reader-meta').textContent = `${pick(post.category)} — ${post.date} — ${minutes} ${t('article.minutes')}`;
      })
      .catch(() => {
        body.innerHTML = `<p>${english ? 'The article could not be loaded here.' : '正文暂时无法在这里加载。'} <a href="${post.url}" target="_blank" rel="noopener">${t('article.original')} ↗</a></p>`;
      });
  }

  private decorate(body: HTMLElement) {
    body.querySelectorAll('img').forEach((img) => {
      img.loading = 'lazy';
      img.decoding = 'async';
    });
    this.headings = Array.from(body.querySelectorAll<HTMLElement>('h2, h3'));
    const toc = $('reader-toc');
    toc.innerHTML = '';
    this.tocLinks = this.headings.map((heading, i) => {
      heading.id = `section-${i}`;
      const li = document.createElement('li');
      li.className = heading.tagName === 'H3' ? 'is-sub' : '';
      const a = document.createElement('a');
      a.href = `#section-${i}`;
      a.textContent = heading.textContent ?? '';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const top = heading.getBoundingClientRect().top - this.root.getBoundingClientRect().top + this.root.scrollTop - 96;
        this.root.scrollTo({ top, behavior: this.reduced ? 'auto' : 'smooth' });
      });
      li.appendChild(a);
      toc.appendChild(li);
      return a;
    });
    this.onScroll();
  }

  reveal() {
    this.open = true;
    this.root.classList.add('is-open');
    if (this.reduced) return;
    gsap.fromTo(
      this.root.querySelectorAll('.reader-head > *, .reader-layout'),
      { y: 40, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: 0.05 },
    );
    gsap.fromTo('#reader-close', { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.6, ease: 'expo.out', delay: 0.15 });
  }

  conceal() {
    this.open = false;
    this.root.classList.remove('is-open', 'is-active');
    this.root.setAttribute('aria-hidden', 'true');
  }

  private onScroll() {
    const el = this.root;
    const max = el.scrollHeight - el.clientHeight;
    gsap.set('#reader-bar', { scaleX: max > 0 ? el.scrollTop / max : 0 });
    let active = -1;
    const top = el.getBoundingClientRect().top;
    this.headings.forEach((heading, i) => {
      if (heading.getBoundingClientRect().top - top < 140) active = i;
    });
    this.tocLinks.forEach((link, i) => link.classList.toggle('is-active', i === active));
  }
}
