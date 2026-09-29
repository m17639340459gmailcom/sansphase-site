import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentService } from '../server/content-service.ts';
import { createPreviewServer } from '../server.mjs';

const shared = '11111111-1111-4111-8111-111111111111';
const publicImage = '22222222-2222-4222-8222-222222222222';
const privateImage = '33333333-3333-4333-8333-333333333333';
const privateFile = '44444444-4444-4444-8444-444444444444';
const mediaResponse = () => new Response('image bytes', { headers: { 'content-type': 'image/webp', etag: '"test"' } });

test('anonymous media access follows current published references, including downloads', async t => {
  let published = true;
  const store = {
    publicData: async () => [
      [{ id: 'a', slug: 'hello', title: 'Hello', status: 'published', cover: publicImage, body: `<p><img src="/api/media/${shared}"></p>` }],
      { name: 'Author', social_links: [] }, [],
      published ? [{ id: 'w', kind: 'works', slug: 'work', title: 'Work', status: 'published', cover: privateImage, body: `<p><img src="/api/media/${shared}"></p>`, file: { id: privateFile, filename_download: 'file.pdf' } }] : [],
    ],
    readMedia: async () => mediaResponse(),
  };
  const contentService = createContentService({ url: 'https://example.test', store });
  const readerService = { identity: async req => req.headers.cookie === 'reader=yes' ? { id: 'reader' } : null };
  const server = createPreviewServer({ contentService, readerService });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/media/`;
  assert.equal((await fetch(base + publicImage)).status, 200);
  assert.equal((await fetch(base + shared)).status, 200);
  assert.equal((await fetch(base + privateImage)).status, 404);
  assert.equal((await fetch(base + privateFile + '?download=1')).status, 404);
  assert.equal((await fetch(base + privateImage, { headers: { cookie: 'reader=yes' } })).status, 200);
  published = false;
  assert.equal((await fetch(base + privateImage, { headers: { cookie: 'reader=yes', 'If-None-Match': '"test"' } })).status, 404);
});
