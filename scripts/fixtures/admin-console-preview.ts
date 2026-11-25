import type { Payload } from "payload";
import sharp from "sharp";
import { readerAudit } from "../../server/reader-account-removal.ts";
import { createReaderProfileCommands } from "../../server/reader-profile-commands.ts";
import { registrationLifetimeMs, type createReaderWorkflow } from "../../server/reader-workflow.ts";
import type { createReaderUidStore } from "../../server/reader-uids.ts";

/** Synthetic records only; use the same Payload and profile-command paths as the site. */
export async function seedAdminConsolePreview(
  payload: Payload,
  directory: string,
  workflow: ReturnType<typeof createReaderWorkflow>,
  uidStore: ReturnType<typeof createReaderUidStore>,
  { includeManagementExamples = false }: { includeManagementExamples?: boolean } = {},
) {
  const owner = await payload.create({
    collection: "authors",
    data: {
      email: "owner@example.test",
      password: "DemoLogin2026!",
      first_name: "本地演示作者",
      role: "owner",
    },
  });
  await payload.create({
    collection: "site_profile",
    data: {
      name: "本地演示作者",
      signature: "记录创作与日常",
      bio: "这是隔离的主站管理演示。",
      social_links: [],
      background_library: [],
      music_settings: { tracks: [], autoplay: false },
      appearance: {},
      content_order: {},
    },
  });
  const contentSeeds = [
    ["articles", "博客文章", "articles"],
    ["works", "作品", "library_entries"],
    ["resources", "资料", "library_entries"],
    ["software", "软件推荐", "library_entries"],
    ["resource-center", "资源中心", "library_entries"],
    ["announcements", "公告", "announcements"],
  ] as const;
  for (const [kind, label, collection] of contentSeeds) {
    for (const [index, status] of ["published", "draft"].entries()) {
      await payload.create({
        collection,
        data: {
          title: `${label}演示${index + 1}`,
          status,
          summary: "仅供本地试用，不会影响线上内容。",
          date_created: new Date().toISOString(),
          ...(kind === "announcements"
            ? { sort: index, link: "" }
            : {
                slug: `demo-${kind}-${index + 1}`,
                category: "演示",
                tags: ["本地预览"],
                body:
                  kind === "resource-center"
                    ? '<section data-book-chapter="demo-one" data-book-title="第一章"><h2 data-book-block="demo-heading-one">开始写作</h2><p>在这里继续写作。</p></section><section data-book-chapter="demo-two" data-book-title="第二章"><p>章节内容。</p></section>'
                    : "<h2>写作从这里开始</h2><p>可以编辑这段演示文字，试用保存草稿和正式发布。</p>",
                published_at:
                  status === "published" ? new Date().toISOString() : null,
                ...(collection === "library_entries"
                  ? { kind, vip_only: kind === "resource-center" }
                  : { attachments: [] }),
              }),
        },
      });
    }
  }
  const readers: string[] = [],
    now = Date.now(),
    day = 86_400_000;
  for (let index = 0; index < 26; index++) {
    const number = String(index + 1).padStart(2, "0");
    const activeVip = index >= 4 && index < 12,
      expiredVip = index >= 12 && index < 17;
    const row = await payload.create({
      collection: "readers",
      disableVerificationEmail: true,
      data: {
        email: `reader-${number}@example.test`,
        password: "DemoLogin2026!",
        nickname: `演示用户${number}`,
        admin_remark: index === 25 ? "演示：设计合作" : null,
        signature: "这是隔离预览的合成账号。",
        _verified: true,
        disabled: index >= 23,
        ...(activeVip || expiredVip
          ? {
              vip_started_at: new Date(now - 60 * day).toISOString(),
              vip_until: new Date(
                now + (activeVip ? index + 1 : -index) * day,
              ).toISOString(),
            }
          : {}),
      },
    });
    readers.push(String(row.id));
    uidStore.set(String(row.id), String(900001 + index));
  }
  const profiles = createReaderProfileCommands({
    payload,
    directory,
    workflow,
    uidStore,
  });
  await profiles.submitNickname(readers[0], "星河旅人");
  await profiles.submitSignature(readers[1], "在这里记录灵感与日常。");
  const avatar = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" rx="160" fill="#c9d9df"/><circle cx="160" cy="125" r="56" fill="#607d8b"/><path d="M55 320v-30a105 105 0 0 1 210 0v30" fill="#607d8b"/></svg>',
    ),
  )
    .webp()
    .toBuffer();
  await profiles.submitAvatar(readers[2], avatar);
  if (includeManagementExamples) {
    workflow.putRegistration({
      email: "expired-demo@example.test",
      nickname: "演示注册申请",
      phone: "",
      password: "DemoLogin2026!",
    }, now - registrationLifetimeMs - day);
    const audit = readerAudit(directory, String(owner.id));
    await audit("vip-grant", readers[4], { uid: "900005", until: new Date(now + 5 * day).toISOString() });
    await audit("disable", readers[23], { uid: "900024" });
    await audit("remark", readers[25], { uid: "900026", cleared: false, length: "演示：设计合作".length });
  }
  return { ownerId: String(owner.id), readers, profiles };
}
