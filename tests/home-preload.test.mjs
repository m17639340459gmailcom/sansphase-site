import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { collectPageImages, preparePageImages } from "../src/home-preload.mjs";
import { prepareScene } from "../src/scene-preparation.mjs";

test("image preparation deduplicates published images and excludes downloads and audio", () => {
  const doc = new JSDOM("", { url: "https://www.sansphase.com" }).window
    .document;
  const src = "/api/media/00000000-0000-4000-8000-000000000001?w=960";
  const items = collectPageImages(doc, {
    profile: { avatar: src, music: { url: "/song.mp3" } },
    notes: [
      {
        coverSrc: src,
        bodyHTML: `<p><img src="${src}" sizes="960px"></p>`,
        downloadUrl: "/large.zip",
      },
    ],
  });
  assert.equal(items.length, 3);
  assert(
    items.every(
      (item) =>
        !item.src.includes("large.zip") && !item.src.includes("song.mp3"),
    ),
  );
  assert(items.some((item) => item.sizes === "136px"));
  assert(items.some((item) => item.srcset.includes("3840w")));
});

test("image preparation limits concurrency and waits for decode", async () => {
  const doc = new JSDOM("", { url: "https://www.sansphase.com" }).window
    .document;
  let active = 0,
    max = 0;
  const pending = [];
  const progress = [];
  const decode = async (item) => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => pending.push(r));
    active--;
  };
  const content = {
    notes: [1, 2, 3].map((i) => ({ coverSrc: `/assets/${i}.jpg` })),
  };
  const work = preparePageImages(doc, content, {
    decode,
    onProgress: (p) => progress.push(p),
  });
  await Promise.resolve();
  assert.equal(pending.length, 2);
  assert(!progress.includes(1));
  pending.shift()();
  await new Promise((r) => setImmediate(r));
  assert.equal(pending.length, 2);
  pending.splice(0).forEach((r) => r());
  await work;
  assert.equal(max, 2);
  assert.equal(progress.at(-1), 1);
});

test("image failures reject preparation and cancellation never completes it", async () => {
  const doc = new JSDOM("", { url: "https://www.sansphase.com" }).window
    .document;
  await assert.rejects(
    preparePageImages(
      doc,
      { profile: { avatar: "/assets/bad.jpg" } },
      {
        decode: async () => {
          throw new Error("broken image");
        },
      },
    ),
    /broken image/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    preparePageImages(
      doc,
      { profile: { avatar: "/assets/good.jpg" } },
      {
        signal: abort.signal,
        decode: async () => {
          assert.fail("must not decode after abort");
        },
      },
    ),
    { name: "AbortError" },
  );
});

test("GPU preparation waits for texture uploads, asynchronous compilation and the submitted frame fence", async () => {
  const calls = [];
  let resolveCompile;
  let signaled = false;
  const texture = { isTexture: true },
    target = { isTexture: true, isRenderTargetTexture: true };
  const scene = {
    traverse: (fn) =>
      fn({
        material: {
          map: texture,
          uniforms: { other: { value: texture }, target: { value: target } },
        },
      }),
  };
  const context = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    ALREADY_SIGNALED: 2,
    CONDITION_SATISFIED: 3,
    WAIT_FAILED: 4,
    fenceSync: () => {
      calls.push("fence");
      return {};
    },
    flush: () => {},
    clientWaitSync: () => (signaled ? 2 : 0),
    deleteSync: () => calls.push("delete"),
    isContextLost: () => false,
  };
  const gl = {
    initTexture: (t) => {
      assert.equal(t, texture);
      calls.push("texture");
    },
    compileAsync: () => {
      calls.push("compile");
      return new Promise((r) => (resolveCompile = r));
    },
    getContext: () => context,
  };
  const frames = [];
  let done = false;
  const work = prepareScene({
    gl,
    scene,
    camera: {},
    nextFrame: () => new Promise((r) => frames.push(r)),
  }).then(() => (done = true));
  while (!resolveCompile) {
    frames.shift()?.();
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(calls, ["texture", "compile"]);
  assert.equal(done, false);
  resolveCompile();
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 3; i++) {
    frames.shift()?.();
    await new Promise((r) => setImmediate(r));
  }
  assert(calls.includes("fence"));
  assert.equal(done, false);
  signaled = true;
  frames.shift()?.();
  await work;
  assert.equal(done, true);
  assert.equal(calls.at(-1), "delete");
});
