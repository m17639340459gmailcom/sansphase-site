const key = 'sansphase-book-reading-v1';

export type BookAnchor = {
  chapter: string;
  block: string;
  offset: number;
  title?: string;
  quote?: string;
  part?: number;
  revision?: string;
  createdAt?: number;
};
type StoredBook = { progress: BookAnchor | null; bookmarks: BookAnchor[]; updatedAt?: number };
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

function valid(anchor: unknown): anchor is BookAnchor {
  return Boolean(anchor && typeof anchor === 'object' &&
    typeof (anchor as BookAnchor).chapter === 'string' &&
    typeof (anchor as BookAnchor).block === 'string' &&
    Number.isFinite((anchor as BookAnchor).offset));
}

export function createBookProgress(storage: StoragePort, bookId: string) {
  let all: Record<string, unknown> = {};
  let available = true;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) all = parsed as Record<string, unknown>;
  } catch {}
  const previous = all[bookId];
  const prior = previous && typeof previous === 'object' ? previous as Partial<StoredBook> : {};
  let state: StoredBook = {
    progress: valid(prior.progress) ? prior.progress : null,
    bookmarks: Array.isArray(prior.bookmarks) ? prior.bookmarks.filter(valid).slice(0, 100) : [],
  };

  function write() {
    try {
      // Merge with other tabs before saving, and bound the local collection.
      const latest: unknown = JSON.parse(storage.getItem(key) || '{}');
      all = latest && typeof latest === 'object' && !Array.isArray(latest) ? latest as Record<string, unknown> : {};
      all[bookId] = { ...state, updatedAt: Date.now() };
      const entries = Object.entries(all).sort((a, b) =>
        ((b[1] as StoredBook)?.updatedAt || 0) - ((a[1] as StoredBook)?.updatedAt || 0)).slice(0, 100);
      storage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
      available = true;
    } catch { available = false; }
  }

  const same = (a: BookAnchor, b: BookAnchor) =>
    a.chapter === b.chapter && a.block === b.block && Math.abs(a.offset - b.offset) < 4;
  return {
    get value() { return structuredClone(state); },
    get available() { return available; },
    save(anchor: unknown) { if (valid(anchor)) { state.progress = { ...anchor }; write(); } },
    toggle(anchor: unknown) {
      if (!valid(anchor)) return false;
      const index = state.bookmarks.findIndex(item => same(item, anchor));
      if (index >= 0) state.bookmarks.splice(index, 1);
      else state.bookmarks.unshift({ ...anchor, createdAt: Date.now() });
      state.bookmarks = state.bookmarks.slice(0, 100);
      write();
      return index < 0;
    },
    remove(index: number) { state.bookmarks.splice(index, 1); write(); },
  };
}
