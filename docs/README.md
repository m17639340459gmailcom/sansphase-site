# 文档导航

## 当前维护指南

| 文档 | 用途 |
| --- | --- |
| [协作指南](../CONTRIBUTING.md) | 新协作者、本地运行、分支与提交 |
| [模块地图](CODE-MAP.md) | 按功能定位源码和测试 |
| [架构边界](../ARCHITECTURE.md) | 修改业务、权限、存储之前阅读 |
| [作者指南](AUTHOR-GUIDE.md) | 日常编辑发布 |
| [读者访问](READER-ACCESS.md) | 账号与阅读权限 |
| [部署指南](DEPLOYMENT.md) | 环境、进程和 Nginx |
| [发布流程](RELEASE-PROCESS.md) | 构建、验收、切换和回滚 |
| [维护与数据保护](MAINTENANCE.md) | 备份、保留和清理 |
| [静态交付](STATIC-DELIVERY.md) | 版本资源与 CDN |
| [TypeScript 迁移](TYPESCRIPT-MIGRATION.md) | TS 源码和兼容入口 |
| [大文件上传](UPLOAD-15GB.md) | 容量与限制 |

## 最近正式发布

[2026-10-01 黑洞、导航与代码清理](RELEASE-BLACK-HOLE-20261001.md)：已部署；包含验证范围、数据保护和回滚说明。

## 历史记录怎么读

当前仅本地的修复：[作者编辑器粘贴与滚动](EDITOR-PASTE-20261001.md)、[首页顶栏横线](HEADER-LINE-20261001.md)、[切页后按钮短时无响应](ROUTE-INTERACTION-20261001.md)。尚未部署，不应与上面的正式发布记录混淆。

带日期的 `RELEASE-*` 是相应时间的验收或发布记录；`BLACK-HOLE-*`、`HEADER-VISUAL-*`、`LOCAL-*` 等是开发过程记录，不是另一套操作规范。**某份记录写“本地通过”不代表已上线。** 当前运行版本以网站 `/healthz` 及最近一次正式发布回执为准。

历史记录用于回归和排查；不要用旧方案覆盖当前维护指南。公开文档不存放真实用户资料、配置、备份或私有回执。
