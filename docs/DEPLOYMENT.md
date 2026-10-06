# 腾讯云部署说明

目标环境：Ubuntu 24.04，Node.js >=24.21.0 <25，Nginx，单进程 Payload + SQLite，域名 https://www.sansphase.com。以下是待执行的部署流程；本地检查不代表已在腾讯云部署或验收。生产启动会在读取私有配置与打开数据库前拒绝旧 Node 24 补丁及其他主版本；须检查 systemd 实际使用的 `/usr/bin/node --version`，不能只检查交互终端或包管理器版本。

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
   社区默认关闭：私有 Payload 配置中的 `communityEnabled` 缺失或不是布尔值 `true` 时，全部社区页面显示待开放，社区 API 返回 503；主站博客、作品、资料、账号和作者台照常运行。此次只上线主站时保持该字段缺失或 `false`，不执行社区迁移、不删除已有社区表或上传文件。社区数据存储继续供原有账号清理与删除流程使用，关闭访问不等于清空数据。
   单独授权社区上线后，先校验完整备份及恢复副本，再在确认的私有数据目录执行 `node scripts/migrate-community.mjs <private-payload-directory>`。它会先创建数据库快照，再事务补齐横幅、请求去重与持久限速等表；旧帖子、账号与权益保留。迁移及验收完成后才将 `communityEnabled` 设置为布尔值 `true` 并重启；表结构未准备好时仍关闭，不靠生产自动推表补齐。日后关停访问改回 `false` 并重启，数据库和上传文件保留。本地 `preview:community` 使用临时数据并显式开启，与生产开关分离。详细步骤见 [源码与服务器维护](MAINTENANCE.md) 和 [社区上线前验收](COMMUNITY-PRELAUNCH.md)。
5. 安装 deploy/site.env.example 和 deploy/sansphase.service。systemctl daemon-reload 后启用 sansphase；查看 journalctl -u sansphase，并执行 pnpm healthcheck。读取健康检查中的版本，与 dist/build-info.json 对比。
6. 证书尚不存在时先安装 nginx-bootstrap.conf，准备 /var/www/letsencrypt，执行 nginx -t。使用 Certbot webroot 方式为 www.sansphase.com 申请证书，再用 nginx.conf 替换临时配置。两个配置不要同时启用。再次 nginx -t，通过后 reload。确认 Certbot 自动续期任务正常。不擅自添加未确认的根域名跳转或 DNS 记录。
7. 初次签发证书后，将 deploy/certbot-renew-hook.sh 安装至 /etc/letsencrypt/renewal-hooks/deploy/sansphase-nginx，所有者 root、权限 0755；核对其中 Nginx 与 systemctl 绝对路径。此钩子只处理 www.sansphase.com，先 nginx -t，通过后 reload。运行 certbot renew --cert-name www.sansphase.com --dry-run --run-deploy-hooks 验证续期流程与钩子，并确认续期 timer 存在且启用。
8. 安装备份 service/timer，复制 backup.env.example；先手动跑一次备份与恢复演练再开启 timer。日志可在 journalctl -u sansphase-backup 查看。默认保留备份，不自动删除；根据盘容量选择保留周期，并另外配置异地副本与失败通知。
9. 通过 HTTPS 验收作者登录、草稿/发布/撤回、附件权限与下载、刷新、封面、搜索、手机和访客定位。对登录限流、服务器重启恢复、健康检查、上传失败和磁盘不足做实机验收。

## 大文件与服务器容量

在线播放 MP3 使用 FFmpeg 补齐时长和定位索引，音频包通过 `-c:a copy` 原样复制，不重编码。Ubuntu 使用系统仓库的 `ffmpeg` 包，并在发布机运行 `tests/audio-variants.test.mjs`；该测试不得跳过。音乐上传时准备副本，已有音乐首次播放时补建，结果缓存在私有数据目录的 `audio-cache`。作者下载和 `?download=1` 仍返回上传原文件，播放副本仍需通过原有发布权限检查。缺少 FFmpeg、文件格式异常或文件超过 256 MiB 时回退原文件。缓存不进入数据备份，可按容量需要重建；首屏不会等待整首音乐缓冲，也没有必须达到20%的门槛。

作者内容的普通附件/安装包上限 15 GiB，图片 25 MiB，音乐 100 MiB；普通读者、VIP 和版主上传图片均不超过 2 MiB，作者身份另有技术上限。流式上传避免整个安装包进入内存。Nginx 对上传路由关闭请求缓冲，允许 multipart 额外开销，应用仍严格检查文件实际字节数。请求缓冲和超时语义依据 [Nginx 官方说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering)。

15 GiB 单文件上传期间，当前实现需要临时文件和最终文件空间，并保留余量；约需 30.5 GiB 可用空间。40 GB 系统盘还包含系统、程序、数据库及备份，不能承诺容纳多个大软件。上线前要实测空间，必要时增加数据盘或使用单独的对象存储方案。当前不支持断点续传，失败需重传。

上传、下载、备份应错峰进行。300 GB 月流量是服务器套餐容量，不是无限下载；不要把大型附件和全部历史备份同时堆在系统盘。

## 运维与回滚

Nginx 日志不记录查询参数，应用日志不记录请求体、Cookie 或密码。journald 和 Nginx 日志轮转需要在服务器核对容量及保留期限。健康检查脚本返回非零退出码可接入监控，但当前没有替你配置外部通知接收人。

普通代码更新：先备份，保留上一版本，切换 current 并重启，失败则切回。更新期间不要上传大文件；服务正常停止会等待在途请求，systemd 最多等待 180 秒。数据结构变更需独立迁移及恢复演练，不通过开生产 push 自动修改表。

当前未启用独立 Payload 管理面板；网站作者模式负责日常内容管理，用户管理界面使用独立的读者服务模块。读者邮箱验证与恢复能力以当前 reader 工作流、SMTP 配置及实际收信验收为准；作者账号可在受控服务器本地通过 cms:account 维护，不能将读者与作者恢复流程混为一谈。
