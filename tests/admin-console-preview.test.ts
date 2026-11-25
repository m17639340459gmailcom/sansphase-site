import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { resolve, relative } from "node:path";
import test from "node:test";
import { createAdminConsolePreview } from "../scripts/preview-admin-console.ts";

test(
  "isolated admin preview uses real owner sessions, paged synthetic readers, VIP writes and profile reviews",
  { timeout: 90000 },
  async (t) => {
    const preview = await createAdminConsolePreview({
      port: 0,
      buildAssets: false,
    });
    t.after(preview.close);
    const inside = relative(resolve(".local"), preview.directory);
    assert.match(inside, /^admin-console-preview-[^\\/]+$/);
    const address = preview.address;
    assert.equal(address.address, "127.0.0.1");
    assert.equal(new URL(preview.origin).port, String(address.port));
    const request = (path: string, options: RequestInit = {}) =>
      fetch(preview.origin + path, {
        ...options,
        signal: AbortSignal.timeout(15000),
      });
    const credentials = {
      email: "owner@example.test",
      password: "DemoLogin2026!",
    };
    const post = (
      path: string,
      value: unknown,
      cookie = "",
      headers: Record<string, string> = {},
    ) =>
      request(path, {
        method: "POST",
        headers: {
          Origin: preview.origin,
          "X-Author-Request": "1",
          "Content-Type": "application/json",
          Cookie: cookie,
          ...headers,
        },
        body: JSON.stringify(value),
      });
    assert.equal((await request("/api/manage/readers")).status, 403);
    assert.equal(
      (
        await request("/api/manage/readers", {
          headers: { Cookie: "sansphase_author_session=owner" },
        })
      ).status,
      403,
    );
    assert.equal(await (await request("/api/author/session")).json(), null);
    assert.equal(
      (
        await post("/api/author/login", credentials, "", {
          Origin: "https://untrusted.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post("/api/author/login", credentials, "", {
          "X-Author-Request": "",
        })
      ).status,
      403,
    );
    const login = await post("/api/author/login", credentials);
    assert.equal(login.status, 200, await login.clone().text());
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(cookie, /^sansphase_author_session=/);
    const owner = (path: string) =>
      request(path, { headers: { Cookie: cookie } });
    assert.equal(
      (await (await owner("/api/author/session")).json()).name,
      "本地演示作者",
    );
    const first = await (await owner("/api/manage/readers")).json();
    const second = await (await owner("/api/manage/readers?page=2")).json();
    assert.equal(first.total, 26);
    assert.equal(first.users.length, 20);
    assert.equal(second.users.length, 6);
    assert.equal(first.summary.total, 26);
    assert.ok(
      first.summary.vip > 0 &&
        first.summary.expiredVip > 0 &&
        first.summary.disabled > 0,
    );
    assert.ok(
      [...first.users, ...second.users].every((row) =>
        /@example\.test$/.test(row.email),
      ),
    );
    const target = preview.fixtures.readers[0];
    assert.equal(
      (
        await post(
          `/api/manage/readers/${target}/vip-add-days`,
          { confirmId: target, days: 30 },
          cookie,
          { Origin: "https://untrusted.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          `/api/manage/readers/${target}/vip-add-days`,
          { confirmId: target, days: 366 },
          cookie,
        )
      ).status,
      400,
    );
    const membership = await post(
      `/api/manage/readers/${target}/vip-add-days`,
      { confirmId: target, days: 30 },
      cookie,
    );
    assert.equal(membership.status, 200, await membership.clone().text());
    assert.equal((await membership.json()).vip, true);
    const queue = await (await owner("/api/manage/review")).json();
    assert.deepEqual(queue.profiles.map((item) => item.kind).sort(), [
      "avatar",
      "nickname",
      "signature",
    ]);
    const nickname = queue.profiles.find((item) => item.kind === "nickname");
    assert.equal(
      (
        await post(
          `/api/manage/review/profile/${nickname.id}/approve`,
          {},
          cookie,
        )
      ).status,
      200,
    );
    const searched = await (
      await owner(
        "/api/manage/readers?q=" + encodeURIComponent(nickname.proposedValue),
      )
    ).json();
    assert.equal(searched.users[0].nickname, nickname.proposedValue);
    const signature = queue.profiles.find((item) => item.kind === "signature");
    assert.equal(
      (
        await post(
          `/api/manage/review/profile/${signature.id}/reject`,
          { reason: "演示审核：请调整文字后重新提交。" },
          cookie,
        )
      ).status,
      200,
    );
    const avatar = queue.profiles.find((item) => item.kind === "avatar");
    assert.equal((await request(avatar.avatarUrl)).status, 403);
    const image = await owner(avatar.avatarUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/webp");
    assert.equal(
      (
        await post(
          `/api/manage/review/profile/${avatar.id}/approve`,
          {},
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await (await owner("/api/manage/review")).json()).profiles.length,
      0,
    );
    const log = await readFile(
      resolve(preview.directory, "data/reader-admin-audit.jsonl"),
      "utf8",
    );
    assert.match(log, /vip-add-days/);
    assert.equal((await request("/data/content.db")).status, 404);
    const foreignHostStatus = await new Promise<number | undefined>(
      (done, reject) => {
        const req = httpRequest(
          preview.origin + "/api/manage/readers",
          { headers: { Host: "untrusted.invalid", Cookie: cookie } },
          (response) => {
            response.resume();
            done(response.statusCode);
          },
        );
        req.once("error", reject);
        req.end();
      },
    );
    assert.equal(foreignHostStatus, 403);
    assert.equal((await post("/api/author/logout", {}, cookie)).status, 200);
    assert.equal((await owner("/api/manage/readers")).status, 403);
  },
);
