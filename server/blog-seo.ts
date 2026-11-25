import { parseDocument, DomUtils } from 'htmlparser2';
import render from 'dom-serializer';
import { escapeHTML } from '../src/core.mjs';
import { renderArticlePage } from '../src/article-page.ts';
import type { ArticleItem } from '../src/article-page.ts';
import { blogSlug, blogPath, validBlogSlug } from '../src/blog-route.ts';
import { renderBlogAuthor, renderBlogMusic } from '../src/blog-reading-sidebar.ts';
import type { BlogSidebarState } from '../src/blog-reading-sidebar.ts';
import { articleContentsHTML, articleCodeToolsHTML } from '../src/article-contents.ts';
import { musicPlayerStaticHTML } from '../src/music-player-markup.ts';
import { shareHead } from './share-document.ts';
import { publicBlogCover, shareOrigin } from './share-preview.ts';

type Nodes = ReturnType<typeof parseDocument>['children'];
type Element = Extract<Nodes[number], { attribs: unknown }>;
export { blogSlug as publicBlogSlug };

function elements(nodes: Nodes): Element[] {
  return nodes.flatMap(node => 'attribs' in node
    ? [node, ...elements(node.children)] : 'children' in node ? elements(node.children) : []);
}

/** Only the document shell is adjusted. The article itself uses the browser's renderer. */
export function publicBlogDocument(html: string, item: ArticleItem, options: { siteOrigin: string; siteName?: string; siteContent?: BlogSidebarState['siteContent']; mainId?: string }): string {
  const origin = shareOrigin(options.siteOrigin), siteName = options.siteName || '無相';
  const document = parseDocument(html), tags = elements(document.children);
  const head = tags.find(node => node.name === 'head'), body = tags.find(node => node.name === 'body');
  const main = tags.find(node => node.attribs.id === (options.mainId || 'main')), root = tags.find(node => node.name === 'html');
  if (!head || !body || !main || !root || !validBlogSlug(item.id)) throw Error('Invalid public article document');
  const url = origin + blogPath(item.id);
  const title = item.title + ' · ' + siteName, description = item.summary || '阅读这篇博客文章。';
  const metadata = `<title>${escapeHTML(title)}</title><meta name="description" content="${escapeHTML(description)}">`
    + shareHead({ title: item.title, description, url, target: url,
      image: publicBlogCover(origin, item.coverSrc), siteName, type: 'article' });
  head.children = head.children.filter(node => !('attribs' in node && (
    node.name === 'title' || node.name === 'link' && node.attribs.rel === 'canonical'
    || node.name === 'meta' && (node.attribs.name === 'description' || node.attribs.name?.startsWith('twitter:') || node.attribs.property?.startsWith('og:'))
  ))).concat(parseDocument(metadata).children);
  for (const child of head.children) child.parent = head;
  main.children = parseDocument(renderArticlePage(item, { siteName })).children;
  const page = main.children.find(node => 'attribs' in node && node.name === 'section');
  if (!page || !('attribs' in page)) throw Error('Invalid shared article template');
  const article = page.children.find(node => 'attribs' in node && node.name === 'article');
  if (!article || !('attribs' in article)) throw Error('Invalid shared article template');
  const state = { notes: [item], siteContent: options.siteContent };
  const layout = parseDocument('<div class="reading-layout"><aside class="blog-page reading-sidebar" aria-label="作者、音乐与文章目录">'
    + renderBlogAuthor(state) + renderBlogMusic(state) + '<div class="reading-directory-slot"></div></aside></div>').children[0];
  if (!('children' in layout)) throw Error('Invalid reading layout');
  const music = elements(layout.children).find(node => node.attribs.id === 'blog-audio-player');
  if (music) {
    music.children = parseDocument(musicPlayerStaticHTML({ trackCount: options.siteContent?.profile?.music?.tracks?.length })).children;
    for (const child of music.children) child.parent = music;
  }
  for (const card of elements(layout.children).filter(node => ['blog-identity', 'blog-side-card blog-music-card'].includes(node.attribs.class))) {
    const shell = parseDocument('<div data-reading-static-glass class="glass-surface glass-surface--fallback blog-third-party-glass blog-panel-surface"><div class="glass-surface__content"><div class="blog-third-party-glass-content"></div></div></div>').children[0];
    if (!('children' in shell)) throw Error('Invalid reading glass shell');
    const content = elements([shell]).find(node => node.attribs.class === 'blog-third-party-glass-content')!;
    content.children = card.children;
    for (const child of content.children) child.parent = content;
    card.children = [shell]; shell.parent = card;
  }
  const articleBody = elements(article.children).find(node => node.attribs.class === 'article-body');
  if (!articleBody) throw Error('Invalid shared article body');
  const headings = elements(articleBody.children).filter(node => node.name === 'h2' || node.name === 'h3')
    .map(node => ({ title: DomUtils.textContent(node).trim(), level: node.name === 'h3' ? 3 as const : 2 as const })).filter(heading => heading.title);
  if (headings.length) {
    const contents = parseDocument(articleContentsHTML(headings, { sidebar: true, initial: true, id: 'article-contents-ssr' })).children[0];
    article.children.splice(article.children.indexOf(articleBody), 0, contents); contents.parent = article;
  }
  for (const pre of elements(articleBody.children).filter(node => node.name === 'pre')) {
    const toolbar = parseDocument(articleCodeToolsHTML()).children[0];
    if (!('attribs' in toolbar) || !pre.parent) throw Error('Invalid article code toolbar');
    toolbar.attribs['data-reading-static-code'] = ''; toolbar.attribs.inert = '';
    pre.parent.children.splice(pre.parent.children.indexOf(pre), 0, toolbar); toolbar.parent = pre.parent;
  }
  layout.children.push(article); article.parent = layout;
  page.children = [layout]; layout.parent = page;
  page.attribs.class = (page.attribs.class || '') + ' reading-page';
  for (const child of main.children) child.parent = main;
  main.attribs['data-article-entry'] = item.id;
  delete main.attribs.hidden;
  body.attribs.class = [...new Set([...(body.attribs.class || '').split(/\s+/).filter(Boolean), 'content-open', 'blog-open'])].join(' ');
  // Relative shell assets must resolve from the site's root on a deep URL. The
  // deployment's absolute static/CDN addresses remain untouched. Existing
  // hash navigation resolves at the root instead of nesting below /blog/slug.
  for (const node of elements(document.children)) {
    for (const attribute of ['src', 'href', 'data-background-src', 'data-static-base']) {
      const value = node.attribs[attribute];
      if (value?.startsWith('./')) node.attribs[attribute] = '/' + value.slice(2);
      else if (attribute === 'href' && value?.startsWith('#/')) node.attribs[attribute] = '/' + value;
    }
  }
  root.attribs['data-static-base'] ||= '/';
  return render(document, { encodeEntities: 'utf8' });
}

export function publicBlogSitemap(notes: readonly Pick<ArticleItem, 'id'>[], siteOrigin: string): string {
  const origin = shareOrigin(siteOrigin);
  const addresses = new Set([origin + '/', ...notes.filter(note => validBlogSlug(note.id)).map(note => origin + blogPath(note.id))]);
  // No fabricated lastmod: the current public projection has publication dates,
  // not the timestamp of the latest meaningful edit.
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + [...addresses].map(address => '<url><loc>' + escapeHTML(address) + '</loc></url>').join('') + '</urlset>';
}

export function publicBlogRobots(siteOrigin: string): string {
  return `User-agent: *\nAllow: /\nSitemap: ${shareOrigin(siteOrigin)}/sitemap.xml\n`;
}
