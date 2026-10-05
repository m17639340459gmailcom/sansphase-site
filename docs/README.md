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
| [社区集成](COMMUNITY-INTEGRATION-20261002.md) | 已合并功能、规则确认与未上线边界 |
| [社区当前界面](COMMUNITY-APPEARANCE.md) | 已采纳的深浅模式、交互和模块位置 |
| [社区本地版本](COMMUNITY-LOCAL-INTEGRATION.md) | 当前正式源码、预览与旧方案归档 |
| [社区上线前讨论](COMMUNITY-PRELAUNCH.md) | 身份预览、已验证的防护、已复现缺口与待确认规则 |
| [社区横幅设置](COMMUNITY-BANNERS.md) | 首页与板块的独立配置、管理权限、封面、轮播和数据迁移 |
| [星尘获取规则](COMMUNITY-STARDUST-RULES.md) | 已实施的 v4 获取上限、内容收入边界；兑换建议尚未批准 |
| [社区公约与规则入口](COMMUNITY-CONVENTION.md) | 公约正文、规则位置、申诉与版主自愿公开联系方式 |
| [社区经验方案](COMMUNITY-EXPERIENCE-RULES.md) | 十级成长、VIP1～VIP8 有效会员登录日与登录经验加速；缺席日不增长，尚未启用结算 |
| [静态交付](STATIC-DELIVERY.md) | 版本资源与 CDN |
| [TypeScript 迁移](TYPESCRIPT-MIGRATION.md) | TS 源码和兼容入口 |
| [大文件上传](UPLOAD-15GB.md) | 容量与限制 |

## 最近正式发布

[2026-10-02 编辑器、顶栏与点击修复](INTERACTION-RELEASE-20261002.md)：已部署；社区另行集成，本次未部署社区。

上一版本：[2026-10-01 黑洞、导航与代码清理](RELEASE-BLACK-HOLE-20261001.md)。

## 历史记录怎么读

本次交互修复的诊断记录：[作者编辑器粘贴与滚动](EDITOR-PASTE-20261001.md)、[首页顶栏横线](HEADER-LINE-20261001.md)、[切页后按钮短时无响应](ROUTE-INTERACTION-20261001.md)。已随 2026-10-02 版本部署，早期记录中的“未部署”描述保留其当时语境。

带日期的 `RELEASE-*` 是相应时间的验收或发布记录；`BLACK-HOLE-*`、`HEADER-VISUAL-*`、`LOCAL-*` 等是开发过程记录，不是另一套操作规范。**某份记录写“本地通过”不代表已上线。** 当前运行版本以网站 `/healthz` 及最近一次正式发布回执为准。

历史记录用于回归和排查；不要用旧方案覆盖当前维护指南。公开文档不存放真实用户资料、配置、备份或私有回执。
