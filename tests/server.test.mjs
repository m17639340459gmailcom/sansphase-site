import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviewServer } from "../server.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "sansphase-http-"));
  const root = join(directory, "public");
  await mkdir(root);
  await Promise.all([
    writeFile(join(root, "index.html"), "<h1>無相</h1>"),
    writeFile(join(root, "scene.mp4"), "0123456789"),
    writeFile(join(root, "scene.webm"), "webm-video"),
    writeFile(join(root, "empty.mp4"), ""),
    writeFile(join(directory, "secret.txt"), "outside root"),
  ]);
  const server = createPreviewServer({ root });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return (path, { method = "GET", headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path,
          method,
          headers,
          agent: false,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
          response.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
}

test("preview serves complete videos with MIME, byte lengths, and cache revalidation", async (t) => {
  const request = await fixture(t);
  for (const [path, mime, body] of [
    ["/scene.mp4", "video/mp4", "0123456789"],
    ["/scene.webm", "video/webm", "webm-video"],
    ["/empty.mp4", "video/mp4", ""],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], mime);
    assert.equal(response.headers["content-length"], String(body.length));
    assert.equal(response.headers["accept-ranges"], "bytes");
    assert.equal(response.headers["cache-control"], "public, max-age=0, must-revalidate");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.body.toString(), body);
  }
});

test("preview streams exact closed, open-ended, and suffix byte ranges", async (t) => {
  const request = await fixture(t);
  for (const [range, body, contentRange] of [
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=8-999999999999999999999", "89", "bytes 8-9/10"],
    ["bytes=-20", "0123456789", "bytes 0-9/10"],
    ["bytes=0-0", "0", "bytes 0-0/10"],
  ]) {
    const response = await request("/scene.mp4", { headers: { Range: range } });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers["content-range"], contentRange, range);
    assert.equal(
      response.headers["content-length"],
      String(body.length),
      range,
    );
    assert.equal(response.body.toString(), body, range);
  }
});

test("unsatisfiable byte ranges return 416 and the full representation size", async (t) => {
  const request = await fixture(t);
  for (const range of [
    "bytes=10-",
    "bytes=8-2",
    "bytes=-0",
    "bytes=999999999999999999999-",
  ]) {
    const response = await request("/scene.mp4", { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers["content-range"], "bytes */10", range);
    assert.equal(response.body.length, 0, range);
  }
  const empty = await request("/empty.mp4", { headers: { Range: "bytes=0-" } });
  assert.equal(empty.status, 416);
  assert.equal(empty.headers["content-range"], "bytes */0");
});

test("HEAD advertises the full resource without a body; unsupported ranges are ignored", async (t) => {
  const request = await fixture(t);
  const head = await request("/scene.mp4", {
    method: "HEAD",
    headers: { Range: "bytes=2-4" },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-length"], "10");
  assert.equal(head.headers["content-range"], undefined);
  assert.equal(head.body.length, 0);
  for (const range of ["bytes=0-1,5-6", "items=0-1", "bytes=banana"]) {
    const response = await request("/scene.mp4", { headers: { Range: range } });
    assert.equal(response.status, 200, range);
    assert.equal(response.body.toString(), "0123456789", range);
  }
  const changed = await request("/scene.mp4", {
    headers: { Range: "bytes=2-4", "If-Range": '"old-video"' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.toString(), "0123456789");
});

test("root and normalized root work while traversal, missing paths, and other methods stay protected", async (t) => {
  const request = await fixture(t);
  for (const path of ["/", "/../"]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers["x-preview-app"], "sansphase-local", path);
    assert.equal(response.body.toString(), "<h1>無相</h1>", path);
  }
  for (const path of ["/..%2fsecret.txt", "/%2e%2e%5csecret.txt"]) {
    const response = await request(path);
    assert.equal(response.status, 403, path);
    assert.ok(!response.body.toString().includes("outside root"));
  }
  assert.equal((await request("/missing.mp4")).status, 404);
  const missingHead = await request("/missing.mp4", { method: "HEAD" });
  assert.equal(missingHead.status, 404);
  assert.equal(missingHead.body.length, 0);
  assert.equal((await request("/scene.mp4", { method: "POST" })).status, 405);
  assert.equal((await request("/%invalid")).status, 400);
});
