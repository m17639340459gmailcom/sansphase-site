import assert from "node:assert/strict";
import test from "node:test";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAdminConsolePreview } from "../scripts/preview-admin-console.ts";

test(
  "recent activity includes remark metadata without returning private bodies or unknown event fields",
  { timeout: 90000 },
  async (t) => {
    const preview = await createAdminConsolePreview({
      port: 0,
      buildAssets: false,
    });
    t.after(preview.close);
    const login = await fetch(preview.origin + "/api/author/login", {
      method: "POST",
      headers: {
        Origin: preview.origin,
        "Content-Type": "application/json",
        "X-Author-Request": "1",
      },
      body: JSON.stringify({
        email: "owner@example.test",
        password: "DemoLogin2026!",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const entries = Array.from({ length: 25 }, (_, index) => ({
      at: new Date(1700000000000 + index).toISOString(),
      action: "remark",
      readerId: id,
      cleared: index % 2 === 0,
      length: 5,
      remark: "private sentinel",
      previous: "private sentinel",
      actorId: "private actor",
    }));
    await appendFile(
      resolve(preview.directory, "data", "reader-admin-audit.jsonl"),
      entries.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    const response = await fetch(preview.origin + "/api/manage/audit", {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.events.length, 20);
    assert.equal(value.events[0].action, "remark");
    assert.equal(value.events[0].at, entries[24].at);
    assert.doesNotMatch(
      JSON.stringify(value),
      /private sentinel|private actor|previous/,
    );
    assert.equal(
      (await fetch(preview.origin + "/api/manage/audit")).status,
      403,
    );
  },
);
