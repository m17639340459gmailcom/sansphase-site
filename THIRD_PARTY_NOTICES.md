# 第三方代码与素材

本仓库公开可见，不代表所有代码、字体和图像采用同一开源许可证。第三方代码和素材遵循各自目录中的 LICENSE、来源记录和权利声明。未另行声明的项目代码和品牌素材保留权利。

- npm 依赖锁定于 pnpm-lock.yaml；浏览器实际打包依赖的许可证由构建收集至 dist/assets/licenses/。
- Three.js、Drei、React、React Bits 等保留原许可证及来源。字体和图标使用各自许可证。
- ESO 图片保留来源、署名及相应使用条款，见 src/vendor/eso-*/sources.json。
- 用户提供的博客背景记录在 src/vendor/user-space-assets/sources.json。
- 社区成长等级采用项目所有者于 2026-10-06 选定的 C v3 羽翼、凤凰与中国龙序列。G1 是 Lorc 在 [Game-icons.net](https://game-icons.net/1x1/lorc/feather.html) 发布的 Feather SVG，遵循 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，原文件按字节保留。G2～G10 由用户明确授权 AI 生成并确认采用，不属于该图库素材，也不继承其 CC BY 许可；原始透明 PNG 等比缩小至最长边 512 像素，再以无损 WebP 编码保留透明通道。G7～G10 使用内嵌原图的动态 SVG，实现羽翼、尾羽、龙须的空间运动与分级炫彩；原静态 WebP 保留不变，动态资产由 scripts/build-growth-motion.mjs 与 scripts/growth-motion-rig.ts 复现，SHA-256 另记于来源文件的 motion 数组。原 PNG 与派生 WebP 的 SHA-256、生成来源和转换说明记录在 public/assets/community/levels/sources.json，公开署名页为 public/assets/community/levels/credits.html。旧版星辰 SVG 仍用于信任等级兼容展示，保留 Lorc / Delapouite 署名及 CC BY 3.0 来源记录。以上素材不是原神官方图像。等级切换箭头复用 lucide@1.45.0 的 Arrow Right，遵循 ISC，原许可保留于同目录 lucide-LICENSE。
- 时区中文城市名称及别名取自 Unicode CLDR 48.0.0，遵循 Unicode-3.0 许可证；数据来源和处理说明见 src/vendor/cldr/sources.json，许可证见 src/vendor/cldr/LICENSE。
- 首页 Active Theory 参考着色器、环形几何体及相关材质的使用依据：项目所有者于 2026-09-15 明确确认拥有这些素材的完整使用权，并允许用于本站及当前公开仓库。此为项目所有者的授权确认记录，不是对上游开放源代码许可的声明，也不向其他使用者另行授予素材权利。原始来源与文件校验记录继续保留在 active-theory-glass、active-theory-tubes、reference-materials 目录。

本仓库不包含作者私有数据库、登录配置、上传文件或私有备份。
