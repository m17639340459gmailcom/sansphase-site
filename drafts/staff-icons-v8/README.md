# 管理身份图标 · 生成脚本（留档）

这里只放生成脚本，用来重现预览稿。它不是正式源码入口，不参与构建，也不是上线版本。

## 文件

- `cut.py`：从参考图的透明通道切出三档头像框和徽标，写入 `assets/`，并生成 `geometry.json`。
- `hole_fit.py`：头像框内孔的圆心和半径拟合，被 `cut.py` 调用。
- `glyphs.py`：把「总版主协管版」导出为字形轮廓，写入 `glyphs.json`。字体是 Ma Shan Zheng（马善政楷书）。
- `build.mjs`：生成各档头像框、徽标的 SVG 和预览页。动效全部是 CSS，不含脚本。
- `make_render.mjs`：把某个动画时刻渲染成单独的页面，供无头浏览器截图检查。
- `serve.mjs`：本地预览服务。

## 不包含

按决定，以下内容不入库：

- 参考图原件（`source-white.webp`、`source-dark.webp`）；
- 生成的数据和输出：`glyphs.json`、`geometry.json`、`assets/`、预览页；
- 华文新魏、华文行楷等商业字体的任何轮廓。这两款已全部替换。

## 复现

1. 把带透明通道的参考图放到本目录，命名为 `source-white.webp`，运行 `python cut.py`。
2. 下载 Ma Shan Zheng 的 `MaShanZheng-Regular.ttf`，运行 `python glyphs.py <字体路径>`。
3. 运行 `node build.mjs`，预览页会写入 `index.html`。

## 许可证

- 名字的字形来自 Ma Shan Zheng，SIL Open Font License 1.1。字体文件本身不在仓库里。
- 参考图由使用者提供，不在仓库里。

## 已知例外（上线前必须处理）

- 头像框和徽标是切自参考图的位图像素，和「社区图标不含位图」的约定冲突。使用者已确认保留，正式上线前需要在维护文档里记录这个例外。

## 未验证

- 动画节奏和流畅度只通过静态截图检查，没有逐帧或在真实页面里长时间观察。
- 没有自动化测试。
