# 第三方代码与素材

本仓库公开可见，不代表所有代码、字体和图像采用同一开源许可证。第三方代码和素材遵循各自目录中的 LICENSE、来源记录和权利声明。未另行声明的项目代码和品牌素材保留权利。

- npm 依赖锁定于 pnpm-lock.yaml；浏览器实际打包依赖的许可证由构建收集至 dist/assets/licenses/。
- 本地性能诊断复用 GoogleChrome/web-vitals 6.2.3（Apache-2.0，https://github.com/GoogleChrome/web-vitals），使用普通入口测量 CLS、INP、LCP、FCP 和 TTFB；不引入 DOM 归因、第三方上报或会话回放。仅本地预览显式启用，完整许可随浏览器构建输出保留。
- 本地独立管理面板采用 React-admin 5.15.4、MUI 7.3.11、Emotion 11 和 query-string 9.5.1（均为 MIT）。保留上游许可及 esbuild 生成的许可证声明；React-admin 免费核心不涉及企业付费模块。query-string 的两行导出兼容补丁、来源和验证见 docs/ADMIN-CONSOLE-LOCAL.md。本地管理入口不并入现有网站浏览器构建。
- 会员茶室本地功能版使用 Socket.IO / socket.io-client 4.8.4（MIT，https://github.com/socketio/socket.io）提供实时通信；保留库的许可声明。账号、VIP、管理规则与内容持久化接入本站已有模块。本地版本尚未启用生产聊天服务。
- 登录滑块的拼图生成与基础轨迹匹配复用 Tianai 1.5.5，运行在只监听本机的 Java 服务。根 LICENSE 为 Apache-2.0，Maven POM 声明 MulanPSL-2.0，服务目录如实保留来源与两种声明；未使用其 Web SDK、默认演示背景或字体。缓存、JSON 解析复用 Caffeine 与 Jackson，实际固定版本和完整许可见 server/login-captcha-service。浏览器仅按需加载本站定制的交互界面，不加载第三方运行地址；有效期、浏览器绑定、限速与持久单次消费继续在 Node 主站核验。旧 ALTCHA 依赖与 Worker 已移除。
- 个人资料头像与背景裁剪使用 Cropper.js 2.2.0，Copyright 2015-present Chen Fengyuan，MIT 许可证。库按需加载，沿用其裁剪、拖动、缩放和图片导出能力；完整许可证随构建输出保留。
- 社区近期页面的内存缓存使用 lru-cache 11.5.2，ISC 许可证；缓存数量有上限，账号与权限校验继续由原有服务执行。完整许可证随浏览器构建输出保留。
- Three.js、Drei、React、React Bits 等保留原许可证及来源。字体和图标使用各自许可证。
- ESO 图片保留来源、署名及相应使用条款，见 src/vendor/eso-*/sources.json。
- 用户提供的博客背景记录在 src/vendor/user-space-assets/sources.json。
- 社区成长等级采用项目所有者于 2026-10-06 确认的“命之座”星盘徽章，共十枚自包含的动态 SVG。图形为本项目在所有者指示下借助 AI 绘制的原创矢量，由 scripts/growth-constellation.ts 确定性生成，不含第三方素材、字体或位图，不继承任何图库许可，也不是原神官方图像。文件校验与生成器记录见 public/assets/community/levels/sources.json。此前的 C v3 序列（含 Lorc 的 Feather SVG）已不再随站点分发；社区权限等级同日改用项目原创的“月相”徽章，共四枚，深浅主题共用，由 scripts/trust-moon.ts 生成，同样不含第三方素材；此前沿用的 Game-icons.net 星形图标（Lorc、Delapouite，CC BY 3.0）已不再随站点分发。社区 VIP 等级同日采用项目原创的六角徽章，共八枚，由 scripts/vip-badge.ts 生成，图形不含第三方素材或位图；徽章上的“VIP”与数字取自 Noto Serif SC（思源宋体）Black 的字形并转为轮廓，字体 © 2017-2023 Adobe (http://www.adobe.com/)，以 SIL Open Font License 1.1 授权（https://openfontlicense.org），“Noto”是 Google Inc. 的商标；轮廓数据与取法见 scripts/vip-badge-glyphs.ts，站点不分发该字体文件。等级切换箭头仍为 Lucide Arrow Right（ISC）。
- 时区中文城市名称及别名取自 Unicode CLDR 48.0.0，遵循 Unicode-3.0 许可证；数据来源和处理说明见 src/vendor/cldr/sources.json，许可证见 src/vendor/cldr/LICENSE。
- 协管、版主、总版主的三档身份徽标与配套头像框复用合作者提交 `099f293` 的设计与生成脚本，以项目所有者提供的透明参考图复现。六个自包含 SVG 内嵌 WebP 像素和原有 CSS 动效，属于此组素材的位图例外，不改变成长、社区权限及 VIP 图标的原有矢量约定。头像框上的中文名称取自 Ma Shan Zheng Regular（马善政楷书）并转为字形轮廓，字体 © 2018 The Ma Shan Zheng Project Authors（https://github.com/googlefonts/mashanzheng），以 SIL Open Font License 1.1 授权；许可全文随素材保留于 public/assets/community/staff/LICENSE-MaShanZheng.txt，站点不分发字体文件。来源、字体与六件素材的校验记录见 public/assets/community/staff/sources.json；归档脚本位于 drafts/staff-icons-v8，仅用于来源留档，不参与网站构建。正式构建由 scripts/community-staff-compact-art.ts 在内存副本上固定原动效的初始视觉样式，输出透明静态 WebP 供滚动时显示。2026-10-09 按所有者要求，为版主和总版主头像框的背景光层增加径向透明渐变蒙版，使背光自然淡出，避免被方形 SVG 画布截出直边；原主体、嵌入位图、宝石、字形与动效代码均保持不变，修正前后校验记录保留于 sources.json。
- 首页 Active Theory 参考着色器、环形几何体及相关材质的使用依据：项目所有者于 2026-09-15 明确确认拥有这些素材的完整使用权，并允许用于本站及当前公开仓库。此为项目所有者的授权确认记录，不是对上游开放源代码许可的声明，也不向其他使用者另行授予素材权利。原始来源与文件校验记录继续保留在 active-theory-glass、active-theory-tubes、reference-materials 目录。

本仓库不包含作者私有数据库、登录配置、上传文件或私有备份。
