# 文件上传上限（v0.101）

一般附件与软件安装包的单文件上限为 **15 GiB**，即 16,106,127,360 字节；界面沿用简写“15 GB”。图片仍为 25 MiB，音乐仍为 100 MiB，音频作为普通附件上传也遵守音频上限。

软件程序安装包在此范围内，包括 EXE、MSI、APK、DMG、ZIP、7z。Payload 默认禁止部分可执行文件，因此使用官方 `allowRestrictedFileTypes` 配置允许作者上传安装包。仅站点作者有上传权限；对外发布的安装包通过下载接口返回 `Content-Disposition: attachment`，上传目录不是网站静态根目录，上传不会执行程序。此功能不包括服务器安装软件或在线运行程序。

配置依据：[Payload 受限文件类型文档](https://payloadcms.com/docs/upload/overview#restricted-file-types)。

前后端通过 `src/upload-policy.mjs` 共用限制、提示单位和六小时上传总超时。浏览器先检查大小；后端同时检查声明长度和实际流入的文件字节，因此省略 Content-Length 不能绕过限制。上传使用磁盘流式写入，不将整个安装包读入 JavaScript 内存。

单进程服务一次处理一个上传，直到 Payload 完成最终保存才释放名额；另一个上传返回 429 并提示等待。保留进度、取消、失败清理和权限检查。现阶段没有上传断点续传，网络中断需重新上传；下载仍支持 Range。六小时是最大等待时间，并不保证任何网速都能传完 15 GiB。

## 40 GB 系统盘的实际约束

上传临时文件与最终文件在保存阶段同时存在，空间检查预留约“请求大小 × 2 + 512 MiB”。因此一个 15 GiB 文件需要约 **30.5 GiB 可用空间**，这还没有计入独立备份需要的额外空间。单文件上限不代表磁盘总容量增加；空间不足会拒绝上传。没有修改腾讯云磁盘、流量包或产生任何购买。

上传锁是目前单进程部署的约束。未来改成多进程或多服务器时，需要共享空间预留或对象存储方案，不能直接增加 Node 工作进程来并行上传。高频的大安装包分发宜使用独立数据盘、对象存储或现有外部下载链接，具体选择需要结合容量和下载量确定。

## 上线时的反向代理

本次只修改本地应用。尚未在腾讯云上验证代理配置。以下为 Nginx 上传路径的配置片段，需要合并到正式 HTTPS 站点；不能直接覆盖整个站点配置。

```nginx
location = /api/author/upload {
    # 15 GiB 文件加 multipart 开销，实际文件上限由应用检查。
    client_max_body_size 15361m;
    client_body_timeout 120s;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_send_timeout 120s;
    proxy_read_timeout 6h;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://127.0.0.1:4176;
}
```

`client_body_timeout` 和 `proxy_send_timeout` 是连续两次读写之间的等待时间，而非整个文件的总时长。关闭请求缓冲避免 Nginx 先额外落地一份完整请求；部署时还需要检查上游 CDN 或网关的独立上传限制。

依据：[Nginx 代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering)、[Nginx 请求体文档](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_body_timeout)、[Node HTTP requestTimeout](https://nodejs.org/api/http.html#serverrequesttimeout)。

## 验证

- `pnpm build`：通过。
- `pnpm test`：284 项，283 通过，1 项可选 GPU 测试跳过，0 失败。结果见 `outputs/verification/upload-15gb-tests.log`。
- 包含无 Content-Length 的精确大小边界、超限拦截、图片与音频上限、失败清理、并发拦截与完成后恢复上传测试。
- 15 GiB 实际上传与 SHA-256 校验：11 项集成检查全部通过，上传过程测试进程峰值 RSS 为 373 MiB。结果见 `outputs/verification/fifteen-gib-upload.log`，隔离数据库运行，不写入真实内容库。大文件为生成的安装包传输测试数据，并未安装或运行软件；六种安装包扩展名另有上传、发布、强制下载及字节一致性测试。

本记录取代 v0.100 功能记录中的 1 GiB、双并发与三十分钟上传设置。

本地预览服务切换尚未完成：自动审批拒绝了停止并重启 4176 服务的操作，只返回“blocked by policy”。当前监听服务需要重新启动后才能使用新的服务端上限和安装包类型配置。此次测试使用隔离服务，不代表腾讯云已部署或当前旧进程已更新。

一次被中止的初始测试遗留了临时目录 `C:/Users/Administrator/AppData/Local/Temp/sansphase-payload-test-7tfr0H`，其中包含逻辑大小为 15 GiB 的测试源文件和约 3 GiB 的部分上传文件。自动审批也拒绝了该测试目录和已知测试文件的清理；此目录没有真实网站数据，可由用户手动删除。成功的最终测试使用另一个隔离目录并执行了正常清理。
