# Payload 认证安全升级

认证依赖 `payload`、`@payloadcms/db-sqlite`、`@payloadcms/email-nodemailer` 同步固定为 3.90.2。现有自定义 API、界面和持久数据目录继续使用；不启用通用 Payload REST 或 GraphQL。

生产配置保持 `push:false`。开始前先完成完整备份、异地校验和隔离恢复，再在停止应用写入时执行：

```sh
node scripts/migrate-payload-auth-security.mjs <private-payload-directory>
```

迁移只向 `authors` 和 `readers` 追加可空的 `reset_password_requested_at` 字段。先验证已准备的数据、数据库完整性与字段类型，缺列时使用 SQLite backup API 创建快照，再在事务内追加；重复执行不改变业务数据。启动时只读检查所需字段，未迁移则明确拒绝启动，不能用自动 schema push 代替生产迁移。

验证必须包括旧账号登录、注册、重置密码、锁定、会话撤销、现有 UID/VIP/资料/内容和上传文件，以及升级后的完整测试。新版会在旧密码成功登录后升级密码哈希；旧版 3.89 不能读取新格式。

## 回滚

常规回滚包须来自上一已验收业务源码，但使用同一组 3.90.2 认证依赖和已验证的增量 schema。发布前，必须用升级后的同一隔离数据库验证兼容回滚包：升级哈希的旧账号、新注册账号、已改密账号仍能登录，升级后写入的资料和内容仍保留。

回滚只切换到上述兼容代码，继续使用当前生产数据与配置。不能回退到 3.89，也不能恢复上线前整库覆盖新注册、帖子、资料或其他合法写入。数据库恢复属于独立故障恢复，应另行明确写入截止点和数据合并方式。

官方升级说明：[3.90.0](https://github.com/payloadcms/payload/releases/tag/v3.90.0)、[3.90.2](https://github.com/payloadcms/payload/releases/tag/v3.90.2)。
