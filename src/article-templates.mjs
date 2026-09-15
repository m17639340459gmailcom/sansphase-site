// Original writing outlines. Reference articles inform structure, never content.
export const articleTemplates = {
  tutorial: {label:"技术教程", category:"技术笔记", body:"<h2>问题与目标</h2><p></p><h2>准备条件</h2><ul><li><p></p></li></ul><h2>操作过程</h2><h3>第一步</h3><p></p><h3>第二步</h3><p></p><h2>验证结果</h2><p></p><h2>遇到的问题</h2><p></p><h2>参考资料</h2><p></p>"},
  project: {label:"项目记录", category:"项目记录", body:"<h2>为什么做这个项目</h2><p></p><h2>功能与效果</h2><p></p><h2>实现过程</h2><p></p><h2>遇到的问题与取舍</h2><p></p><h2>当前限制</h2><p></p><h2>下一步计划</h2><ul><li><p></p></li></ul>"},
  journal: {label:"图文随笔", category:"随笔", body:"<p></p><h2>记录的起点</h2><p></p><h2>值得留下的细节</h2><p></p><h2>我的感受</h2><p></p>"},
};
// Optional section headings only; never populate an author's claims or version.
export const catalogTemplates = {
  works: { label: '软件作品介绍', category: '软件作品', body: '<h2>软件简介</h2><p></p><h2>版本与运行环境</h2><p></p><h2>主要功能</h2><ul><li><p></p></li></ul><h2>安装与使用</h2><p></p><h2>界面展示</h2><p></p><h2>更新记录</h2><p></p><h2>已知问题与反馈</h2><p></p>' },
  resources: { label: '资料说明', category: '学习资料', body: '<h2>这份资料的用途</h2><p></p><h2>适合谁使用</h2><p></p><h2>包含的内容</h2><ul><li><p></p></li></ul><h2>使用方法</h2><p></p><h2>来源与使用说明</h2><p></p>' },
  software: { label: '软件推荐介绍', category: '软件推荐', body: '<h2>软件用途</h2><p></p><h2>推荐理由与使用体验</h2><p></p><h2>支持平台与费用说明</h2><p></p><h2>安装与上手</h2><p></p><h2>适用场景与限制</h2><p></p><h2>官方来源</h2><p></p>' },
};
