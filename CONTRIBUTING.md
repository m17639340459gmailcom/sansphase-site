# 协作开发指南

## 先确认边界

唯一源码入口是仓库根目录。先读 [维护约定](AGENTS.md) 和 [模块地图](docs/CODE-MAP.md)，再修改对应模块。`dist/`、历史快照和 `.local/` 都不能作为正式修改入口。

新业务优先 TypeScript。部分 `.mjs` 只是导出同名 `.ts` 的兼容入口：修改 `.ts`，保留入口，构建会生成浏览器可用模块。JSX 场景仍按现有构建运行，不为改扩展名重写。

## 工作分支与构建

Node.js 24、pnpm 11.19.0：

```sh
git fetch origin
git switch -c feature/你的功能 origin/codex/release-preparation
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

使用独立功能分支和 PR。不要强推共享分支，不把他人的未完成分支顺手合入发布。PR 写明问题、改变后的行为、验证、视觉截图、数据影响和已知限制；合并前重新核对基分支变化。

## 本地预览

只看页面和视觉，不连接数据库：

```sh
pnpm build
node --input-type=module -e "import {createPreviewServer} from './server.mjs'; createPreviewServer().listen(4176,'127.0.0.1')"
```

打开 `http://127.0.0.1:4176/#/home`。这个方式没有真实内容和登录服务，列表为空是预期，不能用它验收账号与发布。

完整业务开发需要站长提供的脱敏测试数据或全新隔离数据。私有配置默认 `.local/payload-env.json`，也可用 `PAYLOAD_CONFIG_FILE` 指定，配置妥当后运行 `pnpm dev`。目前没有一键生成完整站点的初始化向导；不要复制生产密码或伪造已登录状态。

集成测试自行创建临时数据库，不需要共享真实用户数据。实际邮件投递、真实支付等外部能力须独立验证。

## 修改与验证

- 在所属模块修复并移除被替代分支，不在样式末尾堆覆盖，不滥用 `!important`。
- 输入框聚焦只改变原边框反馈，不叠加第二圈；保留键盘可见反馈。
- 修改前补必要回归用例，至少运行对应测试；提交候选前运行 `pnpm build`、`pnpm test`。
- 维护脚本需执行 `python -m unittest discover -s tests -p maintenance_test.py`；Windows 跳过的 Linux 用例在 Linux 补验。
- 真实 GPU 用例需将 `SANSPHASE_WEBGL_TEST_BROWSER` 设置为本机 Chrome 可执行文件路径，再运行 `node --test tests/black-hole-material-gpu.test.mjs`。默认明确跳过，不能记为 GPU 验证通过。
- 编辑器滚动用例需将 `SANSPHASE_UI_TEST_BROWSER` 设置为 Chrome 路径，运行 `node --test tests/author-editor-browser.test.mjs`；它使用独立浏览器和无数据库测试页面，检查五类正文编辑器的空粘贴、长文粘贴、正常输入与弹窗滚动边界。
- UI 检查桌面、窄屏与键盘；动画检查初始、持续运行、离页返回、减少动态效果和资源释放。

## 提交与发布

只暂存明确源码和测试，不用 `git add .`。不提交账号、私钥、数据库、备份、真实用户截图或本地诊断。检查 `git diff --cached`，运行 `pnpm release:prepare` 检查发布清单。

`release:prepare` 复制明确源码到新目录并扫描已配置私有值；它不上传、不部署，也不能代替人工隐私检查。

合并与上线是两件事。发布按 [发布流程](docs/RELEASE-PROCESS.md)：备份及异地验证 → 新目录构建 → 隔离数据验收 → 静态资源校验 → 切换 → 复查/回滚。不得覆盖生产数据或复制旧版本整棵目录做新版本。
