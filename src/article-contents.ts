import { escapeHTML as esc } from './core.mjs';

export type ArticleHeading = { title: string; level: 2 | 3 };

export function articleCodeToolsHTML(english = false): string {
  return `<div class="article-code-tools"><button type="button">${english ? 'Copy code' : '复制代码'}</button><span role="status"></span></div>`;
}

export function articleContentsHTML(headings: readonly ArticleHeading[], { english = false, sidebar = false, id, initial = false }: {
  english?: boolean; sidebar?: boolean; id: string; initial?: boolean;
}): string {
  const title = english ? 'On this page' : '文章目录';
  return `<details class="article-contents${sidebar ? ' reading-directory-card' : ''}" id="${esc(id)}"${initial ? ' data-reading-static-directory' : ''}><summary>${title}</summary><nav aria-label="${title}"><ol>${headings.map(heading => `<li><button type="button"${heading.level === 3 ? ' class="article-contents-child"' : ''}>${esc(heading.title)}</button></li>`).join('')}</ol></nav></details>`;
}
