# 服务端源码

根目录 `server.mjs` 接收 HTTP 请求，此目录承载业务验证与存储。

- `author-service.ts`：作者身份校验、编辑发布和上传操作。
- `reader-service.ts` / `reader-workflow.ts`：读者账号、会话和验证工作流。
- `reader-admin-service.ts`：作者后台对读者、会员、审核的操作。
- `reader-membership.ts` / `reader-access.ts`：会员期限与阅读权限。
- `reader-retention.ts` / `reader-account-removal.ts` / `reader-file-cleanup.ts`：生命周期与文件清理边界。
- `content-service.ts` / `book-delivery.ts`：公开内容与受限书籍交付。
- `payload/config.ts`：集合定义和访问规则；`payload/store.ts`：存储适配；`payload/runtime.ts`：私有配置与运行生命周期。

鉴权必须在服务端执行，不能靠隐藏按钮限制访问。数据库结构变更须独立验证迁移与回滚，不开启生产 `push` 自动修改结构。

测试使用临时数据库。生产数据库、头像、上传与 VIP 信息不在此目录；源码清理不得触碰它们。详见 [维护规则](../docs/MAINTENANCE.md)。
