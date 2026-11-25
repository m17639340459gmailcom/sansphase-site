import type { ArticleItem } from './article-page.ts';
import { blogPath } from './blog-route.mjs';

type Options = {origin: string; siteName: string; page: string; item?: ArticleItem | null; preview?: boolean};
export function updateBlogMetadata(doc: Document, {origin, siteName, page, item, preview = false}: Options): void {
  const article = page === 'note' && item && !preview ? item : null;
  const meta = (attribute: 'name' | 'property', name: string, content: string) => {
    let node = doc.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
    if (!node) { node = doc.createElement('meta'); node.setAttribute(attribute, name); doc.head.append(node); }
    node.content = content;
  };
  const address = origin + (article ? blogPath(article.id) : '/');
  if (article) {
    doc.title = article.title + ' · ' + siteName;
    meta('name', 'description', article.summary || '阅读这篇博客文章。');
  }
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (article || page === 'home') {
    const link = canonical || doc.createElement('link'); link.rel = 'canonical'; link.href = address;
    if (!canonical) doc.head.append(link);
  } else canonical?.remove();
  const title = article?.title || doc.title;
  const description = doc.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || '';
  // Public DTO covers use permission-checked media endpoints. Never forward
  // preview credentials from an arbitrary document URL into metadata.
  const media = article?.coverSrc && /^\/api\/media\/[0-9a-f-]{36}(?:\?|$)/i.test(article.coverSrc)
    ? new URL(article.coverSrc, origin) : null;
  if (media) { media.search = '?w=960&view=content'; media.hash = ''; }
  const image = media?.href || origin + '/share/cover.jpg';
  for (const [name, value] of Object.entries({title, description, url: address, type:article ? 'article' : 'website', image})) meta('property', 'og:' + name, value);
  for (const [name, value] of Object.entries({title, description, image})) meta('name', 'twitter:' + name, value);
  const robots = doc.querySelector<HTMLMetaElement>('meta[data-blog-preview-robots]');
  if (preview) {
    const node = robots || doc.createElement('meta'); node.name = 'robots'; node.content = 'noindex'; node.dataset.blogPreviewRobots = '';
    if (!robots) doc.head.append(node);
  } else robots?.remove();
}
