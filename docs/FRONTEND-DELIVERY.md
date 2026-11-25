# 可选前端版本的源码交付

版本 1 是默认正式前端；版本 2 是当前独立的新前端。两版复用同一套原内容、账号、VIP、媒体权限和后台。切换不迁移数据库，不复制本地验收数据，也不自动部署。

V3 候选包与下文的 V1、V2 命令分开。候选包准备和本地验收都在独立目录完成。

## 准备和验证 V3 候选包

从正式源码根目录运行 `node scripts/prepare-publication.mjs --frontend=v3`，在返回的候选目录执行以下命令。候选目录保留根项目及 V3 各自的锁文件，现有前端发布目录可用于回滚。

```text
pnpm install --frozen-lockfile
npm ci --include=dev --prefix previews/frontend-v3
pnpm check:types
node scripts/build-site.mjs --frontend=v3
```

构建会生成公用 `dist` 与 V3 私有 Next 运行目录。`dist/frontend-v3.json` 关联 V3 的构建 ID、锁文件和运行文件校验值。有 V3 清单的制品必须明确配置 `SITE_FRONTEND=v3` 并通过校验后才会启动。主站公开页面由 V3 提供，访问 `/original`、`/v1`、`/v2` 和 `/index.html` 会回到 V3 首页。V3 与现有 `/api`、`/share`、`/admin-console/` 共用主站域名。私有 Next 目录不进入公开静态根目录。V1 和 V2 回切使用独立制品。

预发布还应使用目标 HTTPS 代理检查权限、滑块和注册及找回密码邮件，验证社区往返和切换前后的性能。回切演练使用已从源码构建且通过 V3 地址兼容检查的 V2 候选和 `SITE_FRONTEND=v2`，沿用同一套持久数据。原 V2 制品保留为额外回退点。

V3 构建将浏览器请求的 Next 脚本、样式、字体和公开清单写入现有 `/assets/site/<构建版本>/` 快照。切换前按 `dist/static-delivery.json` 的清单校验并安装快照，回切时保留 V2、V3 两份快照。浏览器已经打开的 V3 页面仍能取其构建文件，下一次刷新或进入兼容的页面会使用 V2。Next 服务端路由数据、图片优化和私有运行目录仍由应用处理。回切后的页面语言及图书阅读位置由 V2 决定。

## 准备源码候选包

在正式源码根目录使用 Node.js 24.21.x：

```text
node scripts/prepare-publication.mjs
node scripts/prepare-publication.mjs --frontend=v2
```

第一条保留默认版本 1。第二条才收录 `previews/hero-upgrade` 的明确源码、第三方许可证、独立锁文件和对应回归工具，不收录其他预览、`node_modules`、`outputs`、`.local`、数据库和上传文件。成功只表示 `prepared-not-published`，不是上线。

## 从源码安装与构建

在选定的版本 2 候选源码目录中，先按根锁文件安装原应用依赖，再按新前端自己的锁文件安装它的依赖：

```text
pnpm install --frozen-lockfile
npm ci --prefix previews/hero-upgrade
pnpm check:types
node scripts/build-site.mjs --frontend=v2
```

构建不会自动安装依赖。它会先在全新目录构建完整版本 1 与原管理后台，再检查版本 2 的类型并从源码构建 `dist/frontend-v2`。原 `dist/index.html` 和原资产仍保留。两版均进入统一 `build-info.json` 的完整性清单；构建或校验失败保留上一份成功输出。

版本 2 的公开脚本、样式和字体同时进入原有 `dist/assets/site/<内容版本>/frontend-v2/` 快照，入口文档指向该版本。模块内部导入和字体地址保持相对引用，所以旧标签稍后打开 Reader、Three 或 PhotoSwipe 时仍请求原快照。只预加载入口的静态依赖图，按需模块继续按需加载；HTML、交付清单、源码、API 和私有内容不进入公开快照。

设置 `SANSPHASE_SCENE_CDN_ORIGIN` 时沿用原 CDN；未设置时版本 2 使用同源 `/assets/site/` 地址。默认版本 1 未设置该变量时的行为不变。

只有版本 1 时，继续使用原 `pnpm build`。包含多个版本时，省略版本配置会构建版本 1。`SITE_FRONTEND` 可替代命令行选项，显式 `--frontend` 优先。允许 `v1`、`v2` 和 `v3`，候选包必须包含所选版本的源码。

## 正式运行时选择

正式启动沿用 `scripts/start.mjs`、原私有配置、原持久数据目录、原 HTTPS 代理与真实账号服务。未设置 `SITE_FRONTEND` 时启动版本 1。版本 2 和版本 3 分别由 `SITE_FRONTEND=v2`、`SITE_FRONTEND=v3` 启用。

选择版本 2 时，启动前会验证其文档、哈希资源和交付清单；缺失就停止启动，不静默回退到演示内容。`/original` 保留版本 1，`/admin-console/` 保留原后台。API 始终同源，不能通过 URL 参数、本地存储或任意 API 域名改变账号与媒体的权限边界。

原有本机健康检查仍可通过回环地址请求 `GET/HEAD /healthz`，沿用原数据库健康核验与运行版本响应。该例外只接受本机连接和回环 Host；文档、账号和业务 API 仍严格核对配置的站点域名，不因探针兼容而放宽。

切换应用目录前，必须复用 [原静态安装流程](STATIC-DELIVERY.md)：按 `dist/static-delivery.json` 的文件路径和 SHA-256 核对快照，将 `dist/assets/site/<内容版本>` 安装到 `/var/www/sansphase-static/assets/site/<内容版本>`，再切换应用。现在同一份清单也涵盖版本 2，不需要另一套静态服务或新路径规则。保留旧快照，才能保证已打开的旧版标签继续加载它的延迟模块；仅替换裸 Node 的 `dist` 目录不能保证旧文件继续存在。本次没有执行这些安装或切换操作。

注册与密码重置邮件继续使用原生产 SMTP 配置，本机验收关闭 SMTP 不代表生产也应关闭。社区暂不迁移，不纳入此次主站前端替换；原社区服务和数据不改动。公告、音乐、天气等尚未进入新版的功能仍可通过版本 1 使用。

切换前还需在目标 HTTPS 域名验证代理、Cookie、真实邮件及验证码配置，并确认回滚步骤和当次发布授权。这份候选构建不会修改生产配置、上传数据或部署目录。
