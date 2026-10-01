# 前端源码

从 [模块地图](../docs/CODE-MAP.md) 按功能找文件。

- 页面与导航：`app.mjs`、`nav-slider.ts`、`route-*.mjs`。
- 内容列表与阅读：`catalog.ts`、`content-reader.ts`、`book-*.mjs`。
- 读者与后台：`reader-ui.ts`、`reader-membership.ts`、`admin-readers.ts`。
- 作者编辑：`author-entry.mjs`、`author-*.mjs`、`book-editor.ts`。
- 首页视觉：`universe.mjs` 负责交互，`library-cosmos.tsx` 负责场景运行，`black-hole-*.ts` 负责黑洞各部分。
- 样式：`styles-*.css` 按公共职责分区，`reader.css`、`author.css`、`library-home.css` 等属于具体界面。
- 第三方：`vendor/` 保存来源、许可与原件，不能当成本站手写代码随意重构。

目录暂按现有模块名分区，避免在协作与发布时大范围移动文件造成导入冲突。新增功能建立独立职责模块；不要把所有事件继续堆进 `app.mjs`。

同名 `.mjs` 若只有 `export * from './xxx.ts'`，它是兼容入口；改 `.ts`，不要删入口或直接改 `dist/`。
