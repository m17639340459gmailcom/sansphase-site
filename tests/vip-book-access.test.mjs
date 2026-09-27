import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewServer } from '../server.mjs';
import { visibleBootstrap } from '../server/reader-access.mjs';
import { publicPage } from '../server/content-delivery.mjs';
import { validateArticle } from '../server/author-service.mjs';
import { createContentService } from '../server/content-service.mjs';
import { migrateVipBooks } from '../server/payload/vip-book-migration.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const book = {
  id: 'vip-book', title: '星空教程', summary: '一本阅读教程', category: '教程', tags: ['学习'],
  vipOnly: true, bodyHTML: '<section data-book-chapter="one" data-book-title="第一章"><p>只有会员能看到的正文</p></section>',
  attachments: [{ name: '资料', url: '/api/media/private-file?download=1' }],
  downloadUrl: '/api/media/private-file?download=1', externalUrl: 'https://example.test/private',
  coverSrc: '/api/media/public-cover?w=960',
};
const data = { source: 'cms', profile: null, announcements: [], notes: [], works: [], resources: [], software: [], 'resource-center': [book] };

test('author can opt a resource-center book into VIP access without changing other collections', () => {
  assert.equal(validateArticle({ title: '书', slug: 'book', vip_only: true }, 'resource-center').vip_only, true);
  assert.equal(validateArticle({ title: '书', slug: 'book', vip_only: false }, 'resource-center').vip_only, false);
  assert.equal(validateArticle({ title: '书', slug: 'book' }, 'resource-center').vip_only, undefined);
  assert.equal(validateArticle({ title: '文章', slug: 'post', vip_only: true }, 'articles').vip_only, undefined);
});

test('non-VIP can discover a VIP book but receives no text, outline or download URL', () => {
  const visible = visibleBootstrap(data, { role: 'reader', vip: false });
  const listed = publicPage(visible, new URLSearchParams({ view: 'list', kind: 'resource-center' })).items[0];
  assert.equal(listed.title, book.title);
  assert.equal(listed.vipOnly, true);
  assert.equal(listed.locked, true);
  for (const secret of ['只有会员能看到的正文', 'private-file', 'example.test/private']) {
    assert(!JSON.stringify(visible).includes(secret));
    assert(!JSON.stringify(listed).includes(secret));
  }
  assert.throws(() => publicPage(visible, new URLSearchParams({ view: 'detail', kind: 'resource-center', id: book.id })), { status: 403, code: 'VIP_REQUIRED' });
  assert.throws(() => publicPage(visible, new URLSearchParams({ view: 'book-part', kind: 'resource-center', id: book.id, chapter: 'one' })), { status: 403, code: 'VIP_REQUIRED' });
  assert.equal(publicPage(visibleBootstrap(data, { role: 'reader', vip: true }), new URLSearchParams({ view: 'book-part', kind: 'resource-center', id: book.id, chapter: 'one' })).html.includes('只有会员能看到的正文'), true);
  assert.equal(publicPage(visibleBootstrap(data, { role: 'owner' }), new URLSearchParams({ view: 'book-part', kind: 'resource-center', id: book.id, chapter: 'one' })).html.includes('只有会员能看到的正文'), true);
});

test('direct URLs, cache validators and legacy content cannot bypass VIP book access', async t => {
  let viewer = { role: 'reader', vip: false };
  const server = createPreviewServer({
    readerService: { registrationEnabled: true, identity: async () => viewer },
    contentService: { snapshot: async () => ({ data }) },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const view of ['detail', 'book-part']) {
    const url = `${base}/api/content?public=1&view=${view}&kind=resource-center&id=vip-book&chapter=one`;
    const response = await fetch(url, { headers: { 'If-None-Match': '*' } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'VIP_REQUIRED');
  }
  assert(!(await (await fetch(`${base}/api/content`)).text()).includes('只有会员能看到的正文'));
  assert(!(await (await fetch(base)).text()).includes('只有会员能看到的正文'));
  viewer = { role: 'reader', vip: true };
  const allowed = await fetch(`${base}/api/content?view=book-part&kind=resource-center&id=vip-book&chapter=one`);
  assert.equal(allowed.status, 200);
  assert.match((await allowed.json()).html, /只有会员能看到的正文/);
});

test('VIP chapter image and attachment are denied to a regular reader, including cache validators', async t => {
  const cover='11111111-1111-4111-8111-111111111111';
  const image='22222222-2222-4222-8222-222222222222';
  const file='33333333-3333-4333-8333-333333333333';
  const store={
    publicData:async()=>[[],null,[],[{id:'book',kind:'resource-center',slug:'vip-book',title:'VIP Book',status:'published',vip_only:true,cover,body:`<p><img src="/api/media/${image}"></p>`,file:{id:file,filename_download:'book.pdf'}}]],
    readMedia:async()=>new Response('bytes',{headers:{'content-type':'image/webp',etag:'"image-etag"'}}),
  };
  let viewer={role:'reader',vip:false};
  const server=createPreviewServer({contentService:createContentService({url:'https://example.test',store}),readerService:{identity:async()=>viewer}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/media/`;
  assert.equal((await fetch(base+cover)).status,200);
  for(const id of [image,file])assert.equal((await fetch(base+id,{headers:{'If-None-Match':'"image-etag"'}})).status,404);
  viewer={role:'reader',vip:true};
  for(const id of [image,file])assert.equal((await fetch(base+id)).status,200);
});

test('VIP schema migration is backed up, preserves old books and can be repeated', async t => {
  const directory=await mkdtemp(resolve(tmpdir(),'vip-books-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const db=new DatabaseSync(resolve(directory,'content.db'));
  db.exec("CREATE TABLE library_entries (id TEXT PRIMARY KEY, kind TEXT); CREATE TABLE _library_entries_v (id INTEGER PRIMARY KEY, version_kind TEXT); INSERT INTO library_entries VALUES ('book','resource-center'); INSERT INTO _library_entries_v VALUES (1,'resource-center')");
  db.close();
  const result=await migrateVipBooks(directory);
  assert.equal(result.changed,true);
  await access(result.backup);
  const after=new DatabaseSync(resolve(directory,'content.db'));
  assert.equal(after.prepare("SELECT vip_only FROM library_entries WHERE id='book'").get().vip_only,0);
  after.close();
  assert.equal((await migrateVipBooks(directory)).changed,false);
});
