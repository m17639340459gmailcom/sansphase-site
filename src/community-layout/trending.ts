import { postHref } from "../community.ts";
import type { CommunityTopic } from "../community.ts";

export const trendingLimit = 10;
type HotTopic = Pick<CommunityTopic, "id" | "title" | "pinned">;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The existing topics route applies visibility checks before its fixed-size pagination. */
export async function loadTrendingTopics(request: typeof fetch, signal: AbortSignal, board = ''): Promise<HotTopic[]> {
  const topics: HotTopic[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 1000; page++) {
    signal.throwIfAborted();
    const params = new URLSearchParams({ ...(board ? { board } : {}), sort: 'hot', page: String(page) });
    const response = await request(`/api/community/topics?${params}`, { credentials: "same-origin", signal });
    if (!response.ok) throw new Error(`Trending unavailable: ${response.status}`);
    const data: unknown = await response.json();
    signal.throwIfAborted();
    if (!record(data) || !Array.isArray(data.items) || typeof data.total !== "number" || !Number.isFinite(data.total)
      || typeof data.pageSize !== "number" || !Number.isInteger(data.pageSize) || data.pageSize <= 0)
      throw new Error("Invalid community listing");
    for (const item of data.items) {
      if (!record(item) || typeof item.id !== "string" || typeof item.title !== "string") throw new Error("Invalid community topic");
      if (item.pinned || seen.has(item.id) || board && item.board !== board) continue;
      seen.add(item.id);
      topics.push({ id: item.id, title: item.title });
      if (topics.length === trendingLimit) return topics;
    }
    if (!data.items.length || page * data.pageSize >= data.total) break;
  }
  return topics;
}

/** Replace only this decorative list, retaining the shared page controller and summary fallback. */
export function enhanceTrending(list: HTMLOListElement, request: typeof fetch, board = ''): () => void {
  const controller = new AbortController();
  const original = Array.from(list.childNodes);
  let changed = false;
  const english = list.ownerDocument.documentElement.lang.startsWith('en');
  const state = (text: string) => {
    const row = list.ownerDocument.createElement('li'); row.className = 'community-muted'; row.textContent = text;
    list.replaceChildren(row); changed = true;
  };
  if (!original.length) state(english ? 'Loading discussions…' : '正在读取本板讨论…');
  void loadTrendingTopics(request, controller.signal, board).then((topics) => {
    if (controller.signal.aborted || !list.isConnected) return;
    if (!topics.length) { state(english ? 'No discussions yet.' : '本板暂无热门讨论。'); return; }
    const document = list.ownerDocument;
    const rows = topics.map((topic, index) => {
      const row = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = `community-hot-rank${index < 3 ? " is-top" : ""}`;
      rank.textContent = String(index + 1).padStart(2, "0");
      const link = document.createElement("a");
      link.href = postHref(topic.id);
      link.textContent = topic.title;
      row.append(rank, link);
      return row;
    });
    list.replaceChildren(...rows);
    changed = true;
  }).catch(() => {
    if (controller.signal.aborted || !list.isConnected) return;
    // Retain only the current scope's summary; never borrow another board's hot list.
    if (!original.length) state(english ? 'Discussions could not load. Reopen this board to retry.' : '热门讨论暂未加载，请重新进入本板重试。');
  });
  return () => {
    controller.abort();
    if (changed) list.replaceChildren(...original);
  };
}
