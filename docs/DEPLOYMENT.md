# 腾讯云部署说明

目标环境：Ubuntu 24.04，Node.js 24，Nginx，单进程 Payload + SQLite，域名 https://www.sansphase.com。以下是待执行的部署流程；本地检查不代表已在腾讯云部署或验收。

## 目录与运行身份

| 位置 | 用途 |
| --- | --- |
| /opt/sansphase/releases/版本号 | 只读代码和 Linux 依赖 |
| /opt/sansphase/current | 指向当前版本的链接 |
| /var/lib/sansphase/payload | 数据库、上传文件、迁移完成记录 |
| /etc/sansphase/payload.json | 私有 Payload 配置，包含密钥，不进 Git |
| /etc/sansphase/site.env | 复制 deploy/site.env.example 后的运行环境 |
| /var/backups/sansphase | 私有备份，最好使用独立磁盘 |

创建专用 sansphase 系统用户，仅授予数据目录的写权限；私有配置由 root:sansphase 持有并设为 0640。服务不能以 root 身份运行。具体安装和防火墙操作应在连接服务器后核对现状执行，不覆盖已有站点。

## 首次上线顺序

1. 确认域名解析、服务器公网地址、80/443 端口及当前域名使用状态。应用 4176 和数据库不向公网开放。
2. 安装官方 Node.js 24 和 package.json 指定的 pnpm，安装 Nginx、Certbot。核对 systemd 文件中 /usr/bin/node 与实际路径一致。
3. 在新代码目录执行 pnpm install --frozen-lockfile、pnpm build、pnpm test。4 GB 服务器尽量不同时运行其他构建任务；测试与生产使用隔离数据。
4. 在本地运行 cms:backup，把完整私有备份安全传到服务器。使用 cms:restore 写入新的 /var/lib/sansphase/payload 和新的 /etc/sansphase/payload.json；恢复会拒绝覆盖已有目录和配置。保留原 secret 与 authorId，不重新生成或初始化数据库。运行配置使用生产绝对路径，日常启动 push:false。
5. 安装 deploy/site.env.example 和 deploy/sansphase.service。systemctl daemon-reload 后启用 sansphase；查看 journalctl -u sansphase，并执行 pnpm healthcheck。读取健康检查中的版本，与 dist/build-info.json 对比。
6. 证书尚不存在时先安装 nginx-bootstrap.conf，准备 /var/www/letsencrypt，执行 nginx -t。使用 Certbot webroot 方式为 www.sansphase.com 申请证书，再用 nginx.conf 替换临时配置。两个配置不要同时启用。再次 nginx -t，通过后 reload。确认 Certbot 自动续期任务正常。不擅自添加未确认的根域名跳转或 DNS 记录。
7. 安装备份 service/timer，复制 backup.env.example；先手动跑一次备份与恢复演练再开启 timer。日志可在 journalctl -u sansphase-backup 查看。默认保留备份，不自动删除；根据盘容量选择保留周期，并另外配置异地副本与失败通知。
8. 通过 HTTPS 验收作者登录、草稿/发布/撤回、附件权限与下载、刷新、封面、搜索、手机和访客定位。对登录限流、服务器重启恢复、健康检查、上传失败和磁盘不足做实机验收。

## 大文件与服务器容量

普通附件/安装包上限 15 GiB，图片 25 MiB，音乐 100 MiB；流式上传避免整个安装包进入内存。Nginx 对上传路由关闭请求缓冲，允许 multipart 额外开销，应用仍严格检查文件实际字节数。请求缓冲和超时语义依据 [Nginx 官方说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering)。

15 GiB 单文件上传期间，当前实现需要临时文件和最终文件空间，并保留余量；约需 30.5 GiB 可用空间。40 GB 系统盘还包含系统、程序、数据库及备份，不能承诺容纳多个大软件。上线前要实测空间，必要时增加数据盘或使用单独的对象存储方案。当前不支持断点续传，失败需重传。

上传、下载、备份应错峰进行。300 GB 月流量是服务器套餐容量，不是无限下载；不要把大型附件和全部历史备份同时堆在系统盘。

## 运维与回滚

Nginx 日志不记录查询参数，应用日志不记录请求体、Cookie 或密码。journald 和 Nginx 日志轮转需要在服务器核对容量及保留期限。健康检查脚本返回非零退出码可接入监控，但当前没有替你配置外部通知接收人。

普通代码更新：先备份，保留上一版本，切换 current 并重启，失败则切回。更新期间不要上传大文件；服务正常停止会等待在途请求，systemd 最多等待 180 秒。数据结构变更需独立迁移及恢复演练，不通过开生产 push 自动修改表。

当前未启用独立 Payload 管理面板；网站右上角作者模式负责日常内容管理。邮件找回密码未配置，可在服务器本地通过 cms:account 维护作者账号。
