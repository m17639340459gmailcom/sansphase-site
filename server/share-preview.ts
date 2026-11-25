import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { uuidPattern } from './content-service.ts';
import { shareDocument, shareDocumentCsp, shareHead } from './share-document.ts';
import type { ShareCard } from './share-document.ts';

type Snapshot = { profile?: { name?: string; signature?: string }; notes?: Array<{ id: string; title: string; summary?: string; coverSrc?: string }> };
type ShareTopic = { title: string; description: string; imageId?: string };
type Options = { siteOrigin: string; root: string; communityOnly?: boolean; communityDestination?: string;
  snapshot?: () => Promise<{ data: Snapshot }>;
  topic?: (id: string) => ShareTopic | null;
  topicImage?: (id: string) => Promise<Buffer | null>;
  invitationEligible?: (code: string) => boolean;
};
// Canonical origins come from private runtime configuration, never Host or forwarded headers.
export function shareOrigin(value: string) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Invalid share origin.');
  return url.origin;
}
const clean = (value: string | undefined, maximum: number) => (value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
// Both the full article and its share card use the same permission-checked cover.
export function publicBlogCover(origin: string, source?: string | null): string {
  try {
    const image = source && new URL(source, origin);
    if (image && image.origin === origin && !image.username && !image.password && /^\/api\/media\/[0-9a-f-]{36}$/i.test(image.pathname) && !image.searchParams.has('preview')) {
      image.search = '?w=960&view=content'; image.hash = ''; return image.href;
    }
  } catch { /* Invalid historical covers use the site's existing public artwork. */ }
  return origin + '/share/cover.jpg';
}
export function createSharePreview(options: Options) {
  const origin = shareOrigin(options.siteOrigin);
  let cover: Promise<Buffer> | undefined;
  const siteCard = (snapshot: Snapshot = {}, community = false): ShareCard => ({
    title: community ? '無相社区 · 交流与创作' : `${clean(snapshot.profile?.name, 60) || '無相'} · 博客与作品`,
    description: community ? '交流学习，分享创作。进入社区参与讨论。' : clean(snapshot.profile?.signature, 180) || '分享博客文章、软件作品与学习心得。',
    url: origin + '/share/' + (community ? 'community' : 'site'),
    target: community ? origin + '/#/community' + (options.communityOnly ? '/home' : '') : origin + '/',
    image: origin + '/share/cover.jpg', siteName: '無相', type: 'website',
  });
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  return {
    head(snapshot: Snapshot) { const card = siteCard(snapshot, Boolean(options.communityOnly)); return shareHead({ ...card, url: origin + '/' }); },
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const requested = new URL(req.url || '/', origin);
      if (!requested.pathname.startsWith('/share/')) return false;
      const reply = (status: number, value: string | Buffer, type = 'text/plain; charset=utf-8') => {
        res.writeHead(status, { ...headers, 'Content-Type': type, 'Content-Length': Buffer.byteLength(value),
          ...(type.startsWith('text/html') ? { 'Content-Security-Policy': shareDocumentCsp } : {}) });
        res.end(req.method === 'HEAD' ? undefined : value);
      };
      if (!['GET', 'HEAD'].includes(req.method || '')) { res.setHeader('Allow', 'GET, HEAD'); reply(405, 'Method not allowed'); return true; }
      try {
        if (requested.pathname === '/share/cover.jpg') {
          cover ??= sharp(resolve(options.root, 'assets/community/atlas-space.webp')).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer()
            .catch(error => { cover = undefined; throw error; });
          reply(200, await cover, 'image/jpeg'); return true;
        }
        const parts = requested.pathname.slice('/share/'.length).split('/');
        let card: ShareCard | null = null;
        if (parts.length === 1 && ['site', 'community'].includes(parts[0])) {
          card = siteCard((await options.snapshot?.())?.data, parts[0] === 'community');
        } else if (parts[0] === 'invite' && parts.length === 2 && !options.communityOnly) {
          const code = parts[1];
          if (/^[A-Za-z0-9_-]{24}$/.test(code) && options.invitationEligible?.(code)) {
            card = { ...siteCard({}, true), title: '邀请你加入無相社区',
              description: '交流学习，分享创作。通过邀请注册并发帖，经审核通过后，邀请人可获得 15 星尘。',
              url: origin + '/share/invite/' + code, target: origin + '/?invite=' + code + '#/account' };
          }
        } else if (parts[0] === 'blog' && parts.length === 2 && !options.communityOnly) {
          let id: string;
          try { id = decodeURIComponent(parts[1]); }
          catch { reply(404, '分享内容不存在或暂不可见。'); return true; }
          if (id.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
            const data = (await options.snapshot?.())?.data;
            const note = data?.notes?.find(note => note.id === id);
            if (note) {
              card = { ...siteCard(data), title: clean(note.title, 180), description: clean(note.summary, 240) || '阅读这篇博客文章。',
                url: origin + '/share/blog/' + encodeURIComponent(id), target: origin + '/blog/' + encodeURIComponent(id),
                image: publicBlogCover(origin, note.coverSrc), type: 'article' };
              // This remains the approved summary card, not a duplicate full article.
              res.setHeader('X-Robots-Tag', 'noindex');
            }
          }
        } else if (parts[0] === 'post' && [2, 3].includes(parts.length) && uuidPattern.test(parts[1])) {
          const id = parts[1];
          const topic = options.topic?.(id);
          if (topic) {
            if (parts.length === 3) {
              if (parts[2] === 'cover.jpg' && topic.imageId) {
                const bytes = await options.topicImage?.(id);
                if (bytes && options.topic?.(id)?.imageId === topic.imageId) { reply(200, bytes, 'image/jpeg'); return true; }
              }
            } else {
              card = { ...siteCard({}, true), title: clean(topic.title, 180), description: clean(topic.description, 240),
                url: origin + '/share/post/' + id, target: origin + '/#/post/' + id, type: 'article',
                ...(topic.imageId ? { image: origin + '/share/post/' + id + '/cover.jpg' } : {}) };
            }
          }
        }
        if (!card) reply(404, '分享内容不存在或暂不可见。');
        else reply(200, shareDocument(card), 'text/html; charset=utf-8');
      } catch (error) {
        if (error && typeof error === 'object' && 'status' in error && error.status === 503) res.setHeader('Retry-After', '1');
        reply(503, '分享暂时不可用，请稍后重试。');
      }
      return true;
    },
  };
}
