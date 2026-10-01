# 按功能查找代码

本文是当前维护入口。业务约束见 [架构说明](../ARCHITECTURE.md)。

| 想修改什么 | 主要源码 | 验证入口 |
| --- | --- | --- |
| 页面路由、顶栏导航 | `src/app.mjs`、`nav-slider.ts`、`route-transition.mjs` | nav-slider、dom 测试 |
| 首页章节、滚动与手势 | `src/universe.mjs`、`library-cosmos.tsx`、`library-cosmos-scene.jsx` | universe、library-scene 测试 |
| 黑洞 | `src/black-hole-plasma.ts` 材质、`black-hole-shaders.ts` 光线、`black-hole-formation.ts` 出场、`black-hole-background.ts` 视差；`library-black-hole.jsx` 挂载 | black-hole 系列、场景测试 |
| 排版和公共样式 | `src/styles-*.css`；`styles.css` 声明组合顺序 | 构建、DOM、实际浏览器 |
| 内容目录和卡片 | `src/catalog.ts`、`blog-background.css`、`catalog.css` | 目录及 DOM 测试 |
| 读者登录、注册、资料、会员摘要 | `src/reader-ui.ts`、`reader-membership.ts`、`reader.css` | reader、membership 系列 |
| 用户、VIP、审核后台界面 | `src/admin-readers.ts`、`admin-route.mjs` | admin、reader 系列 |
| 作者编辑、上传、富文本 | `src/author-entry.mjs`、`author-*.mjs`、`book-editor.ts`、`author.css` | 作者界面及 Payload 集成测试 |
| HTTP、静态站点、安全响应 | 根目录 `server.mjs` | HTTP、权限及集成测试 |
| 作者认证和内容操作 | `server/author-service.ts` | `tests/payload-integration.test.mjs` |
| 读者认证与验证工作流 | `server/reader-service.ts`、`reader-workflow.ts` | 注册、登录及恢复测试 |
| VIP、管理与账号清理 | `server/reader-admin-service.ts`、`reader-membership.ts`、`reader-retention.ts`、`reader-account-removal.ts` | 会员、管理、保留与删除测试 |
| 内容、书籍与附件权限 | `server/content-service.ts`、`book-delivery.ts`、`reader-access.ts` | VIP 书籍、内容测试 |
| 数据与运行配置 | `server/payload/config.ts`、`store.ts`、`runtime.ts` | 隔离数据库及迁移测试 |
| 构建与发布清单 | `scripts/build-site.mjs`、`build-cosmos.mjs`、`typed-browser-modules.mjs`、`publication-files.mjs` | 构建和发布测试 |
| 服务与备份维护 | `deploy/`、`scripts/backup-payload.mjs`、`restore-payload.mjs` | 备份恢复、Linux 维护测试 |

同一单元格内省略目录前缀的文件与首个文件同目录。具体测试名可用 `rg --files tests` 查找。

## 不要误删

- 作者编辑台与用户管理后台职责不同；后台未独立部署。
- 同名 `.ts` / `.mjs` 不一定重复，后者可能是测试兼容入口。
- `src/vendor/` 保留第三方原件、许可和来源；未直接运行不代表来源记录可删除。
- 历史玻璃装置、光标效果已归档，当前依赖图测试防止它们重新进入正式包。
- `dist/`、`.local/`、`outputs/`、`archive/` 不是源码入口。未上线的支付订单演示不进入正式源码包。
