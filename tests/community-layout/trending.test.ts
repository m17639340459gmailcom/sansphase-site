import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTrendingTopics, enhanceTrending } from "../../src/community-layout/trending.ts";
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: Window } };

const topics = Array.from({ length: 45 }, (_, i) => ({ id: `post-${i}`, title: `讨论 ${i}`, pinned: i === 1 }));

test("reads existing hot pagination, omits pinned/duplicate posts and stops at ten without an extra request", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.credentials, "same-origin");
    assert.ok(init?.signal);
    const page = Number(new URL(String(input), "http://localhost").searchParams.get("page"));
    const items = page === 1 ? [...topics.slice(0, 10), topics[9], ...topics.slice(10, 19)] : topics.slice(19, 39);
    return Response.json({ items, page, pageSize: 20, total: 45 });
  };
  const result = await loadTrendingTopics(request, new AbortController().signal);
  assert.deepEqual(calls, ["/api/community/topics?sort=hot&page=1"]);
  assert.equal(result.length, 10);
  assert.equal(new Set(result.map(topic => topic.id)).size, 10);
  assert.ok(result.every(topic => !topic.pinned));
  assert.deepEqual(result.map(topic => topic.id), topics.filter(topic => !topic.pinned).slice(0, 10).map(topic => topic.id));
});

test("fewer than ten uses actual data without empty placeholders", async () => {
  let calls = 0;
  const result = await loadTrendingTopics(async () => {
    calls++;
    return Response.json({ items: topics.slice(0, 4), page: 1, pageSize: 20, total: 4 });
  }, new AbortController().signal);
  assert.equal(result.length, 3);
  assert.equal(calls, 1);
});

test("failed or invalid responses cannot replace the existing summary with partial data", async () => {
  await assert.rejects(loadTrendingTopics(async () => new Response("", { status: 401 }), new AbortController().signal));
  await assert.rejects(loadTrendingTopics(async () => Response.json({ items: [{}], total: 1, pageSize: 20 }), new AbortController().signal));
});

test("aborting a route stops subsequent requests", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(loadTrendingTopics(async () => {
    calls++;
    controller.abort();
    return Response.json({ items: topics.slice(0, 20), page: 1, pageSize: 20, total: 45 });
  }, controller.signal));
  assert.equal(calls, 1);
});

test('board trending requests that board and never admits mixed-board results', async () => {
  const result = await loadTrendingTopics(async input => {
    const url = new URL(String(input), 'http://localhost');
    assert.equal(url.searchParams.get('board'), 'qa');
    return Response.json({ items: [{ id: 'outside', title: '别的板块', board: 'tools' }, { id: 'inside', title: '本板讨论', board: 'qa' }], pageSize: 20, total: 2 });
  }, new AbortController().signal, 'qa');
  assert.deepEqual(result.map(item => item.id), ['inside']);
});

test('leaving a board aborts its hot request and its late response cannot replace the new board', async () => {
  const { window } = new JSDOM('<ol class="community-hot"></ol>');
  const list = window.document.querySelector<HTMLOListElement>('ol')!;
  let finish: (response: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  const release = enhanceTrending(list, async (_input, options) => {
    signal = options?.signal;
    return new Promise(resolve => { finish = resolve; });
  }, 'qa');
  release(); assert.equal(signal?.aborted, true);
  const releaseNext = enhanceTrending(list, async () => Response.json({ items: [{ id: 'tools', board: 'tools', title: '工具讨论' }], total: 1, pageSize: 20 }), 'tools');
  finish(Response.json({ items: [{ id: 'qa', board: 'qa', title: '晚到的问答' }], total: 1, pageSize: 20 }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(list.querySelector('a')?.textContent, '工具讨论');
  releaseNext(); window.close();
});

test('a board with no posts shows its own empty state rather than global fallback posts', async () => {
  const { window } = new JSDOM('<ol class="community-hot"></ol>');
  const list = window.document.querySelector<HTMLOListElement>('ol')!;
  const release = enhanceTrending(list, async () => Response.json({ items: [], total: 0, pageSize: 20 }), 'tools');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(list.querySelector('a'), null); assert.match(list.textContent!, /暂无热门讨论/);
  release(); window.close();
});
