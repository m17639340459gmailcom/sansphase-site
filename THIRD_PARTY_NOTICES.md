# 第三方代码与素材

本仓库公开可见，不代表所有代码、字体和图像采用同一开源许可证。第三方代码和素材遵循各自目录中的 LICENSE、来源记录和权利声明。未另行声明的项目代码和品牌素材保留权利。

- npm 依赖锁定于 pnpm-lock.yaml；浏览器实际打包依赖的许可证由构建收集至 dist/assets/licenses/。
- 个人资料头像与背景裁剪使用 Cropper.js 2.2.0，Copyright 2015-present Chen Fengyuan，MIT 许可证。库按需加载，沿用其裁剪、拖动、缩放和图片导出能力；完整许可证随构建输出保留。
- Three.js、Drei、React、React Bits 等保留原许可证及来源。字体和图标使用各自许可证。
- ESO 图片保留来源、署名及相应使用条款，见 src/vendor/eso-*/sources.json。
- 用户提供的博客背景记录在 src/vendor/user-space-assets/sources.json。
- 社区成长等级采用项目所有者于 2026-10-06 确认的“命之座”星盘徽章，共十枚自包含的动态 SVG。图形为本项目在所有者指示下借助 AI 绘制的原创矢量，由 scripts/growth-constellation.ts 确定性生成，不含第三方素材、字体或位图，不继承任何图库许可，也不是原神官方图像。文件校验与生成器记录见 public/assets/community/levels/sources.json。此前的 C v3 序列（含 Lorc 的 Feather SVG）已不再随站点分发；社区权限等级同日改用项目原创的“月相”徽章，共四枚，深浅主题共用，由 scripts/trust-moon.ts 生成，同样不含第三方素材；此前沿用的 Game-icons.net 星形图标（Lorc、Delapouite，CC BY 3.0）已不再随站点分发。社区 VIP 等级同日采用项目原创的六角徽章，共八枚，由 scripts/vip-badge.ts 生成，图形不含第三方素材或位图；徽章上的“VIP”与数字取自 Noto Serif SC（思源宋体）Black 的字形并转为轮廓，字体 © 2017-2023 Adobe (http://www.adobe.com/)，以 SIL Open Font License 1.1 授权（https://openfontlicense.org），“Noto”是 Google Inc. 的商标；轮廓数据与取法见 scripts/vip-badge-glyphs.ts，站点不分发该字体文件。等级切换箭头仍为 Lucide Arrow Right（ISC）。
- 时区中文城市名称及别名取自 Unicode CLDR 48.0.0，遵循 Unicode-3.0 许可证；数据来源和处理说明见 src/vendor/cldr/sources.json，许可证见 src/vendor/cldr/LICENSE。
- 首页 Active Theory 参考着色器、环形几何体及相关材质的使用依据：项目所有者于 2026-09-15 明确确认拥有这些素材的完整使用权，并允许用于本站及当前公开仓库。此为项目所有者的授权确认记录，不是对上游开放源代码许可的声明，也不向其他使用者另行授予素材权利。原始来源与文件校验记录继续保留在 active-theory-glass、active-theory-tubes、reference-materials 目录。

本仓库不包含作者私有数据库、登录配置、上传文件或私有备份。
