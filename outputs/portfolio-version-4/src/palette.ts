// Command palette (⌘K / Ctrl K): jump to any chapter, open a post, switch theme
// or language. Search runs over both languages. Built as a combobox + listbox:
// focus stays in the input, the active option is announced, the page behind
// is inert while it is open, and focus returns to where it came from.
import gsap from 'gsap';
import { posts, sections } from './content';
import { t } from './i18n';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export type Command = { id: string; group: string; label: string; hint: string; keywords: string; run: () => void };

export class Palette {
  readonly root = document.getElementById('palette')!;
  private readonly input = document.getElementById('palette-input') as HTMLInputElement;
  private readonly list = document.getElementById('palette-list')!;
  private commands: Command[] = [];
  private shown: Command[] = [];
  private active = 0;
  private opener: HTMLElement | null = null;
  private madeInert: HTMLElement[] = [];
  open = false;

  constructor(
    private readonly build: () => Command[],
    private readonly reduced = false,
  ) {
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-controls', 'palette-list');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.list.setAttribute('role', 'listbox');
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.move(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.runActive();
      } else if (e.key === 'Tab') {
        // The input is the dialog's only stop; keep focus inside.
        e.preventDefault();
      }
    });
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    this.list.addEventListener('click', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('[data-index]');
      if (!item) return;
      this.active = Number(item.dataset.index);
      this.runActive();
    });
    addEventListener(
      'keydown',
      (e) => {
        if (document.body.classList.contains('is-loading')) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          if (this.open) this.close();
          else this.show();
        } else if (e.key === 'Escape' && this.open) {
          e.stopImmediatePropagation();
          this.close();
        }
      },
      { capture: true },
    );
  }

  show(query = '') {
    if (this.open) {
      this.input.value = query;
      this.render();
      return;
    }
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.commands = this.build();
    this.open = true;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.madeInert = ['header', 'main', 'footer', 'reader', 'menu']
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el && !el.inert);
    this.madeInert.forEach((el) => (el.inert = true));
    this.input.value = query;
    this.input.placeholder = t('palette.placeholder');
    this.input.setAttribute('aria-label', t('palette.placeholder'));
    this.render();
    if (!this.reduced) gsap.fromTo('.palette-box', { y: 24, opacity: 0, scale: 0.98 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'expo.out' });
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    this.madeInert.forEach((el) => (el.inert = false));
    this.madeInert = [];
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }

  private runActive() {
    const command = this.shown[this.active];
    this.close();
    command?.run();
  }

  private move(step: number) {
    if (!this.shown.length) return;
    this.active = (this.active + step + this.shown.length) % this.shown.length;
    this.highlight();
  }

  private highlight() {
    this.list.querySelectorAll<HTMLElement>('[data-index]').forEach((el, i) => {
      el.classList.toggle('is-active', i === this.active);
      el.setAttribute('aria-selected', String(i === this.active));
    });
    const current = this.list.querySelector<HTMLElement>('.is-active');
    if (current) {
      this.input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }

  private render() {
    const q = this.input.value.trim().toLowerCase();
    this.shown = this.commands.filter((c) => !q || `${c.label} ${c.keywords}`.toLowerCase().includes(q));
    this.active = 0;
    let group = '';
    this.list.innerHTML = this.shown.length
      ? this.shown
          .map((c, i) => {
            const head = c.group !== group ? `<li class="palette-group" role="presentation">${(group = c.group)}</li>` : '';
            return `${head}<li class="palette-item" role="option" id="pal-${i}" aria-selected="false" data-index="${i}"><span>${esc(c.label)}</span><kbd aria-hidden="true">${esc(c.hint)}</kbd></li>`;
          })
          .join('')
      : `<li class="palette-empty" role="presentation">${t('palette.empty')}</li>`;
    this.highlight();
  }
}

// Keyword text for a post in both languages, so either language finds it.
export const postKeywords = (i: number) => {
  const p = posts[i];
  return [p.title.en, p.title.zh, ...p.tags.map((tag) => `${tag.en} ${tag.zh}`)].join(' ');
};

export const sectionKeywords = (i: number) => `${sections[i].name.en} ${sections[i].name.zh}`;
