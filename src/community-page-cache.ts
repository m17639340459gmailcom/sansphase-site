import { LRUCache } from 'lru-cache';

export const communityPageCacheLimits = { threads: 24, members: 48, lists: 64 } as const;

/** Page DTOs only: this cache never validates an identity or grants access. */
class CommunityPageCache<Value extends object> {
  private readonly cache: LRUCache<string, Value>;
  private readonly currentKey: () => string | null;
  constructor(max: number, currentKey: () => string | null) {
    // Item count is bounded; no TTL or byte admission threshold can make an
    // already confirmed current page disappear because its DTO is large.
    this.cache = new LRUCache<string, Value>({ max });
    this.currentKey = currentKey;
  }
  get size() { return this.cache.size; }
  get(key: string) { return this.cache.get(key); }
  peek(key: string) { return this.cache.peek(key); }
  has(key: string) { return this.cache.has(key); }
  set(key: string, value: Value): this {
    // Settled reads from a previous route may still fill its history. Promote
    // the displayed page before inserting so those reads cannot evict it.
    const current = this.currentKey();
    if (current !== null && current !== key) this.cache.get(current);
    this.cache.set(key, value);
    return this;
  }
  delete(key: string) { return this.cache.delete(key); }
  clear() { this.cache.clear(); }
  keys() { return this.cache.keys(); }
  [Symbol.iterator]() { return this.cache.entries(); }
}

export function createCommunityPageCache<Value extends object>(max: number, currentKey: () => string | null = () => null) {
  return new CommunityPageCache<Value>(max, currentKey);
}
