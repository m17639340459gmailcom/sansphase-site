# 项目维护边界

## 唯一源码与构建

| 目录 | 职责 |
| --- | --- |
| src/ | 页面、路由、样式、前台作者模式、第三方 UI 适配 |
| src/vendor/ | 第三方原件、素材与许可证 |
| public/ | 固定公开素材 |
| dist/ | 唯一干净构建产物，禁止手改 |
| server.mjs | 公开 HTTP 路由、安全响应、首次 HTML 数据 |
| server/author-service.mjs | 作者操作验证、编辑稿／公开稿语义 |
| server/content-service.mjs | 公开字段白名单、富文本清理、媒体引用授权 |
| server/payload/config.mjs | Payload 数据集合、认证、访问权限与版本记录 |
| server/payload/store.mjs | Payload Local API 存储适配 |
| server/payload/runtime.mjs | 读取私有配置、启动和关闭 Payload |
| .local/payload/ | 当前数据库、上传文件、迁移记录，不进 Git |
| .local/payload-env.json | 密钥、作者 UUID、来源地址与站点地址，不公开 |
| archive/release-cleanup-20260915/ | 历史 Directus、旧视觉实验和对应测试，仅本地保留，不参与正式版本 |
| deploy/、scripts/start.mjs | 生产启动、反向代理、服务与备份模板 |

构建从 src/、public/ 和锁定依赖开始，不读取旧 dist。替换产物失败则恢复前一版。数据库不跟随构建删除。

## 前台边界

app.mjs 管路由和访客交互；library-ui.jsx 管第三方组件；blog-background.css 管博客材质和控件；styles.css 管布局。author-entry.mjs 使用 Tiptap 和 a11y-dialog；author.css 管作者菜单及弹窗。维护源文件，不叠加生成文件补丁。

作品、资料、软件推荐共用 catalog.mjs 的列表与详情渲染，catalog.css 只管理这些栏目的布局，复用博客的卡片材质、字体与控件。三栏分别筛选数据，作者入口统一在作者菜单。日常编辑说明见 [作者指南](docs/AUTHOR-GUIDE.md)。

刷新由 page-session.js 统一恢复展开状态、搜索、时区和滚动。离页不拆除可见卡片，封面预留比例。内容随首次 HTML 返回，不先显示样例数据。后台迁移不修改这些视觉行为。

## 后端边界

Payload 使用官方 Local API 直接嵌入网站进程，SQLite 存储 UUID 主键。无需另起 Next.js 应用；本次没有启用 Payload 自带的 Next.js 管理面板，现有前台作者模式就是日常管理界面。账号维护通过受本机权限保护的 `cms:account` 命令。

作者登录使用 Payload 认证与会话。只有配置中的 authorId 且属于 authors/owner 的账户获得作者权限。常规作者读写明确传入 `overrideAccess:false` 和验证后的用户。匿名不能直接访问集合；公开读取只运行固定服务端查询，不能传入任意查询条件。社区用户不会自动获得作者权限。

HttpOnly、SameSite=Strict Cookie 保存会话，HTTPS 启用 Secure。写入验证 Origin 与明确请求头。退出登录撤销服务端会话。密钥和凭据不注入前端。

公开内容必须 published 且发布时间已到，只输出允许的字段。编辑已发布内容时，pending_content 保存独立修改稿；点击发布才替换公开主版本。Payload 另保存最近 30 次内容版本，前台尚无历史版本浏览器。date_updated 继续用于检测其他窗口已保存的修改。

媒体只通过本站受控接口读取：公开文件必须被公开内容或作者资料引用；草稿预览需作者会话。未被公开引用的文件不能匿名访问。背景从库中移除采用可恢复标记，不立即销毁原文件。正文由 sanitize-html 白名单清理；下载响应和 CSP 隔离危险文件。共享上传策略规定附件/安装包最多 15 GiB、图片 25 MiB、音乐 100 MiB。Busboy 流式落盘，有磁盘余量和单任务检查，不将安装包完整读入内存。尚无断点续传。

旧附件字段 directus_files_id 仅作为兼容数据结构保留，旧正文的来源 URL 仅用于识别并重写图片地址。新正文使用 /api/media/UUID，不向 Directus 发出运行请求。作者服务必须显式注入存储对象，不再默认创建旧 Directus 适配器。

## 数据、升级与恢复

当前结构在初次迁移时初始化；日常启动 push:false，不在启动时自动修改数据库结构。未来新增字段必须编写、验证迁移，不可直接开启生产 push。所有 Payload 依赖锁定同一版本。

v0.92 在 library_entries.kind 的已有选项 resources/software 中增加 works。当前 SQLite 的 kind 和版本表 version_kind 都是 text，没有枚举约束；本次仅扩大应用校验选项，不增加数据库字段，也不启用 push。作品继续复用现有发布、修改稿和媒体权限流程。

`cms:backup` 使用 SQLite backup API 创建一致快照，并复制该快照引用的所有文件，生成 SHA-256 清单。恢复只写新目录；通过原始数据比对后再切换。密钥随私有备份保管，备份不能放进 dist 或公开下载目录。

当前是单个 Node 进程＋本地 SQLite 的自托管结构，适合现阶段单作者内容站。未来高并发写入或社区增长要结合实测决定 PostgreSQL、缓存、对象存储等升级，不按访客总数直接推断容量。

当前定位使用访客授权的浏览器坐标，失败可手动选城；设备时区通过 Intl 识别。音乐支持上传及音频直链，平台分享链接不能直接作为音源。

生产入口校验构建清单与私有目录隔离，应用只监听回环地址，通过 Nginx HTTPS 代理访问。静态文件使用 ETag 重新校验，带内容摘要的 chunk 可长期缓存；含作者身份的 HTML 与 API 均 no-store。日志不记录 Cookie、请求体或查询参数。systemd、Nginx 和备份模板必须在目标 Ubuntu 服务器继续实测。

仍待独立建设：社区注册持久化、可索引文章路由、生产实机托管、异地备份及监控通知。
