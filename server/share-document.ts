import { createHash } from 'node:crypto';
import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';

export type ShareCard = {
  title: string;
  description: string;
  url: string;
  target: string;
  image: string;
  siteName: string;
  type?: 'website' | 'article';
};

const style = `:root{color-scheme:light dark;--page:#eee8dc;--card:#f8f4eb;--text:#384558;--muted:#657083;--line:#cfc2ad;--gold:#82623b}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--page);color:var(--text);font-family:"Microsoft YaHei",system-ui,sans-serif}
main{width:min(100%,660px)}.card{display:grid;grid-template-columns:176px minmax(0,1fr);gap:20px;padding:16px;align-items:start;border:1px solid var(--line);border-radius:14px;background:var(--card);color:inherit;text-decoration:none;box-shadow:0 8px 24px #0000000c}
.card:focus-visible{outline:3px solid var(--gold);outline-offset:5px}.card:hover .enter{text-decoration:underline}.card:active{border-color:var(--gold)}.cover{display:block;width:176px;height:176px;object-fit:cover;border-radius:9px;background:#18263b}
.content{display:block;min-width:0;padding:3px 4px 3px 0}.site{display:block;color:var(--gold);font-size:12px;letter-spacing:.08em}h1{margin:8px 0;font-size:clamp(18px,2.4vw,22px);line-height:1.45;overflow-wrap:anywhere;text-wrap:pretty}p{margin:0;color:var(--muted);font-size:14px;line-height:1.7;overflow-wrap:anywhere;text-wrap:pretty}.enter{display:block;margin-top:16px;color:var(--gold);font-size:13px}
@media(prefers-color-scheme:dark){:root{--page:#152235;--card:#1c2d44;--text:#e5e9ee;--muted:#b3becd;--line:#354963;--gold:#dbc28e}}
@media(max-width:520px){body{padding:16px}.card{grid-template-columns:96px minmax(0,1fr);gap:14px;padding:12px}.cover{width:96px;height:112px;border-radius:7px}.content{padding:0}h1{font-size:18px}p{font-size:13px}.enter{margin-top:12px}}`;

// The only inline style is a fixed source constant; no user content enters CSS.
export const shareDocumentCsp = [
  "default-src 'none'",
  `style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'`,
  "img-src 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

type Nodes = ReturnType<typeof parseDocument>['children'];
type Tag = 'title' | 'meta' | 'link' | 'a' | 'img' | 'div' | 'span' | 'h1' | 'p';

// Parse only a fixed, trusted tag name. The existing serializer handles all
// dynamic text and attributes, including quotes and closing-tag characters.
function element(tag: Tag, attributes: Record<string, string> = {}, content?: string | Nodes) {
  const node = parseDocument(`<${tag}></${tag}>`).children[0];
  if (node.type !== 'tag') throw new Error('Invalid share template.');
  node.attribs = attributes;
  if (typeof content === 'string') {
    const text = parseDocument('placeholder').children[0];
    if (text.type !== 'text') throw new Error('Invalid share text template.');
    text.data = content;
    node.children = [text];
  } else if (content) node.children = content;
  for (const child of node.children) child.parent = node;
  return node;
}

function safeUrl(value: string): string {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid share URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid share URL.'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) throw new Error('Invalid share URL.');
  return url.href;
}

function normalize(card: ShareCard): ShareCard {
  return { ...card, url: safeUrl(card.url), target: safeUrl(card.target), image: safeUrl(card.image) };
}

function metadata(card: ShareCard): Nodes {
  return [
    ...Object.entries({
      'og:title': card.title,
      'og:description': card.description,
      'og:url': card.url,
      'og:image': card.image,
      'og:image:alt': card.title,
      'og:type': card.type === 'article' ? 'article' : 'website',
      'og:site_name': card.siteName,
    }).map(([property, content]) => element('meta', { property, content })),
    ...Object.entries({
      'twitter:card': 'summary_large_image',
      'twitter:title': card.title,
      'twitter:description': card.description,
      'twitter:image': card.image,
      'twitter:image:alt': card.title,
    }).map(([name, content]) => element('meta', { name, content })),
    element('link', { rel: 'canonical', href: card.url }),
  ];
}

/** Append to an existing document head without duplicating its title/description. */
export function shareHead(input: ShareCard): string {
  return render(metadata(normalize(input)), { encodeEntities: 'utf8' });
}

/** A crawler-readable, script-free page with one clickable visual card. */
export function shareDocument(input: ShareCard): string {
  const card = normalize(input);
  const head = render([
    element('title', {}, card.title),
    element('meta', { name: 'description', content: card.description }),
    ...metadata(card),
  ], { encodeEntities: 'utf8' });
  const link = element('a', { class: 'card', href: card.target }, [
    element('img', { class: 'cover', src: card.image, alt: card.title, width: '1200', height: '630', decoding: 'async' }),
    element('div', { class: 'content' }, [
      element('span', { class: 'site' }, card.siteName),
      element('h1', {}, card.title),
      element('p', {}, card.description),
      element('span', { class: 'enter' }, '点击进入 →'),
    ]),
  ]);
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + head + '<style>' + style + '</style></head><body><main>'
    + render(link, { encodeEntities: 'utf8' }) + '</main></body></html>';
}
