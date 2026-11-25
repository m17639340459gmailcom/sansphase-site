# 按功能查找代码

本文是当前维护入口。业务约束见 [架构说明](../ARCHITECTURE.md)。

| 想修改什么 | 主要源码 | 验证入口 |
| --- | --- | --- |
| 页面路由、顶栏导航 | `src/app.mjs`、`nav-slider.ts`、`route-transition.ts` | nav-slider、route-transition、dom 测试 |
| 首页章节、滚动与手势 | `src/universe.mjs`、`library-cosmos.tsx`、`library-cosmos-scene.jsx` | universe、library-scene 测试 |
| 黑洞 | `src/black-hole-plasma.ts` 材质、`black-hole-shaders.ts` 光线、`black-hole-formation.ts` 出场、`black-hole-background.ts` 视差；`library-black-hole.jsx` 挂载 | black-hole 系列、场景测试 |
| 排版和公共样式 | `src/styles-*.css`；`styles.css` 声明组合顺序 | 构建、DOM、实际浏览器 |
| 内容目录和卡片 | `src/catalog.ts`、`blog-background.css`、`catalog.css` | 目录及 DOM 测试 |
| 读者登录、注册、资料、会员摘要 | `src/reader-ui.ts`、`reader-membership.ts`、`reader.css` | reader、membership 系列 |
| 用户、VIP、审核后台界面 | `src/admin-readers.ts`、`admin-route.mjs` | admin、reader 系列 |
| 作者编辑、上传、富文本 | `src/author-entry.mjs`、`author-*.mjs`、`book-editor.ts`、`author.css` | 作者界面及 Payload 集成测试 |
| HTTP、静态站点、安全响应 | 根目录 `server.mjs` | HTTP、权限及集成测试 |
| 公开博客正文地址与搜索信息 | `server/blog-seo.ts`；`src/blog-route.ts`、`blog-metadata.ts`、`article-page.ts`、`blog-reading-sidebar.ts` | blog-seo、blog-route、article-page、blog-entry-browser；边界见 PUBLIC-READING.md |
| 主站公开内容缓存与投影 | `server/public-snapshot.ts`、`content-delivery.ts`、`payload/store.ts` | public-snapshot、content-delivery、public-data-projection；不得绕过发布资格与媒体授权 |
| 分享卡片与原帖跳转 | `server/share-preview.ts`、`share-document.ts`、`community-share.ts`；`src/share-links.ts`、`community-entry.ts` | share、community-share 与社区进入回归；范围见 SHARING-AND-INVITATIONS.md |
| 作者认证和内容操作 | `server/author-service.ts` | `tests/payload-integration.test.mjs` |
| 读者认证与验证工作流 | `server/reader-service.ts`、`reader-workflow.ts` | 注册、登录及恢复测试 |
| 邀请注册与审核奖励 | `server/reader-invitations.ts`、`community-referrals.ts`、`community-referral-context.ts`；`src/community-invitations.ts`；`server/payload/invitation-migration.ts` | reader-invitation、community-referrals、community-invitations 与注册/审核/身份桥回归；范围见 SHARING-AND-INVITATIONS.md |
| 登录人机验证 | `server/login-verification.ts`、`login-verification-backup.ts`、`login-captcha-service/`；`src/login-verification.ts`、`login-verification-library.ts` | login-verification、login-slider 系列与 Java 核心测试；规则见 LOGIN-VERIFICATION.md |
| VIP、管理与账号清理 | `server/reader-admin-service.ts`、`reader-membership.ts`、`reader-retention.ts`、`reader-account-removal.ts` | 会员、管理、保留与删除测试 |
| 内容、书籍与附件权限 | `server/content-service.ts`、`book-delivery.ts`、`reader-access.ts` | VIP 书籍、内容测试 |
| 数据与运行配置 | `server/payload/config.ts`、`store.ts`、`runtime.ts` | 隔离数据库及迁移测试 |
| 构建与发布清单 | `scripts/build-site.mjs`、`build-cosmos.mjs`、`typed-browser-modules.mjs`、`publication-files.mjs` | 构建和发布测试 |
| 社区首页、板块横幅 | `src/community-banner-controller.ts`、`community-banner-editor.ts`、`community-frame-banners.ts`、`community-layout/feed-showcase.ts`；`server/community-banners.ts`、`server/payload/community-migration.ts` | community-banners、community-banner-controller、community-banner-editor、feed-showcase、feed-carousel 测试 |
| 社区交互、签到、同页阅读位置 | `src/community-ui.ts`、`community.ts`、`community-pages.ts`、`community-layout/feed-shell.ts`；`server/community-routes-member.ts` | community-interaction-stability、community-document-scroll、community-checkin-stars、community-service 测试 |
| 社区商品素材上传、特效导入 | `src/community-equipment-controller.ts`、`community-shop-editor.ts`、`community-equipment-import.ts` | community-interaction-stability、community-equipment-import；统一请求和事件由 community-ui 持有 |
| 管理成员查找与任命交互 | `src/community-steward-controller.ts`、`community-stewards.ts` | community-interaction-stability、community-stewards、community-management-scroll；身份与服务器授权仍为唯一依据 |
| 社区成长、信任与 VIP 等级 | `src/community-growth.ts` 定义展示类型；`community-level-explorer.ts`、`community-growth-art.ts` 提供等级浏览；`server/community-experience.ts`、`community-service.ts`、`community-routes-member.ts` 提供真实经验与会员状态 | community-growth、community-experience、community-growth-ui、community-level-explorer、community-service 测试 |
| 社区公约与十秒确认 | `src/community-convention.ts`、`community-convention-consent.ts`、`community-ui.ts`；`server/community-convention.ts` | community-convention、community-convention-consent-ui 测试 |
| 版主负责板块与申诉联系方式 | `src/community-management.ts`、`community-post.ts`；`server/community-members.ts`、`community-moderation-contact.ts`、`community-routes-manage.ts` | community-moderator-scope、community-board-moderation、community-moderation-contact、community-contacts-ui 测试 |
| 邮箱验证码、昵称和 IP 登录名额 | `src/reader-policy.ts`、`reader-ui.ts`；`server/reader-workflow.ts`、`reader-service.ts`、`login-ledger.ts` | reader-workflow、reader-integration、reader-policy、login-ledger-limit 测试 |
| 半年未登录账号及关联社区数据清理 | `server/reader-retention-policy.ts`、`reader-retention.ts`、`reader-account-removal.ts`、`community-reader-cleanup.ts`、`reader-file-cleanup.ts` | reader-retention、reader-community-cleanup 测试 |
| 社区结算、奖励、请求重试与限速 | `server/community-economy.ts`、`community-ledger.ts`、`community-store.ts`、`community-requests.ts`、`community-rate-limits.ts`；`src/community-write-request.ts` | community-concurrency、community-store、community-service、community-rate-limits、community-write-request 测试 |
| 社区管理审计与文件镜像 | `server/community-audit.ts`、`community-service.ts`、`community-runtime.ts`、`community-routes-manage.ts`、`community-review.ts` | community-audit、community-service、community-board-moderation 测试 |
| 服务与备份维护 | `deploy/`；主站 `scripts/backup-payload.mjs`、`restore-payload.mjs`；社区 `scripts/backup-community.mjs`、`restore-community.mjs` | 主站及 community-host 备份恢复、Linux 维护测试 |
| 稳定性与性能诊断 | `src/site-diagnostics.ts`、`site-diagnostics-policy.ts`；`server/diagnostics-service.ts`、`local-diagnostics.ts`、`production-diagnostics.ts`；`scripts/preview-diagnostics.ts` | site-diagnostics-client、site-diagnostics-policy、site-diagnostics-integration、local-diagnostics、production-diagnostics 测试；运行与采样边界见 LOCAL-DIAGNOSTICS.md |

同一单元格内省略目录前缀的文件与首个文件同目录。具体测试名可用 `rg --files tests` 查找。

## 不要误删

- 作者编辑台与用户管理后台职责不同；后台未独立部署。
- 同名 `.ts` / `.mjs` 不一定重复，后者可能是测试兼容入口。
- `src/vendor/` 保留第三方原件、许可和来源；未直接运行不代表来源记录可删除。
- 历史玻璃装置、光标效果已归档，当前依赖图测试防止它们重新进入正式包。
- `dist/`、`.local/`、`outputs/`、`archive/` 不是源码入口。未上线的支付订单演示不进入正式源码包。
