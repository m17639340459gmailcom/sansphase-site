import type { Icons, Translate } from '../community.ts';

type CommunityTheme = 'light' | 'dark';
type AppearanceWindow = Pick<Window, 'location'>;

/** Community appearance is independent of the main site's theme and account. */
export function createCommunityAppearance(document: Document, _window: AppearanceWindow) {
  // Every fresh document starts light. A manual choice stays in this controller
  // across route/language updates, without restoring old URL or storage values.
  let theme: CommunityTheme = 'light';
  let active = false;
  let previous: string | undefined;
  let translate: Translate = (zh) => zh;
  let icons: Icons = {};
  const label = () => theme === 'light' ? translate('明亮', 'Light') : translate('深色', 'Dark');
  const actionLabel = () => theme === 'light' ? translate('切换为深色模式', 'Use dark mode') : translate('切换为明亮模式', 'Use light mode');
  const icon = () => icons[theme === 'light' ? 'sun' : 'moon'] || '';
  const paint = () => {
    if (!active) return;
    document.body.dataset.communityTheme = theme;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="community-theme-toggle"]')) {
      button.setAttribute('aria-pressed', String(theme === 'light'));
      button.setAttribute('aria-label', actionLabel());
      button.title = actionLabel();
      const glyph = button.querySelector('[data-appearance-glyph]');
      const text = button.querySelector('[data-appearance-label]');
      if (glyph && glyph.innerHTML !== icon()) glyph.innerHTML = icon();
      if (text) text.textContent = label();
    }
  };
  return {
    sync(enabled: boolean) {
      if (enabled) {
        if (!active) previous = document.body.dataset.communityTheme;
        active = true;
        paint();
      } else if (active) {
        active = false;
        if (previous === undefined) delete document.body.dataset.communityTheme;
        else document.body.dataset.communityTheme = previous;
      }
    },
    buttonHTML(t: Translate, drawings: Icons) {
      translate = t; icons = drawings;
      return `<button type="button" class="community-appearance-toggle" data-action="community-theme-toggle" aria-label="${actionLabel()}" title="${actionLabel()}" aria-pressed="${theme === 'light'}"><span data-appearance-glyph aria-hidden="true">${icon()}</span><span data-appearance-label>${label()}</span></button>`;
    },
    toggle() {
      if (!active) return;
      theme = theme === 'light' ? 'dark' : 'light';
      paint();
    },
  };
}
