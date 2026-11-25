import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { LRUCache } from 'lru-cache';
import { uuidPattern } from './content-service.ts';
import type { StoredTopic } from './community-store.ts';

type Source = {
  topics: (ids: readonly string[]) => Array<Pick<StoredTopic, 'id' | 'title' | 'hasTitle' | 'board' | 'pending' | 'hidden' | 'thumbs'>>;
  boards: { list: () => Array<{ id: string; zh: string }> };
  image: (id: string) => { id: string; topic_id: string | null; reply_id: string | null; purpose: string; deleted_at?: string | null } | null | undefined;
};
// The only anonymous community projection. Never return member identities,
// body text, paid prompt fields, replies, or management-only review metadata.
export function createCommunityShare(store: Source | null, directory?: string) {
  const images = new LRUCache<string, Buffer>({ max: 32, maxSize: 8 * 1024 * 1024, sizeCalculation: image => image.length });
  const pending = new Map<string, Promise<Buffer | null>>();
  const shareTopic = (id: string) => {
    const topic = store?.topics([id])[0];
    if (!topic || topic.id !== id || topic.pending || topic.hidden || topic.board === 'vip') return null;
    const board = store!.boards.list().find(board => board.id === topic.board);
    if (!board) return null;
    const imageId = topic.thumbs?.[0];
    const image = imageId && uuidPattern.test(imageId) ? store!.image(imageId) : null;
    return { title: topic.hasTitle === false ? '社区讨论' : topic.title, description: `来自${board.zh}的讨论，登录社区后查看。`,
      ...(image && !image.deleted_at && image.purpose === 'content' && image.topic_id === id && !image.reply_id ? { imageId: image.id } : {}) };
  };
  return { shareTopic, async shareImage(id: string) {
    const before = shareTopic(id);
    if (!directory || !before?.imageId) return null;
    const imageId = before.imageId;
    let image = images.get(imageId);
    if (!image) {
      let work = pending.get(imageId);
      if (!work) {
        // Anonymous preview traffic cannot start an unbounded encoder queue.
        if (pending.size >= 2) throw Object.assign(new Error('Share image encoder is temporarily busy.'), { status: 503 });
        work = (async () => {
          try {
            const bytes = await readFile(resolve(directory, 'uploads', `community-image-${imageId}.webp`));
            const encoded = await sharp(bytes, { limitInputPixels: 40_000_000 }).resize(1200, 630, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
            images.set(imageId, encoded); return encoded;
          } catch { return null; }
          finally { pending.delete(imageId); }
        })();
        pending.set(imageId, work);
      }
      image = await work || undefined;
    }
    // Recheck after disk/encoding work so moderation can revoke an in-flight image.
    return image && shareTopic(id)?.imageId === imageId ? image : null;
  } };
}
