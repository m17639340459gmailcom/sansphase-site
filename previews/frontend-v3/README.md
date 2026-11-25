# SANSPHASE V3 前端

無相主站的中文版和英文版前端。主站继续提供文章、账号、会员、媒体和管理服务。香港社区由现有服务承接。

## 本地预览

在主仓库根目录执行 `node scripts/frontend-v3-shared.mjs`，生成 V3 复用的账号、图片上传与阅读进度模块。独立交付包会包含这些模块。

使用 Node.js 24.21.x，在此目录执行以下命令：

```sh
npm ci
npm run dev -- --hostname localhost
```

默认预览使用示例数据。`npm run build` 检查生产构建，`npm run start -- --hostname localhost` 预览构建结果。中文入口为 `/`，英文入口为 `/en`。正式联调使用主站网关提供的同域接口和可信站点源，详见主仓库的 `docs/FRONTEND-DELIVERY.md`。

## 源码结构

- `src/app/[locale]` 存放 V3 页面和语言布局。
- `src/components/three` 提供首页粒子展示。
- `src/lib` 包含现有主站接口的适配、地址兼容和预览数据加载。
- `src/messages` 包含中英文界面文本。
- `content/sansphase-blog` 提供可独立浏览的演示文章。

V3 使用 Next.js、React、TypeScript、Tailwind CSS、next-intl、Three.js、Motion 和 Lenis。依赖版本以 `package-lock.json` 为准。

## 版权

前端结构包含 Dingxin Tao 的 MIT 授权代码，保留原版权和许可证。上游版本与适配范围见 [SOURCE.json](SOURCE.json) 和 [LICENSE](LICENSE)。
