import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Payload } from 'payload';
import type { createReaderUidStore } from '../../server/reader-uids.ts';
import { makeReadingDemo } from './reading-demo.mjs';

export interface FrontendIntegrationFixtures {
  ownerId: string;
  readerId: string;
  vipId: string;
  expiredReaderId: string;
  memberFileId: string;
  vipFileId: string;
  vipIllustrationId: string;
  slugs: { article: string; work: string; resource: string; software: string; publicBook: string; vipBook: string };
}

/** Existing layout examples, synthetic accounts and test files; no persistent site data. */
export async function seedFrontendIntegration(payload: Payload, uidStore: ReturnType<typeof createReaderUidStore>): Promise<FrontendIntegrationFixtures> {
  const password = 'DemoLogin2026!';
  const owner = await payload.create({ collection: 'authors', data: { email: 'owner@example.test', password, first_name: '無相 · 本地联调', role: 'owner' } });
  const identities = [
    { email: 'reader@example.test', nickname: '本地读者', uid: '980001', vip: false, expired: false },
    { email: 'vip@example.test', nickname: '本地会员', uid: '980002', vip: true, expired: false },
    { email: 'expired@example.test', nickname: '过期会员', uid: '980003', vip: false, expired: true },
  ];
  const readerIds: string[] = [];
  for (const identity of identities) {
    const reader = await payload.create({ collection: 'readers', disableVerificationEmail: true, data: {
      email: identity.email, password, nickname: identity.nickname, phone: '', signature: '仅供本地联调的合成账号。', _verified: true, disabled: false,
      ...(identity.vip || identity.expired ? {
        vip_started_at: new Date(Date.now() - 30 * 86400000).toISOString(),
        vip_until: new Date(Date.now() + (identity.expired ? -1 : 30) * 86400000).toISOString(),
      } : {}),
    } });
    uidStore.set(String(reader.id), identity.uid);
    readerIds.push(String(reader.id));
  }
  const upload = async (name: string, data: Buffer, mimetype: string, title: string) => payload.create({ collection: 'media', data: { title, originalName: name }, file: { data, name, mimetype, size: data.byteLength } });
  // Reuse the repository's authored site mark; never invent a product screenshot.
  const siteMark = await readFile(new URL('../../public/apple-touch-icon.png', import.meta.url));
  const cover = await upload('local-site-mark.png', siteMark, 'image/png', '原站站点图标 · 本地测试封面');
  const vipIllustration = await upload('local-vip-illustration.png', siteMark, 'image/png', '本地联调 VIP 插图');
  const memberFile = await upload('local-integration-member.txt', Buffer.from('LOCAL INTEGRATION FIXTURE\nMember download test only.\n'), 'text/plain', '本地联调资料文件');
  const vipFile = await upload('local-integration-vip.txt', Buffer.from('LOCAL VIP INTEGRATION FIXTURE\nVIP download test only.\n'), 'text/plain', '本地联调 VIP 文件');
  const articleFile = await upload('local-journal-attachment.txt', Buffer.from('LOCAL ARTICLE ATTACHMENT\nPublished journal attachment test only.\n'), 'text/plain', '本地文章附件');
  await payload.create({ collection: 'site_profile', data: {
    name: '無相', signature: '让创作，有迹可循。', bio: '隔离的本地联调环境，验证新版界面与原站账号、内容、下载及阅读功能。',
    social_links: [], music_settings: { tracks: [], autoplay: false }, appearance: {}, content_order: {},
  } });
  await payload.create({ collection: 'announcements', data: { title: '本地联调环境', status: 'published', summary: '这里的账号、文章和文件均为可识别的测试数据，不连接线上数据。', sort: 0 } });
  // The existing JS fixture attaches `notes` after construction; make that
  // actual output shape explicit at this TypeScript-only testing boundary.
  const demo = makeReadingDemo() as unknown as Record<'notes' | 'works' | 'resources' | 'software', Array<{ title: string; category: string; tags: string[]; bodyHTML: string }>>;
  const kinds = ['notes', 'works', 'resources', 'software'] as const;
  const slugs = { article: 'local-journal', work: 'local-creative-work', resource: 'local-learning-resource', software: 'local-software-guide', publicBook: 'local-public-book', vipBook: 'local-vip-book' };
  for (const [index, kind] of kinds.entries()) {
    const source = demo[kind][0];
    const slug = [slugs.article, slugs.work, slugs.resource, slugs.software][index];
    const collection = kind === 'notes' ? 'articles' : 'library_entries';
    for (const published of [true, false]) {
      await payload.create({ collection, data: {
        title: `${published ? '本地联调' : '未发布测试草稿'} · ${source.title}`, slug: published ? slug : `${slug}-draft`, status: published ? 'published' : 'draft',
        summary: '使用原站真实内容服务的本地测试条目，不会影响正式内容。', category: source.category || '本地联调', tags: ['本地联调', ...(source.tags || [])],
        body: String(source.bodyHTML || '<h2>本地联调</h2><p>仅供测试。</p>').replace(/\.\/assets\/materials\/[^"\s<>]+/g, `/api/media/${cover.id}`),
        cover: cover.id, date_created: new Date().toISOString(), published_at: published ? new Date().toISOString() : null,
        ...(kind === 'notes' ? { attachments: published ? [{ id: randomUUID(), directus_files_id: articleFile.id }] : [] } : { kind, file: memberFile.id, ...(kind === 'works' || kind === 'resources' ? { showcase_cover: cover.id } : {}) }),
      } });
    }
  }
  for (const [slug, vip, published] of [[slugs.publicBook, false, true], [slugs.vipBook, true, true], ['local-book-draft', true, false]] as const) {
    const body = ['one', 'two', 'three'].map((name, index) => {
      const illustration = vip && published && name === 'two' ? `<img src="/api/media/${vipIllustration.id}" data-book-block="local-illustration-two" alt="本地联调 VIP 插图" width="180" height="180">` : '';
      const continuation = !vip && name === 'three' ? Array.from({ length: 13 }, (_, index) => `<p data-book-block="local-continuation-${index}">LOCAL CHAPTER CONTINUATION ${index + 1}</p>`).join('') : '';
      const subsections = !vip && name === 'one' ? Array.from({ length: 12 }, (_, index) => `<h3 data-book-block="local-toc-${index + 1}">目录测试 · 小节 ${index + 1}</h3><p>${'本段用于验证正文滚动、目录高亮和长目录的独立滚动。'.repeat(18)}</p>`).join('') : '';
      return `<section data-book-chapter="local-${name}" data-book-title="第 ${index + 1} 章 · 本地联调"><h2 data-book-block="local-heading-${name}">第 ${index + 1} 章</h2><p data-book-block="local-paragraph-${name}">${vip ? 'LOCAL VIP' : 'LOCAL PUBLIC'} CHAPTER ${name.toUpperCase()}</p><p>仅用于验证原站章节读取、目录、续读、书签和权限的隔离测试内容。</p>${illustration}${continuation}${subsections}</section>`;
    }).join('');
    await payload.create({ collection: 'library_entries', data: {
      title: vip ? '本地联调 · VIP 阅读测试' : '本地联调 · 普通阅读测试', slug, status: published ? 'published' : 'draft',
      summary: '含三个真实章节，使用原站阅读服务。', category: '本地联调', tags: ['本地测试'], kind: 'resource-center', vip_only: vip,
      body, cover: cover.id, file: vip ? vipFile.id : memberFile.id, date_created: new Date().toISOString(), published_at: published ? new Date().toISOString() : null,
    } });
  }
  return { ownerId: String(owner.id), readerId: readerIds[0], vipId: readerIds[1], expiredReaderId: readerIds[2], memberFileId: String(memberFile.id), vipFileId: String(vipFile.id), vipIllustrationId: String(vipIllustration.id), slugs };
}
