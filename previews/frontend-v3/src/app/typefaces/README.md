# 首页中文字体子集

`noto-sans-sc-ui.woff2` 取自 [Google Fonts 的 Noto Sans SC](https://github.com/google/fonts/tree/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/notosanssc)，随附 [SIL Open Font License 1.1](noto-sans-sc-OFL.txt)。原始 `NotoSansSC[wght].ttf` 的 SHA-256 为 `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`。

`ui-characters.txt` 列出了从中英文首页和共享界面文案收集的字符。字重保留 100–900，其他字符继续由完整的 Noto Sans SC 提供。页面新增文字无需立即重建子集。

重新生成时，把固定上游版本的原始字体放到当前目录，使用 FontTools 4.63.0 和 Brotli 1.2.0 执行以下命令。

```sh
fonttools subset 'NotoSansSC[wght].ttf' --text-file=ui-characters.txt --output-file=noto-sans-sc-ui.woff2 --flavor=woff2 --name-IDs='*' --name-legacy --name-languages='*' --no-recalc-timestamp
```
