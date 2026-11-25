import assert from "node:assert/strict";
import test from "node:test";
import { createAdminConsolePreview } from "../scripts/preview-admin-console.ts";

test(
  "main-site preview supports real content lifecycle and settings while protecting owner boundaries",
  { timeout: 90000 },
  async (t) => {
    const preview = await createAdminConsolePreview({
      port: 0,
      buildAssets: false,
    });
    t.after(preview.close);
    let cookie = "";
    const request = async (path: string, method = "GET", input?: unknown) =>
      fetch(preview.origin + "/api/author/" + path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: preview.origin,
          "X-Author-Request": "1",
          ...(input ? { "Content-Type": "application/json" } : {}),
        },
        body: input ? JSON.stringify(input) : undefined,
      });
    assert.equal((await request("content/articles")).status, 401);
    const login = await request("login", "POST", {
      email: "owner@example.test",
      password: "DemoLogin2026!",
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    for (const kind of [
      "articles",
      "works",
      "resources",
      "software",
      "resource-center",
      "announcements",
    ]) {
      const listed = await request(`content/${kind}`);
      assert.equal(listed.status, 200);
      assert.equal((await listed.json()).length, 2);
    }
    const original = (await (await request("content/articles")).json()).find(
      (row: { status: string }) => row.status === "published",
    );
    const summaries = await (
      await request("content/articles?view=summary")
    ).json();
    assert.equal(summaries.length, 2);
    assert.ok(
      summaries.every(
        (row: Record<string, unknown>) =>
          !("body" in row) &&
          !("pending_content" in row) &&
          !("attachments" in row),
      ),
    );
    assert.ok(
      summaries.every(
        (row: Record<string, unknown>) => typeof row.hasDraft === "boolean",
      ),
    );
    const detail = await (
      await request(`content/articles/${original.id}`)
    ).json();
    const draft = await request(`content/articles/${original.id}`, "PATCH", {
      ...detail,
      title: "未公开的新标题",
      action: "draft",
      expectedUpdated: detail.date_updated,
    });
    assert.equal(draft.status, 200, await draft.clone().text());
    const saved = await draft.json();
    const listWithDraft = await (await request("content/articles")).json();
    assert.equal(
      listWithDraft.find((row: { id: string }) => row.id === original.id).title,
      original.title,
    );
    assert.equal(
      listWithDraft.find((row: { id: string }) => row.id === original.id)
        .hasDraft,
      true,
    );
    const draftSummary = (
      await (await request("content/articles?view=summary")).json()
    ).find((row: { id: string }) => row.id === original.id);
    assert.equal(draftSummary.title, original.title);
    assert.equal(draftSummary.hasDraft, true);
    assert.equal(
      (
        await request(`content/articles/${original.id}`, "PATCH", {
          ...saved,
          action: "publish",
          expectedUpdated: detail.date_updated,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`content/articles/${original.id}`, "PATCH", {
          ...saved,
          action: "publish",
          expectedUpdated: saved.date_updated,
        })
      ).status,
      200,
    );
    const profile = await (await request("profile")).json();
    assert.equal(
      (
        await request("profile", "PATCH", {
          ...profile,
          signature: "预览保存的签名",
        })
      ).status,
      200,
    );
    const updatedProfile = await (await request("profile")).json();
    assert.equal(updatedProfile.name, profile.name);
    assert.equal(updatedProfile.signature, "预览保存的签名");
    const rows = await (await request("content/articles")).json();
    const ids = rows.map((row: { id: string }) => row.id);
    assert.equal(
      (
        await request("content/articles/reorder", "POST", {
          ids: [...ids].reverse(),
          expectedIds: ids,
        })
      ).status,
      200,
    );
    const latest = await (
      await request(`content/articles/${original.id}`)
    ).json();
    assert.equal(
      (
        await request(`content/articles/${original.id}`, "DELETE", {
          confirmId: original.id,
          expectedUpdated: latest.date_updated,
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(`content/articles/${original.id}`)).status,
      404,
    );
    assert.equal((await request("logout", "POST", {})).status, 200);
    assert.equal((await request("profile")).status, 401);
  },
);
